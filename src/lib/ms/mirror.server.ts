import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BUCKET } from "@/lib/documents/logic";
import { getAccessToken, libraryConnection } from "./graph.server";
import { createDrive, processQueue, type Drive, type MirrorDb, type QueueRow } from "./mirror";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as unknown as { from: (t: string) => any; storage: typeof supabaseAdmin.storage };

/** A drive handle that acts as the library account. The token is added only for Microsoft Graph addresses. */
export async function libraryDrive(): Promise<{ drive: Drive; rootItemId: string | null; rootPath: string | null } | null> {
  const lib = await libraryConnection();
  if (!lib) return null;
  const token = await getAccessToken(lib.user_id);
  const drive = createDrive((url, init = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(url.startsWith("https://graph.microsoft.com/") ? { authorization: `Bearer ${token}` } : {}) },
    }),
  );
  return { drive, rootItemId: lib.onedrive_root_item_id, rootPath: lib.onedrive_root_path };
}

const db = (rootItemId: string | null): MirrorDb => ({
  root: async () => (rootItemId ? { rootItemId } : null),
  due: async (now, limit) => {
    const { data } = await admin
      .from("onedrive_mirror_queue")
      .select("id,project_id,document_id,action,status,attempts,last_error,next_attempt_at,upload_url,next_offset")
      .eq("status", "pending")
      .lte("next_attempt_at", now.toISOString())
      .order("created_at")
      .limit(limit);
    return (data ?? []) as QueueRow[];
  },
  project: async (id) => {
    const { data } = await admin
      .from("projects")
      .select("id,project_number,name,onedrive_folder_id,onedrive_parent_item_id,client:clients(id,name,onedrive_folder_id)")
      .eq("id", id)
      .maybeSingle();
    return data ?? null;
  },
  document: async (id) => {
    const { data } = await admin.from("project_documents").select("id,section,file_name,version,size_bytes,storage_path").eq("id", id).maybeSingle();
    return data ?? null;
  },
  saveClientFolder: async (clientId, folderId) => void (await admin.from("clients").update({ onedrive_folder_id: folderId }).eq("id", clientId)),
  saveProjectFolder: async (projectId, folderId) => void (await admin.from("projects").update({ onedrive_folder_id: folderId }).eq("id", projectId)),
  saveQueue: async (id, patch) => void (await admin.from("onedrive_mirror_queue").update(patch).eq("id", id)),
  saveDocument: async (id, patch) => void (await admin.from("project_documents").update(patch).eq("id", id)),
});

/** Reads one byte range of a stored document without loading the whole file. */
async function range(path: string, start: number, end: number): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) throw new Error(`Could not read the stored file: ${error?.message ?? "no address"}`);
  const res = await fetch(data.signedUrl, { headers: { range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`Could not read the stored file (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== end - start + 1) throw new Error("The stored file returned an unexpected number of bytes");
  return bytes;
}

export async function runMirror() {
  const lib = await libraryDrive().catch((e: Error) => ({ error: e.message }));
  if (!lib) return { skipped: "Microsoft 365 library is not connected" };
  if ("error" in lib) return { skipped: `Library connection needs attention: ${lib.error}` };
  // One run stays well inside the host's request limits: a handful of items, at most 80 MB of chunks.
  return processQueue({ drive: lib.drive, storage: { range }, db: db(lib.rootItemId) }, new Date(), { maxItems: 6, maxChunks: 8 });
}
