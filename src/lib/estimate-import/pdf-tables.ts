import type { RawTable } from "./types";

/**
 * Rebuild a table from PDF page text. The text index keeps one line per text row (y-row clustering already
 * happened when the page was read) but not x positions, so columns are rebuilt from the header: the header's
 * known names give the column count, each data line's trailing value-like tokens fill the right-hand columns,
 * and the leading words are the first column.
 */
const HEADER_NAMES = [
  "cost item", "description", "colour", "color", "budget code", "quantity", "qty", "uom", "unit", "total quantity",
  "material waste", "unit cost", "waste", "subtotal item cost", "margin", "markup", "unit sales", "unit price",
  "subtotal item sales", "profit", "unit labour cost", "labour cost", "labor cost", "total sales", "total", "amount", "notes", "taxable",
].sort((a, b) => b.length - a.length);
const PAIRS = /\b(sq|lin|square|linear)\.? (ft|yd|feet|yards?)\b/gi;
const VALUE = /^(--|\$|[-+]?\$?[\d,]*\.?\d+%?|yes|no|#[0-9a-f]{3,8}|sf|sy|lf|ea|ft|each|mixed|roll|bag|carton|box|sq_ft|sq_yd|lin_ft|square_feet|linear_feet|square_yards?|\?\.\?|\?\.\*)$/i;

function headerCells(line: string): string[] | null {
  const lower = line.toLowerCase();
  const found: { at: number; name: string }[] = [];
  const taken: [number, number][] = [];
  for (const name of HEADER_NAMES) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(name, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + name.length;
      const wordEdge = (at === 0 || /\W/.test(lower[at - 1]!)) && (end === lower.length || /\W/.test(lower[end]!));
      if (wordEdge && !taken.some(([s, e]) => at < e && end > s)) { found.push({ at, name: line.slice(at, end) }); taken.push([at, end]); }
    }
  }
  return found.length >= 4 ? found.sort((a, b) => a.at - b.at).map((f) => f.name) : null;
}

function dataCells(line: string, width: number): string[] {
  const tokens = line.replace(PAIRS, (_m, a: string, b: string) => `${a}_${b}`).split(/\s+/).filter(Boolean);
  const tail: string[] = [];
  while (tokens.length > 1 && tail.length < width - 1 && VALUE.test(tokens[tokens.length - 1]!)) tail.unshift(tokens.pop()!);
  const lead = tokens.join(" ");
  const cells = [lead, ...Array(Math.max(0, width - 1 - tail.length)).fill(""), ...tail].map((c) => c.replace(/_/g, " "));
  return cells.slice(0, width);
}

export function pdfTables(pages: { page: number; text: string }[], name = "PDF"): RawTable[] {
  const rows: string[][] = [], pageOf: number[] = [];
  let width = 0;
  for (const p of pages) for (const line of p.text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const header = headerCells(t);
    if (header && !width) { width = header.length; rows.push(header); pageOf.push(p.page); continue; }
    if (header) continue; // repeated header on later pages
    rows.push(width ? dataCells(t, width) : [t]);
    pageOf.push(p.page);
  }
  return [{ name, rows, pages: pageOf }];
}
