/** Shared text formats and sanitisation; PDFs retain their browser reader. */
export type TextStatus = "done" | "no_text";
export type TextKind = "pdf" | "text" | "docx" | "spreadsheet" | "csv" | "none";

export const PAGE_CHARS = 1024 * 1024;
export const TOTAL_CHARS = 3 * 1024 * 1024;

export function textKind(mime: string | null, name: string): TextKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (["xlsx", "xls"].includes(ext) || ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(mime ?? "")) return "spreadsheet";
  if (ext === "csv") return "csv";
  if (mime === "text/plain" || mime === "text/markdown" || ["txt", "md", "markdown"].includes(ext)) return "text";
  return "none";
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Page text as it will be stored: trimmed, control characters removed, capped per page and in total. Page numbers are kept. */
export function cleanPages(raw: string[], pageChars = 20_000): { pages: string[]; status: TextStatus; truncated: boolean } {
  const pages: string[] = [];
  let total = 0;
  let truncated = false;
  for (const p of raw) {
    const text = p.replace(CONTROL, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, pageChars);
    if (total + text.length > TOTAL_CHARS) {
      truncated = true;
      break;
    }
    pages.push(text);
    total += text.length;
  }
  return { pages, status: pages.some((p) => p.length > 0) ? "done" : "no_text", truncated };
}

/** The pages of a document, read in the browser. */
export async function pagesFromFile(file: Blob, mime: string | null, name: string): Promise<{ pages: string[]; status: TextStatus; truncated: boolean }> {
  const kind = textKind(mime, name);
  if (kind === "none") return { pages: [], status: "no_text", truncated: false };
  if (kind === "text") return cleanPages([await file.text()]);
  if (kind !== "pdf") throw new Error("Office files are read by the shared server indexer");
  const { pdfTextPages } = await import("@/lib/estimating/pdf-text");
  return cleanPages(await pdfTextPages(await file.arrayBuffer()));
}

/** A ts_headline snippet split into plain and highlighted parts, so it can be rendered without trusting the HTML. */
export function highlightSnippet(snippet: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  const re = /<b>(.*?)<\/b>/gs;
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), mark: false });
    out.push({ text: m[1] ?? "", mark: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), mark: false });
  return out;
}

export type DocSearchHit = { document_id: string; file_name: string; section: string; version: number; page: number; rank: number; snippet: string };
export type TextBacklogRow = { id: string; file_name: string; section: string; mime: string | null; size_bytes: number; storage_path: string };

/** Enqueue an upload or retry without interrupting the upload on extraction failures. */
export async function indexDocumentFile(documentId: string, file: Blob, mime: string | null, name: string): Promise<TextStatus | "failed"> {
  const { enqueueFile } = await import("./index-queue");
  return enqueueFile("document", documentId, file, mime, name);
}
