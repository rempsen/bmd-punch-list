import { findScopeHits, scansForScope, type ScopeKeyword } from "./scope-keywords";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export async function activeKeywords(admin: Admin): Promise<ScopeKeyword[]> {
  const { data, error } = await admin.from("scope_keywords").select("id,term,group_key,whole_word,active,sort").eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScopeKeyword[];
}

/** Replaces a document's scope hits with what its stored page text holds now. Returns the number of hit rows. */
export async function scanDocumentScope(admin: Admin, documentId: string, keywords?: ScopeKeyword[]): Promise<number> {
  const { data: doc, error } = await admin.from("project_documents").select("id,project_id,section,file_name,text_status").eq("id", documentId).maybeSingle();
  if (error) throw new Error(error.message);
  const del = await admin.from("document_scope_hits").delete().eq("document_id", documentId);
  if (del.error) throw new Error(del.error.message);
  if (!doc || doc.text_status !== "done" || !scansForScope(doc.section, doc.file_name)) return 0;
  const kws = keywords ?? (await activeKeywords(admin));
  const pages: string[] = [];
  for (let from = 0; ; from += 500) {
    const { data: rows, error: e } = await admin.from("document_pages").select("page,text").eq("document_id", documentId).order("page").range(from, from + 499);
    if (e) throw new Error(e.message);
    for (const r of (rows ?? []) as { page: number; text: string }[]) pages[r.page - 1] = r.text;
    if (!rows || rows.length < 500) break;
  }
  const hits = findScopeHits(Array.from(pages, (p) => p ?? ""), kws);
  const rows = hits.map((h) => ({ ...h, document_id: documentId, project_id: doc.project_id }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await admin.from("document_scope_hits").insert(rows.slice(i, i + 500));
    if (e) throw new Error(e.message);
  }
  return rows.length;
}

/** Scans every indexed plan/spec document. Records the result in scope_scan_state. */
export async function scanAllDocuments(admin: Admin): Promise<{ documents: number; hits: number; failed: number }> {
  const kws = await activeKeywords(admin);
  const { data, error } = await admin.from("project_documents").select("id,section,file_name").eq("text_status", "done").in("section", ["plans", "specifications", "other"]);
  if (error) throw new Error(error.message);
  const docs = ((data ?? []) as { id: string; section: string; file_name: string }[]).filter((d) => scansForScope(d.section, d.file_name));
  let hits = 0;
  let failed = 0;
  for (const d of docs) {
    try {
      hits += await scanDocumentScope(admin, d.id, kws);
    } catch (e) {
      failed += 1;
      console.error(`[scope] ${d.file_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await admin.from("scope_scan_state").upsert({ id: true, backfilled_at: new Date().toISOString(), documents: docs.length, hits });
  return { documents: docs.length, hits, failed };
}
