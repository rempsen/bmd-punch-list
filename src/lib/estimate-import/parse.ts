import * as XLSX from "xlsx";
import { marginToMarkup, markupToMargin } from "@/lib/estimating/overrides";
import { sha1 } from "./sha1";
import { isUomText, normaliseUom } from "./uom";
import type { ImportOptions, ImportResult, ImportSummary, ImportTemplate, ImportTotals, Mapping, MappingField, ParsedFields, ParsedRow, RawTable, RowKind, SourceKind } from "./types";

// ---------- reading files ----------

/** RFC 4180: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseWorkbook(buffer: ArrayBuffer | Uint8Array, kind: Exclude<SourceKind, "pdf">): RawTable[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (kind === "csv") return [{ name: "CSV", rows: parseCsv(new TextDecoder().decode(bytes)) }];
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: "", blankrows: true });
    return { name, rows: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))) };
  });
}

// ---------- header and columns ----------

const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Field → header names, most specific first. The first field to claim a column keeps it. */
const SYNONYMS: [MappingField, string[]][] = [
  ["description", ["cost item", "item", "item name", "product", "description"]],
  ["detail", ["description", "details", "detail", "specification", "spec"]],
  ["group_hint", ["budget code", "cost code", "group", "section"]],
  ["total_qty", ["total quantity", "total qty", "order quantity"]],
  ["qty", ["quantity", "qty"]],
  ["uom", ["uom (quantity)", "uom", "unit", "units", "u/m", "unit of measure"]],
  ["waste_pct", ["material waste", "waste %", "waste"]],
  ["cost_waste_pct", ["waste"]],
  ["labour_unit_cost", ["unit labour cost", "labour unit cost", "unit labor cost", "labor unit cost", "labour rate", "labor rate"]],
  ["material_unit_cost", ["unit cost", "material unit cost", "material cost/unit", "cost/unit", "unit material cost"]],
  ["markup_pct", ["markup", "markup %"]],
  ["margin_pct", ["margin", "margin %"]],
  ["sell_unit", ["unit sales", "unit sell", "sell/unit", "unit price", "sell price"]],
  ["material_total", ["subtotal item cost", "material cost", "material total"]],
  ["material_sales", ["subtotal item sales", "material sales"]],
  ["labour_total", ["labour cost", "labor cost", "labour total", "labor total"]],
  ["line_total", ["total sales", "total sell", "total", "amount", "extended"]],
  ["taxable", ["taxable", "tax"]],
  ["colour", ["colour", "color"]],
  ["notes", ["notes", "note", "comments"]],
];
const KNOWN = new Set(SYNONYMS.flatMap(([, s]) => s));
const CORE: MappingField[] = ["description", "qty", "uom", "material_unit_cost", "labour_unit_cost", "markup_pct", "line_total"];

export function headerSignature(cells: string[]): string {
  return sha1(cells.map(norm).filter(Boolean).join("|"));
}

/** The first row where at least four cells are known header names. */
export function detectHeader(rows: string[][]): { index: number; cells: string[]; signature: string } | null {
  const index = rows.findIndex((r) => r.filter((c) => KNOWN.has(norm(c))).length >= 4);
  if (index < 0) return null;
  const cells = rows[index]!.map((c) => c.trim());
  return { index, cells, signature: headerSignature(cells) };
}

/** Saved template first; otherwise header names, then what the cells look like. */
export function mapColumns(header: string[], template?: Pick<ImportTemplate, "mapping"> | null, sample: string[][] = []): { mapping: Mapping; source: "template" | "heuristic"; confidence: number } {
  if (template) return { mapping: { ...template.mapping }, source: "template", confidence: confidenceOf(template.mapping) };
  const h = header.map(norm);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const [field, names] of SYNONYMS) {
    for (const name of names) {
      const i = h.findIndex((c, idx) => c === name && !used.has(idx));
      if (i >= 0) { mapping[field] = i; used.add(i); break; }
    }
  }
  // Content heuristics for columns the names did not explain.
  const free = h.map((_, i) => i).filter((i) => !used.has(i));
  const share = (i: number, test: (v: string) => boolean) => {
    const vals = sample.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    return vals.length ? vals.filter(test).length / vals.length : 0;
  };
  if (mapping.uom === undefined) {
    const i = free.find((c) => share(c, isUomText) >= 0.6);
    if (i !== undefined) { mapping.uom = i; used.add(i); }
  }
  if (mapping.colour === undefined) {
    const i = free.find((c) => !used.has(c) && share(c, (v) => /^#[0-9a-f]{3,8}$/i.test(v)) >= 0.6);
    if (i !== undefined) mapping.colour = i;
  }
  return { mapping, source: "heuristic", confidence: confidenceOf(mapping) };
}
const confidenceOf = (m: Mapping) => CORE.filter((f) => m[f] !== undefined).length / CORE.length;

// ---------- rows ----------

/** A number copied from a cell; "--", blanks and text are null. */
export function cellNumber(v: string | undefined): number | null {
  const t = (v ?? "").trim().replace(/[$,%\s]/g, "");
  if (!t || t === "--" || t === "-" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}
const cell = (r: string[], m: Mapping, f: MappingField) => (m[f] === undefined ? "" : (r[m[f]!] ?? "").trim());
const num = (r: string[], m: Mapping, f: MappingField) => (m[f] === undefined ? null : cellNumber(r[m[f]!]));
const blank = (r: string[]) => r.every((c) => !c.trim());

export function rowKind(r: string[], m: Mapping, isLast: boolean): RowKind {
  if (blank(r)) return "ignored";
  const desc = cell(r, m, "description");
  if (!desc) return isLast && r.some((c) => cellNumber(c) !== null) ? "total" : "ignored";
  if (cell(r, m, "group_hint").endsWith("?.?")) return "group";
  if (norm(cell(r, m, "uom")) === "mixed") return "group";
  const priced = (["material_unit_cost", "labour_unit_cost", "sell_unit"] as MappingField[]).some((f) => num(r, m, f) !== null);
  if (!priced && num(r, m, "qty") === null) return "group";
  return "item";
}

export function classifyRows(rows: string[][], m: Mapping): RowKind[] {
  let last = rows.length - 1;
  while (last >= 0 && blank(rows[last]!)) last--;
  return rows.map((r, i) => rowKind(r, m, i === last));
}

const yesNo = (v: string): boolean | null => (/^(y|yes|true|1|x)$/i.test(v) ? true : /^(n|no|false|0)$/i.test(v) ? false : null);

export function toParsedRow(r: string[], m: Mapping): ParsedFields {
  let markup = num(r, m, "markup_pct");
  let margin = num(r, m, "margin_pct");
  if (markup === null && margin !== null && margin < 100) markup = marginToMarkup(margin);
  if (margin === null && markup !== null && markup > -100) margin = markupToMargin(markup);
  const waste = num(r, m, "waste_pct") ?? num(r, m, "cost_waste_pct");
  return {
    description: cell(r, m, "description"),
    detail: cell(r, m, "detail") || null,
    qty: num(r, m, "qty"),
    uom: normaliseUom(cell(r, m, "uom")),
    waste_pct: waste,
    material_unit_cost: num(r, m, "material_unit_cost"),
    labour_unit_cost: num(r, m, "labour_unit_cost"),
    markup_pct: markup,
    margin_pct: margin,
    sell_unit: num(r, m, "sell_unit"),
    taxable: m.taxable === undefined ? null : yesNo(cell(r, m, "taxable")),
    colour: cell(r, m, "colour") || null,
    total_qty: num(r, m, "total_qty"),
    notes: cell(r, m, "notes") || null,
    material_total: num(r, m, "material_total"),
    material_sales: num(r, m, "material_sales"),
    labour_total: num(r, m, "labour_total"),
    line_total: num(r, m, "line_total"),
  };
}

// ---------- sheets and totals ----------

const tableHash = (t: RawTable) => sha1(JSON.stringify(t.rows.filter((r) => !blank(r)).map((r) => r.map((c) => c.trim()))));

/** Sheets with identical content are imported once. */
export function dedupeSheets(tables: RawTable[]): { kept: RawTable[]; duplicates: string[] } {
  const seen = new Set<string>();
  const kept: RawTable[] = [], duplicates: string[] = [];
  for (const t of tables) {
    const h = tableHash(t);
    if (seen.has(h)) duplicates.push(t.name);
    else { seen.add(h); kept.push(t); }
  }
  return { kept, duplicates };
}

/** A "Materials tax" / "PST" line anywhere in the file: a percent (≤ 20) and an amount. */
export function findMaterialsTax(tables: RawTable[]): { pct: number | null; amount: number | null } | null {
  for (const t of tables) for (const r of t.rows) {
    if (!r.some((c) => /\b(materials? tax|pst)\b/i.test(c))) continue;
    const nums = r.map(cellNumber).filter((n): n is number => n !== null);
    const pct = nums.find((n) => n > 0 && n <= 20) ?? null;
    const amount = nums.find((n) => n !== pct) ?? null;
    return { pct, amount };
  }
  return null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Item totals copied from their cells (or qty × unit cost when the file has no total column). */
export function importTotals(rows: ParsedRow[], options: Pick<ImportOptions, "gross_up_pst_pct">): ImportTotals {
  const items = rows.filter((r) => r.kind === "item" && r.parsed).map((r) => r.parsed!);
  const qty = (p: ParsedFields) => p.total_qty ?? p.qty ?? 0;
  const material = sum(items.map((p) => p.material_total ?? qty(p) * (p.material_unit_cost ?? 0)));
  const labour = sum(items.map((p) => p.labour_total ?? qty(p) * (p.labour_unit_cost ?? 0)));
  const sell = sum(items.map((p) => p.line_total ?? (p.sell_unit !== null ? qty(p) * p.sell_unit : 0)));
  const materialSales = sum(items.map((p) => p.material_sales ?? (p.material_total ?? qty(p) * (p.material_unit_cost ?? 0)) * (1 + (p.markup_pct ?? 0) / 100)));
  const pct = options.gross_up_pst_pct ?? 0;
  const material_cost = material * (1 + pct / 100);
  const materials_tax = materialSales * (pct / 100);
  return { material_cost, labour_cost: labour, total_cost: material_cost + labour, sell, materials_tax, sell_with_tax: sell + materials_tax };
}

/**
 * The total the imported lines must add up to: the file's own total, plus the materials tax the file charged
 * separately when that tax is being folded into material costs (PST is part of BMD's input cost).
 */
export function fileTarget(summary: Pick<ImportSummary, "file_totals" | "totals">, options: Pick<ImportOptions, "gross_up_pst_pct">): number | null {
  const sell = summary.file_totals?.sell ?? null;
  if (sell == null) return null;
  return sell + (options.gross_up_pst_pct ? summary.totals.materials_tax : 0);
}

// ---------- the pipeline ----------

export const DEFAULT_OPTIONS: ImportOptions = { gross_up_pst_pct: null, default_markup_pct: null, category_strategy: "groups" };

export function buildImport(tables: RawTable[], opts: { template?: ImportTemplate | null; mapping?: Mapping; options?: Partial<ImportOptions> } = {}): ImportResult {
  const { kept, duplicates } = dedupeSheets(tables.filter((t) => t.rows.some((r) => !blank(r))));
  const withHeader = kept.map((t) => ({ t, h: detectHeader(t.rows) })).filter((x) => x.h);
  if (!withHeader.length) throw new Error("Could not find a header row (Description, Quantity, Unit cost…) in this file.");
  const first = withHeader[0]!.h!;
  const warnings: string[] = [];
  const sample = withHeader[0]!.t.rows.slice(first.index + 1, first.index + 30);
  const mapped = opts.mapping ? { mapping: opts.mapping, source: "template" as const, confidence: confidenceOf(opts.mapping) } : mapColumns(first.cells, opts.template, sample);
  const tax = findMaterialsTax(tables);
  const options: ImportOptions = { ...DEFAULT_OPTIONS, ...(opts.template?.options ?? {}), ...(tax?.pct ? { gross_up_pst_pct: tax.pct } : {}), ...(opts.options ?? {}) };
  const rows: ParsedRow[] = [];
  let rowNo = 0;
  for (const { t, h } of withHeader) {
    if (h!.signature !== first.signature) { warnings.push(`Sheet "${t.name}" has different columns and was skipped.`); continue; }
    const body = t.rows.slice(h!.index + 1);
    const kinds = classifyRows(body, mapped.mapping);
    let group: string | null = null;
    body.forEach((cells, i) => {
      const kind = kinds[i]!;
      if (kind === "ignored" && blank(cells)) return;
      const parsed = kind === "ignored" ? null : toParsedRow(cells, mapped.mapping);
      if (kind === "group") group = parsed!.description;
      const page = t.pages?.[h!.index + 1 + i];
      rows.push({ row_no: ++rowNo, kind, group_name: kind === "item" || kind === "group" ? group : null, raw: { cells, sheet: t.name, ...(page ? { page } : {}) }, parsed });
    });
  }
  const totalRow = rows.find((r) => r.kind === "total")?.parsed;
  return {
    header: first.cells, signature: first.signature, mapping: mapped.mapping, mappingConfidence: mapped.confidence, options, rows,
    summary: {
      groups: rows.filter((r) => r.kind === "group").length,
      items: rows.filter((r) => r.kind === "item").length,
      totals: importTotals(rows, options),
      file_totals: totalRow ? { material_cost: totalRow.material_total ?? null, labour_cost: totalRow.labour_total ?? null, sell: totalRow.line_total ?? null } : null,
      materials_tax_detected: tax,
      sheets: kept.map((t) => t.name), duplicate_sheets: duplicates,
      header_row: first.index + 1, header: first.cells, header_signature: first.signature, mapping_source: mapped.source, warnings,
    },
  };
}
