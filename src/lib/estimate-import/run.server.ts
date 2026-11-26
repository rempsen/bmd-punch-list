import { nameUnknownColumns } from "./ai";
import { buildImport, parseWorkbook } from "./parse";
import { importPdfDocument } from "./pdf";
import { findTemplate, rememberTemplate } from "./templates";
import type { ImportOptions, ImportResult, ImportSummary, Mapping, SourceKind } from "./types";
import { sourceKindOf as sourceKind } from "./kind";

// The signed-in user's Supabase client; RLS decides what they may read and write.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
export type RunOutcome =
  | { status: "parsed"; importId: string; summary: ImportSummary; mappingConfidence: number }
  | { status: "needs_index"; message: string };

async function loadDocument(db: Db, documentId: string) {
  const { data, error } = await db.from("project_documents").select("id,project_id,file_name,storage_path,size_bytes").eq("id", documentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Document not found or not accessible");
  return data as { id: string; project_id: string; file_name: string; storage_path: string; size_bytes: number };
}

async function requireManage(db: Db, projectId: string) {
  const { data, error } = await db.rpc("has_capability", { _capability: "manage_projects", _project: projectId });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Managing projects is required to import an estimate");
}

type Parse = { status: "ok"; result: ImportResult } | { status: "needs_index"; message: string };
async function parseSource(db: Db, doc: Awaited<ReturnType<typeof loadDocument>>, kind: SourceKind, opts: { mapping?: Mapping; options?: Partial<ImportOptions> }, useTemplate: boolean): Promise<Parse & { templateId?: string | null }> {
  let read: (o: Parameters<typeof buildImport>[1]) => Promise<Parse>;
  if (kind === "pdf") read = (o) => importPdfDocument(db, doc.id, o);
  else {
    if (doc.size_bytes > 25 * 1024 * 1024) throw new Error("Estimate files are limited to 25 MB");
    const { data: file, error } = await db.storage.from("project-documents").download(doc.storage_path);
    if (error || !file) throw new Error(error?.message ?? "Could not download the file");
    const tables = parseWorkbook(new Uint8Array(await file.arrayBuffer()), kind);
    read = async (o) => ({ status: "ok", result: buildImport(tables, o) });
  }
  const first = await read(opts);
  if (first.status !== "ok" || opts.mapping || !useTemplate) return first;
  const template = await findTemplate(db, first.result.signature).catch(() => null);
  if (template) return { ...(await read({ template, options: opts.options ?? {} })), templateId: template.id };
  if (first.result.mappingConfidence < 1) {
    const sample = first.result.rows.filter((r) => r.kind === "item").slice(0, 5).map((r) => r.raw.cells);
    const delta = await nameUnknownColumns(first.result.header, sample, first.result.mapping);
    if (Object.keys(delta).length) return { ...(await read({ mapping: { ...first.result.mapping, ...delta }, options: opts.options ?? {} })), templateId: null };
  }
  return { ...first, templateId: null };
}

const rowRecords = (importId: string, result: ImportResult) =>
  result.rows.map((r) => ({ import_id: importId, row_no: r.row_no, kind: r.kind, group_name: r.group_name, raw: r.raw, parsed: r.parsed, match: { status: "none" } }));

async function insertRows(db: Db, records: unknown[]) {
  for (let i = 0; i < records.length; i += 200) {
    const { error } = await db.from("estimate_import_rows").insert(records.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}

export async function runImport(db: Db, userId: string, input: { projectId: string; documentId: string }): Promise<RunOutcome> {
  const doc = await loadDocument(db, input.documentId);
  if (doc.project_id !== input.projectId) throw new Error("That document belongs to another job");
  await requireManage(db, doc.project_id);
  const kind = sourceKind(doc.file_name);
  const parsed = await parseSource(db, doc, kind, {}, true);
  if (parsed.status !== "ok") return parsed;
  const r = parsed.result;
  const { data: imp, error } = await db.from("estimate_imports").insert({
    project_id: doc.project_id, document_id: doc.id, file_name: doc.file_name, source_kind: kind, status: "parsed", template_id: parsed.templateId ?? null,
    mapping: r.mapping, options: r.options, summary: r.summary, created_by: userId,
  }).select("id").single();
  if (error) throw new Error(error.message);
  try { await insertRows(db, rowRecords(imp.id, r)); }
  catch (e) { await db.from("estimate_imports").delete().eq("id", imp.id); throw e; }
  try {
    const existing = parsed.templateId ? await findTemplate(db, r.signature) : null;
    const templateId = await rememberTemplate(db, { name: doc.file_name, signature: r.signature, mapping: r.mapping, options: { category_strategy: r.options.category_strategy } }, existing);
    if (!parsed.templateId && templateId) await db.from("estimate_imports").update({ template_id: templateId }).eq("id", imp.id);
  } catch (e) { console.error("Saving the import template failed", e); }
  return { status: "parsed", importId: imp.id, summary: r.summary, mappingConfidence: r.mappingConfidence };
}

/** Re-run after the user changes the mapping or options. Every row is read again, so decisions start over. */
export async function reparseImport(db: Db, input: { importId: string; mapping: Mapping; options: Partial<ImportOptions> }): Promise<RunOutcome> {
  const { data: imp, error } = await db.from("estimate_imports").select("id,project_id,document_id,source_kind,status").eq("id", input.importId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!imp) throw new Error("Import not found");
  if (imp.status === "committed" || imp.status === "discarded") throw new Error(`This import is ${imp.status}`);
  if (!imp.document_id) throw new Error("The imported file was removed from Documents");
  await requireManage(db, imp.project_id);
  const doc = await loadDocument(db, imp.document_id);
  const parsed = await parseSource(db, doc, imp.source_kind, { mapping: input.mapping, options: input.options }, false);
  if (parsed.status !== "ok") return parsed;
  const r = parsed.result;
  const del = await db.from("estimate_import_rows").delete().eq("import_id", imp.id);
  if (del.error) throw new Error(del.error.message);
  await insertRows(db, rowRecords(imp.id, r));
  const up = await db.from("estimate_imports").update({ mapping: r.mapping, options: r.options, summary: r.summary, updated_at: new Date().toISOString() }).eq("id", imp.id);
  if (up.error) throw new Error(up.error.message);
  return { status: "parsed", importId: imp.id, summary: r.summary, mappingConfidence: r.mappingConfidence };
}
