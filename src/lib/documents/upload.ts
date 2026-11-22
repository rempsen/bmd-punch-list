import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/platform/db";
import { BUCKET, checkFile, storagePath, type DocSection } from "./logic";

const SUPABASE_URL = import.meta.env["VITE_SUPABASE_URL"] as string;
const SUPABASE_KEY = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;

export type UploadHandle = {
  /** Resolves when the file is stored and its document row exists. */
  done: Promise<void>;
  pause: () => void;
  resume: () => void;
};

/**
 * Resumable upload straight from the browser to storage. A dropped connection retries on its own,
 * and the same file dropped again after a reload continues from where it stopped.
 */
export function uploadDocument(opts: {
  projectId: string;
  section: DocSection;
  file: File;
  note?: string | null;
  onProgress: (sent: number, total: number) => void;
}): UploadHandle {
  const { projectId, section, file } = opts;
  let upload: tus.Upload | null = null;
  let paused = false;

  const done = (async () => {
    const problem = checkFile(file);
    if (problem) throw new Error(problem);
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("You are signed out. Sign in and try again.");

    let objectName = storagePath(projectId, section, crypto.randomUUID(), file.name);
    await new Promise<void>((resolve, reject) => {
      upload = new tus.Upload(file, {
        endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
        // The authorization header is set per request below; setting it here as well would send it twice.
        headers: { apikey: SUPABASE_KEY, "x-upsert": "false" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024, // required by the storage service
        metadata: { bucketName: BUCKET, objectName, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
        fingerprint: async () => ["bmd-doc", projectId, section, file.name, file.size, file.lastModified].join("|"),
        // Long uploads outlive the access token; always send the current one.
        onBeforeRequest: async (req) => {
          const s = await supabase.auth.getSession();
          if (s.data.session) req.setHeader("authorization", `Bearer ${s.data.session.access_token}`);
        },
        // Keep retrying through a dropped connection; give up at once only on a refusal the server will repeat.
        onShouldRetry: (err) => {
          const status = err.originalResponse?.getStatus() ?? 0;
          return !(status >= 400 && status < 500) || status === 409 || status === 423;
        },
        onProgress: opts.onProgress,
        onError: (e) => reject(new Error(friendly(e))),
        onSuccess: () => resolve(),
      });
      void upload.findPreviousUploads().then((prev) => {
        const last = prev[0];
        const name = last?.metadata?.["objectName"];
        if (last && name) {
          objectName = name; // continue the earlier upload into the same object
          upload!.resumeFromPreviousUpload(last);
        }
        if (!paused) upload!.start();
      });
    });

    const documentId = objectName.split("/")[2]!;
    const { error } = await db.from("project_documents").insert({
      id: documentId,
      project_id: projectId,
      section,
      file_name: file.name,
      storage_path: objectName,
      size_bytes: file.size,
      mime: file.type || null,
      note: opts.note?.trim() || null,
    });
    // 23505 on the primary key means this upload's row was already written by an earlier attempt.
    if (error && !(error.code === "23505" && /pkey|storage_path/.test(error.message))) throw new Error(error.message);
  })();

  return {
    done,
    pause: () => {
      paused = true;
      void upload?.abort();
    },
    resume: () => {
      paused = false;
      upload?.start();
    },
  };
}

function friendly(e: Error | tus.DetailedError): string {
  const status = "originalResponse" in e ? e.originalResponse?.getStatus() : undefined;
  if (status === 403) return "You don't have permission to add documents to this project.";
  if (status === 413) return "That file is larger than the 250 MB limit.";
  if (status === 409) return "A file with that name is already being uploaded.";
  return "The upload was interrupted. Check your connection and press Retry — it continues from where it stopped.";
}

export async function signedUrl(storagePathValue: string, downloadAs?: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePathValue, 3600, downloadAs ? { download: downloadAs } : undefined);
  if (error || !data) throw new Error(error?.message ?? "Could not open the file");
  return data.signedUrl;
}
