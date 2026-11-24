/**
 * Page text for every project document, so people (and later the assistant) can search inside plans, specs and
 * vendor quotes. Reading happens in the browser: pdf.js already runs there, and the server cannot run it.
 *
 * Later stages: OCR for scanned pages (the takeoff workspace has an on-device engine) and a converter for Word and
 * Excel files. Until then those documents are marked "no text" so they are easy to find.
 */
export type TextStatus = "done" | "no_text";
export type TextKind = "pdf" | "text" | "none";

export const PAGE_CHARS = 20_000;
export const TOTAL_CHARS = 3 * 1024 * 1024;

export function textKind(mime: string | null, name: string): TextKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv" || ["txt", "md", "markdown", "csv"].includes(ext)) return "text";
  return "none";
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Page text as it will be stored: trimmed, control characters removed, capped per page and in total. Page numbers are kept. */
export function cleanPages(raw: string[]): { pages: string[]; status: TextStatus; truncated: boolean } {
  const pages: string[] = [];
  let total = 0;
  let truncated = false;
  for (const p of raw) {
    const text = p.replace(CONTROL, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, PAGE_CHARS);
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
  const { pdfTextPages } = await import("@/lib/estimating/pdf-text");
  return cleanPages(await pdfTextPages(await file.arrayBuffer()));
}

/** A ts_headline snippet split into plain and highlighted parts, so it can be rendered without trusting the HTML. */
export function highlightSnippet(snippet: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  const re = /<b>(.*?)<\/b>/gs;
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index! > last) out.push({ text: snippet.slice(last, m.index), mark: false });
    out.push({ text: m[1] ?? "", mark: true });
    last = m.index! + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), mark: false });
  return out;
}

export type DocSearchHit = { document_id: string; file_name: string; section: string; version: number; page: number; rank: number; snippet: string };
export type TextBacklogRow = { id: string; file_name: string; section: string; mime: string | null; size_bytes: number; storage_path: string };

/**
 * Reads a file's text in the browser and stores it. Never throws: a failure marks the document "failed" so the
 * backlog button can try again later, and the upload that triggered it is unaffected.
 */
export async function indexDocumentFile(documentId: string, file: Blob, mime: string | null, name: string): Promise<TextStatus | "failed"> {
  const { storeDocumentText, markDocumentText } = await import("./text.functions");
  try {
    const r = await pagesFromFile(file, mime, name);
    if (r.status === "no_text") {
      await markDocumentText({ data: { documentId, status: "no_text" } });
      return "no_text";
    }
    const s = await storeDocumentText({ data: { documentId, pages: r.pages, status: r.status } });
    return s.status;
  } catch (e) {
    console.error(`[documents] text of ${name} not indexed: ${e instanceof Error ? e.message : String(e)}`);
    await markDocumentText({ data: { documentId, status: "failed" } }).catch(() => {});
    return "failed";
  }
}
