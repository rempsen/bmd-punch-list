/**
 * One-way mirror of project documents into OneDrive: Client / Project / Section / file.
 * The mirror only reads, creates folders and uploads. It has no code path that deletes, moves or renames.
 */
import { SECTIONS, type DocSection } from "@/lib/documents/logic";
import { GRAPH } from "./core";

/** Upload chunk size. OneDrive requires a multiple of 320 KiB. */
export const CHUNK = 320 * 1024 * 32; // 10 MiB
const MAX_ATTEMPTS = 3;

export function safeFolderName(name: string): string {
  const out = name
    .replace(/:\s+/g, " - ")
    .replace(/["*:<>?/\\|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
  return out || "Untitled";
}

export const projectFolderName = (projectNumber: string | null, name: string) =>
  safeFolderName(projectNumber ? `${projectNumber} – ${name}` : name);

export const sectionFolder = (s: DocSection) => SECTIONS.find((x) => x.value === s)!.label;

/** Version 1 keeps its name; later versions sit beside it as "name (v2).ext". */
export function mirrorFileName(fileName: string, version: number): string {
  const clean = safeFolderName(fileName);
  if (version <= 1) return clean;
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? `${clean.slice(0, dot)} (v${version})${clean.slice(dot)}` : `${clean} (v${version})`;
}

export const backoffMinutes = (attempt: number) => (attempt <= 1 ? 1 : attempt === 2 ? 5 : 30);

class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new GraphError(body.error?.message ?? `OneDrive returned ${res.status}`, res.status);
}

export type DriveCall = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The only door to OneDrive. `call` adds the access token for Graph addresses.
 * Requests are checked against a short allow-list: read anything, create a folder, start an upload.
 */
export function createDrive(call: DriveCall) {
  async function request(method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT", path: string, body?: unknown): Promise<Response> {
    const allowed = method === "GET" || (method === "POST" && (/\/children$/.test(path) || /:\/createUploadSession$/.test(path)));
    if (!allowed) throw new Error(`${method} ${path} is not allowed: the mirror never deletes, moves or renames`);
    return call(`${GRAPH}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
  }

  async function findFolder(parentId: string, name: string): Promise<string | null> {
    const filter = encodeURIComponent(`name eq '${name.replace(/'/g, "''")}'`);
    const res = await request("GET", `/me/drive/items/${parentId}/children?$filter=${filter}&$select=id,name,folder`);
    if (!res.ok) await fail(res);
    const { value } = (await res.json()) as { value: { id: string; name: string; folder?: unknown }[] };
    return value.find((v) => v.folder)?.id ?? null;
  }

  async function ensureFolder(parentId: string, name: string): Promise<string> {
    const existing = await findFolder(parentId, name);
    if (existing) return existing;
    const res = await request("POST", `/me/drive/items/${parentId}/children`, { name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
    if (res.status === 409) {
      const again = await findFolder(parentId, name);
      if (again) return again;
    }
    if (!res.ok) await fail(res);
    return ((await res.json()) as { id: string }).id;
  }

  async function listFolders(parentId: string | null): Promise<{ id: string; name: string }[]> {
    const res = await request("GET", `/me/drive/${parentId ? `items/${parentId}` : "root"}/children?$select=id,name,folder&$top=999`);
    if (!res.ok) await fail(res);
    const { value } = (await res.json()) as { value: { id: string; name: string; folder?: unknown }[] };
    return value.filter((v) => v.folder).map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A file that already exists with this name is left alone; OneDrive stores ours under a numbered name. */
  async function createUploadSession(parentId: string, fileName: string): Promise<string> {
    const res = await request("POST", `/me/drive/items/${parentId}:/${encodeURIComponent(fileName)}:/createUploadSession`, {
      item: { "@microsoft.graph.conflictBehavior": "rename" },
    });
    if (!res.ok) await fail(res);
    return ((await res.json()) as { uploadUrl: string }).uploadUrl;
  }

  /** The upload address is pre-authorised by OneDrive, so no token is sent with the bytes. */
  async function putChunk(uploadUrl: string, bytes: Uint8Array, start: number, total: number): Promise<{ id?: string }> {
    const res = await call(uploadUrl, {
      method: "PUT",
      headers: { "content-range": `bytes ${start}-${start + bytes.length - 1}/${total}`, "content-length": String(bytes.length) },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) await fail(res);
    return (await res.json().catch(() => ({}))) as { id?: string };
  }

  return { request, findFolder, ensureFolder, listFolders, createUploadSession, putChunk };
}
export type Drive = ReturnType<typeof createDrive>;

export type QueueRow = {
  id: string;
  project_id: string;
  document_id: string | null;
  action: "folder" | "upload";
  status: "pending" | "done" | "failed";
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  upload_url: string | null;
  next_offset: number;
};

export type MirrorDb = {
  /** The chosen library folder, or null while Microsoft 365 is not connected or no folder is chosen. */
  root: () => Promise<{ rootItemId: string } | null>;
  due: (now: Date, limit: number) => Promise<QueueRow[]>;
  project: (id: string) => Promise<{
    id: string;
    project_number: string | null;
    name: string;
    onedrive_folder_id: string | null;
    onedrive_parent_item_id: string | null;
    client: { id: string; name: string; onedrive_folder_id: string | null } | null;
  } | null>;
  document: (id: string) => Promise<{ id: string; section: DocSection; file_name: string; version: number; size_bytes: number; storage_path: string } | null>;
  saveClientFolder: (clientId: string, folderId: string) => Promise<void>;
  saveProjectFolder: (projectId: string, folderId: string) => Promise<void>;
  saveQueue: (id: string, patch: Partial<QueueRow>) => Promise<void>;
  saveDocument: (id: string, patch: { mirror_status?: string; mirror_error?: string | null; onedrive_item_id?: string }) => Promise<void>;
};

export type MirrorDeps = { drive: Drive; storage: { range: (path: string, start: number, end: number) => Promise<Uint8Array> }; db: MirrorDb };

/** Works through due queue rows. `maxChunks` bounds one run; a large file carries on in the next run. */
export async function processQueue(deps: MirrorDeps, now: Date, limits: { maxItems: number; maxChunks: number }) {
  const { drive, storage, db } = deps;
  const out = { done: 0, failed: 0, retried: 0, waiting: 0 };
  const rows = await db.due(now, limits.maxItems);
  const root = await db.root();
  if (!root) return { ...out, waiting: rows.length };
  let chunksLeft = limits.maxChunks;

  async function projectFolder(projectId: string): Promise<string | null> {
    const p = await db.project(projectId);
    if (!p) return null;
    if (p.onedrive_folder_id) return p.onedrive_folder_id;
    let clientFolder = root!.rootItemId;
    if (p.client) {
      clientFolder = p.client.onedrive_folder_id ?? (await drive.ensureFolder(root!.rootItemId, safeFolderName(p.client.name)));
      if (!p.client.onedrive_folder_id) await db.saveClientFolder(p.client.id, clientFolder);
    }
    const id = await drive.ensureFolder(p.onedrive_parent_item_id ?? clientFolder, projectFolderName(p.project_number, p.name));
    await db.saveProjectFolder(p.id, id);
    return id;
  }

  async function handle(row: QueueRow): Promise<"done" | "waiting"> {
    const folderId = await projectFolder(row.project_id);
    if (!folderId) return "done"; // project no longer exists
    if (row.action === "folder") {
      for (const s of SECTIONS) await drive.ensureFolder(folderId, s.label);
      return "done";
    }
    const doc = row.document_id ? await db.document(row.document_id) : null;
    if (!doc) return "done"; // document no longer exists
    let uploadUrl = row.upload_url;
    let offset = uploadUrl ? row.next_offset : 0;
    if (!uploadUrl) {
      const sectionId = await drive.ensureFolder(folderId, sectionFolder(doc.section));
      uploadUrl = await drive.createUploadSession(sectionId, mirrorFileName(doc.file_name, doc.version));
      await db.saveQueue(row.id, { upload_url: uploadUrl, next_offset: 0 });
    }
    let itemId: string | undefined;
    while (offset < doc.size_bytes) {
      if (chunksLeft <= 0) return "waiting";
      const end = Math.min(offset + CHUNK, doc.size_bytes) - 1;
      const bytes = await storage.range(doc.storage_path, offset, end);
      chunksLeft -= 1;
      const res = await drive.putChunk(uploadUrl, bytes, offset, doc.size_bytes);
      offset = end + 1;
      itemId = res.id ?? itemId;
      await db.saveQueue(row.id, { next_offset: offset });
    }
    await db.saveDocument(doc.id, { mirror_status: "done", mirror_error: null, ...(itemId ? { onedrive_item_id: itemId } : {}) });
    return "done";
  }

  for (const row of rows) {
    try {
      const result = await handle(row);
      if (result === "done") {
        await db.saveQueue(row.id, { status: "done", last_error: null, upload_url: null });
        out.done += 1;
      } else out.waiting += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const attempts = row.attempts + 1;
      // An upload session OneDrive no longer recognises has to be started again from the first byte.
      const restart = e instanceof GraphError && [404, 409, 416].includes(e.status) ? { upload_url: null, next_offset: 0 } : {};
      if (attempts >= MAX_ATTEMPTS) {
        await db.saveQueue(row.id, { status: "failed", attempts, last_error: message, ...restart });
        if (row.document_id) await db.saveDocument(row.document_id, { mirror_status: "failed", mirror_error: message });
        out.failed += 1;
      } else {
        await db.saveQueue(row.id, {
          attempts,
          last_error: message,
          next_attempt_at: new Date(now.getTime() + backoffMinutes(attempts) * 60_000).toISOString(),
          ...restart,
        });
        out.retried += 1;
      }
    }
  }
  return out;
}

const COMPANY_WORDS = new Set(["and", "the", "of", "by", "ltd", "inc", "corp", "co", "group", "construction", "contracting", "homes", "builders", "development", "developments", "management", "center", "centre", "client", "clients", "customer", "customers", "custom", "custome", "supply", "only", "one", "time"]);

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** The words that identify a name: lower case, "&" read as "and", company words dropped. */
function nameWords(name: string): string[] {
  const all = name.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
  const kept = all.filter((w) => !COMPANY_WORDS.has(w));
  return kept.length > 0 ? kept : all;
}

/** Same word, allowing one slip in a word of four or more letters and two in seven or more. Typos rarely change the first letter; look-alikes ("Jayne", "Payne") do. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short < 4 || a[0] !== b[0]) return false;
  return editDistance(a, b) <= (short >= 7 ? 2 : 1);
}

export type FolderProposal = { clientId: string; clientName: string; folderId: string; folderName: string; confidence: "exact" | "likely" };

/**
 * Proposes client ↔ existing folder pairs by name. Nothing is saved until an admin confirms.
 * "exact" is the same name ignoring case, punctuation and spacing. "likely" shares a distinctive word with the
 * folder (reordered names, a dropped "Ltd" or "Construction", extra words, a small typo) and is for a person to check.
 */
export function matchClientFolders(
  clients: { id: string; name: string; onedrive_folder_id: string | null }[],
  folders: { id: string; name: string }[],
): FolderProposal[] {
  const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  const taken = new Set(clients.map((c) => c.onedrive_folder_id).filter(Boolean));
  const free = folders.filter((f) => !taken.has(f.id));
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const f of free) byName.set(norm(f.name), [...(byName.get(norm(f.name)) ?? []), f]);

  const exact = new Map<string, FolderProposal>();
  for (const c of clients) {
    if (c.onedrive_folder_id) continue;
    const hits = byName.get(norm(c.name)) ?? [];
    if (hits.length === 1) exact.set(c.id, { clientId: c.id, clientName: c.name, folderId: hits[0]!.id, folderName: hits[0]!.name, confidence: "exact" });
  }
  const exactFolders = new Set([...exact.values()].map((p) => p.folderId));
  const open = free.filter((f) => !exactFolders.has(f.id) && (byName.get(norm(f.name)) ?? []).length === 1).map((f) => ({ ...f, words: nameWords(f.name) }));

  type Cand = { clientId: string; folder: (typeof open)[number]; shared: number; share: number };
  const better = (a: Cand, b: Cand | undefined) => !b || a.shared > b.shared || (a.shared === b.shared && a.share > b.share);
  const level = (a: Cand, b: Cand) => a.shared === b.shared && a.share === b.share;
  const likely = new Map<string, Cand>();
  for (const c of clients) {
    if (c.onedrive_folder_id || exact.has(c.id)) continue;
    const words = nameWords(c.name);
    let best: Cand[] = [];
    for (const f of open) {
      const shared = words.filter((w) => f.words.some((x) => sameWord(w, x)));
      if (shared.length === 0) continue;
      // A short word alone ("Dan") says nothing about whose folder it is, unless it is the whole name on one side ("MRH"); two together ("Ray Wan") do.
      const whole = shared.length === words.length || shared.length === f.words.length;
      if (shared.length < 2 && !whole && !shared.some((w) => w.length >= 4)) continue;
      const cand = { clientId: c.id, folder: f, shared: shared.length, share: shared.length / Math.max(words.length, f.words.length) };
      if (better(cand, best[0])) best = [cand];
      else if (level(cand, best[0]!)) best.push(cand);
    }
    // Two equally good folders: leave it to a person rather than guess.
    if (best.length === 1) likely.set(c.id, best[0]!);
  }
  // A folder is offered only to the client(s) that fit it best; a tie is shown to a person as two rows.
  const topForFolder = new Map<string, Cand>();
  for (const cand of likely.values()) if (better(cand, topForFolder.get(cand.folder.id))) topForFolder.set(cand.folder.id, cand);

  const out: FolderProposal[] = [];
  for (const c of clients) {
    const hit = exact.get(c.id);
    const cand = likely.get(c.id);
    if (hit) out.push(hit);
    else if (cand && level(cand, topForFolder.get(cand.folder.id)!)) out.push({ clientId: c.id, clientName: c.name, folderId: cand.folder.id, folderName: cand.folder.name, confidence: "likely" });
  }
  return out;
}
