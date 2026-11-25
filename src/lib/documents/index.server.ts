import type { SupabaseClient } from "@supabase/supabase-js";
import { extractStoredText } from "./office.server";
import { textKind, type TextStatus } from "./text";

export type IndexTarget = "document" | "knowledge";
// Existing schemas use the project's loose query wrapper in the same way as the indexer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IndexDb = any;
const table = (target: IndexTarget) => target === "document" ? "project_documents" : "knowledge_items";
export async function authorizeIndex(sb: IndexDb, target: IndexTarget, id: string) {
  const { data: row, error } = await sb.from(table(target)).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("File not found or not accessible");
  const permission = target === "document"
    ? await sb.rpc("can_project_documents", { _project: row.project_id, _write: true })
    : await sb.rpc("can_write_knowledge", { _visibility: row.visibility });
  if (permission.error) throw new Error(permission.error.message);
  if (permission.data !== true) throw new Error("Not allowed to index this file");
  return row;
}
export async function saveIndex(admin: IndexDb, target: IndexTarget, id: string, pages: string[], labels: string[] = [], failure: string | null = null) {
  const key = target === "document" ? "document_id" : "item_id";
  const pageTable = target === "document" ? "document_pages" : "knowledge_pages";
  const del = await admin.from(pageTable).delete().eq(key, id);
  if (del.error) throw new Error(del.error.message);
  const rows = pages.map((text, i) => ({ [key]: id, page: i + 1, text, page_label: labels[i] ?? null })).filter((r) => r.text.trim());
  for (let i = 0; i < rows.length; i += 100) {
    const result = await admin.from(pageTable).insert(rows.slice(i, i + 100));
    if (result.error) throw new Error(result.error.message);
  }
  const status: TextStatus | "failed" = failure ? "failed" : rows.length ? "done" : "no_text";
  const patch = { text_status: status, text_pages: pages.length, text_error: failure, ...(target === "document" ? { text_indexed_at: new Date().toISOString() } : { updated_at: new Date().toISOString() }) };
  const result = await admin.from(table(target)).update(patch).eq("id", id);
  if (result.error) throw new Error(result.error.message);
  if (target === "document") {
    try {
      const { scanDocumentScope } = await import("./scope.server");
      await scanDocumentScope(admin, id);
    } catch (e) { console.error("Scope scan failed after indexing", e); }
  }
  return { status, pages: rows.length };
}
/** Uses the stored file, not browser-supplied text or a caller-supplied storage address. */
export async function indexStored(admin: SupabaseClient, target: IndexTarget, row: { id: string; file_name: string; mime: string | null; storage_path: string; size_bytes: number }) {
  const kind = textKind(row.mime, row.file_name);
  try {
    if (kind === "none") return await saveIndex(admin, target, row.id, []);
    if (kind === "pdf") throw new Error("PDF indexing requires the document reader");
    if (row.size_bytes > 50 * 1024 * 1024) throw new Error("Text extraction is limited to 50 MB per file");
    const { data: file, error } = await admin.storage.from(target === "knowledge" ? "knowledge" : "project-documents").download(row.storage_path);
    if (error || !file) throw new Error(error?.message ?? "Could not download file");
    const text = await extractStoredText(file, kind);
    return await saveIndex(admin, target, row.id, text.pages, text.labels);
  } catch (e) {
    return await saveIndex(admin, target, row.id, [], [], (e instanceof Error ? e.message : String(e)).slice(0, 500));
  }
}
