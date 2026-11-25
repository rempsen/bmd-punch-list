import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import * as XLSX from "xlsx";
import { cleanPages, PAGE_CHARS } from "./text";

export const WORD_SECTION_CHARS = 3000;
export const SHEET_ROWS = 5000;
export type ExtractedText = ReturnType<typeof cleanPages> & { labels: string[] };

/** Split without losing words or paragraphs; even a long unbroken word is bounded. */
export function splitSections(text: string, size = WORD_SECTION_CHARS): string[] {
  const pages: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const edge = Math.max(rest.lastIndexOf("\n", size), rest.lastIndexOf(" ", size));
    const cut = edge > size / 2 ? edge : size;
    pages.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pages.push(rest);
  return pages;
}

type Node = { [key: string]: Node[] | string };
function children(nodes: Node[], tag: string): Node[] | undefined {
  for (const node of nodes) {
    const value = node[tag];
    if (Array.isArray(value)) return value;
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) { const found = children(v, tag); if (found) return found; }
    }
  }
  return undefined;
}
function words(nodes: Node[]): string {
  return nodes.map((node) => Object.entries(node).map(([key, value]) => {
    if (key === "#text") return String(value);
    if (key === "tab") return " ";
    if (key === "br") return "\n";
    return Array.isArray(value) ? words(value) : "";
  }).join("")).join("");
}
function blocks(nodes: Node[]): string[] {
  return nodes.flatMap((node) => Object.entries(node).flatMap(([tag, value]): string[] => {
    if (!Array.isArray(value)) return [];
    if (tag === "p") return [words(value).trim()];
    if (tag === "tbl") return value.flatMap((row) => {
      const cells = row['tr'];
      if (!Array.isArray(cells)) return [];
      return [cells.flatMap((cell) => {
        const contents = cell['tc'];
        return Array.isArray(contents) ? [blocks(contents).filter(Boolean).join(" ")] : [];
      }).join(" | ")];
    });
    return blocks(value);
  }));
}
export async function extractDocx(bytes: ArrayBuffer): Promise<ExtractedText> {
  const zip = await JSZip.loadAsync(bytes);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("Word document has no document.xml content");
  const xml = await doc.async("string");
  if (xml.length > 25 * 1024 * 1024) throw new Error("Word document text exceeds the extraction limit");
  const tree = new XMLParser({ preserveOrder: true, removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: false }).parse(xml) as Node[];
  const text = blocks(children(tree, "body") ?? []).filter(Boolean).join("\n");
  const sections = splitSections(text);
  return { ...cleanPages(sections), labels: sections.map((_, i) => `section ${i + 1} of ${sections.length}`) };
}
export function extractWorkbook(bytes: ArrayBuffer, csv = false): ExtractedText {
  const workbook = XLSX.read(bytes, { type: "array", sheetRows: SHEET_ROWS + 1, cellDates: true, raw: csv });
  const raw: string[] = [];
  const labels: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "", raw: false });
    const nonempty = rows.filter((row) => row.some((cell) => String(cell).trim()));
    const range = sheet['!fullref'] ?? sheet['!ref'];
    const capped = nonempty.length > SHEET_ROWS || (range ? XLSX.utils.decode_range(range).e.r + 1 > SHEET_ROWS : false);
    let text = nonempty.slice(0, SHEET_ROWS).map((row) => row.map((cell) => String(cell).replace(/\r?\n/g, " ")).join(" | ")).join("\n");
    if (capped) text += `\n[Sheet limited to ${SHEET_ROWS} rows.]`;
    if (text.length > PAGE_CHARS) text = text.slice(0, PAGE_CHARS - 90) + "\n[Sheet text truncated at the search page size limit.]";
    raw.push(text);
    labels.push(csv ? "CSV" : `sheet ${name}`);
    if (csv) break;
  }
  const cleaned = cleanPages(raw, PAGE_CHARS);
  return { ...cleaned, labels: labels.slice(0, cleaned.pages.length) };
}

export async function extractStoredText(file: Blob, kind: "docx" | "spreadsheet" | "csv" | "text"): Promise<ExtractedText> {
  if (kind === "docx") return extractDocx(await file.arrayBuffer());
  if (kind === "spreadsheet" || kind === "csv") return extractWorkbook(await file.arrayBuffer(), kind === "csv");
  const pages = splitSections(await file.text());
  return { ...cleanPages(pages), labels: pages.map((_, i) => `section ${i + 1} of ${pages.length}`) };
}
