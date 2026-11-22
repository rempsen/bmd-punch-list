/** pdf.js, loaded only when a plan is opened so the rest of the app never pays for it. */
import type { PDFDocumentProxy } from "pdfjs-dist";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;
export function pdfjs() {
  return (lib ??= (async () => {
    const m = await import("pdfjs-dist");
    m.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    return m;
  })());
}

const open = new Map<string, Promise<PDFDocumentProxy>>();
/** Opens a PDF by URL, fetching pages as they are needed rather than the whole file. One open document per key. */
export function openPdf(key: string, url: string): Promise<PDFDocumentProxy> {
  let doc = open.get(key);
  if (!doc) {
    doc = pdfjs().then((m) => m.getDocument({ url, rangeChunkSize: 1 << 20, disableAutoFetch: true, disableStream: true }).promise);
    open.set(key, doc);
    doc.catch(() => open.delete(key));
  }
  return doc;
}
