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

/** The text on a page with where it sits, in the same top-left sheet points the viewer and measurements use. */
export async function sheetText(doc: PDFDocumentProxy, pageNumber: number) {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((i): i is typeof i & { str: string; transform: number[]; height: number } => "str" in i && i.str.trim() !== "")
    .map((i) => {
      const [x, y] = vp.convertToViewportPoint(i.transform[4] ?? 0, i.transform[5] ?? 0) as [number, number];
      return { str: i.str, x, y, size: Math.abs(i.height) || Math.hypot(i.transform[0] ?? 0, i.transform[1] ?? 0) };
    });
  return { items, page: { width: vp.width, height: vp.height } };
}
