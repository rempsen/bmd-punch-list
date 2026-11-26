import { indexStatus } from "@/lib/documents/index-status";
import { buildImport } from "./parse";
import { parseGraberQuote } from "@/lib/estimating/import";
import { pdfTables } from "./pdf-tables";
import type { ImportOptions, ImportResult, ImportTemplate, Mapping } from "./types";

// The project's loose query wrapper, as the document indexer uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
export type PdfImport = { status: "ok"; result: ImportResult } | { status: "needs_index"; message: string };

/** Read a PDF's page text from the document text index and run the same pipeline as spreadsheets. */
export async function importPdfDocument(db: Db, documentId: string, opts: { template?: ImportTemplate | null; mapping?: Mapping; options?: Partial<ImportOptions> } = {}): Promise<PdfImport> {
  const { data: doc, error } = await db.from("project_documents").select("id,file_name,mime,text_status,text_error,text_pages").eq("id", documentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Document not found or not accessible");
  if (doc.text_status !== "done") return { status: "needs_index", message: indexStatus(doc) };
  const { data: pages, error: e2 } = await db.from("document_pages").select("page,text").eq("document_id", documentId).order("page");
  if (e2) throw new Error(e2.message);
  if (!pages?.length) return { status: "needs_index", message: indexStatus({ ...doc, text_status: "no_text" }) };
  const lines = pages.flatMap((p: { text: string }) => p.text.split("\n"));
  const graber = parseGraberQuote(lines);
  if (graber.rows.length) {
    const table = {
      name: "Graber quotation",
      rows: [
        ["Description", "Detail", "Qty", "UoM", "Sell", "Line total"],
        ...graber.rows.map((r) => [r.description, Object.entries(r.attributes).map(([k, v]) => `${k}: ${v}`).join("; "), String(r.qty), r.uom, String(r.sellCents / 100 / r.qty), String(r.sellCents / 100)]),
        ["Total", "", "", "", "", String(graber.sourceTotals.subtotalCents / 100)],
      ],
    };
    const result = buildImport([table], opts);
    result.summary.warnings.push("Graber quotation: costs not stated in the file remain unknown.");
    return { status: "ok", result };
  }
  return { status: "ok", result: buildImport(pdfTables(pages, doc.file_name), opts) };
}
