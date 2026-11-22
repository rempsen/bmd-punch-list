/** Text of a PDF as lines read left to right, top to bottom. Scanned pages have no text and come back empty. */
export type TextItem = { str: string; transform: number[] };

export function itemsToLines(items: TextItem[]): string[] {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = it.transform[5] ?? 0;
    const row = rows.find((r) => Math.abs(r.y - y) < 3) ?? (rows.push({ y, parts: [] }), rows[rows.length - 1]!);
    row.parts.push({ x: it.transform[4] ?? 0, s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
}

/** The text of each page, in page order. A scanned page comes back as an empty string. */
export async function pdfTextPages(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    out.push(itemsToLines(content.items.filter((i): i is typeof i & TextItem => "str" in i) as TextItem[]).join("\n"));
    page.cleanup();
  }
  return out;
}

export async function pdfTextLines(data: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    out.push(...itemsToLines(content.items.filter((i): i is typeof i & TextItem => "str" in i) as TextItem[]));
  }
  return out;
}
