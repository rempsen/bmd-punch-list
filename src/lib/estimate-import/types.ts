/**
 * Estimate import contract shared by the parser, the review screen and the commit.
 * Add optional fields only; never rename or remove.
 */
export type SourceKind = "xlsx" | "csv" | "pdf";
export type ImportStatus = "parsed" | "reviewing" | "committed" | "discarded";
export type RowKind = "group" | "item" | "total" | "ignored";

/** One sheet (or one rebuilt PDF table) as plain cell text. `pages[i]` is the PDF page of `rows[i]`. */
export type RawTable = { name: string; rows: string[][]; pages?: number[] };

export const MAPPING_FIELDS = [
  "description", "detail", "group_hint", "qty", "uom", "total_qty", "waste_pct", "material_unit_cost",
  "labour_unit_cost", "markup_pct", "margin_pct", "sell_unit", "line_total", "taxable", "colour", "notes",
  // Totals are copied from cells rather than recomputed:
  "cost_waste_pct", "material_total", "material_sales", "labour_total",
] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];
/** Field → zero-based column index in the header row. */
export type Mapping = Partial<Record<MappingField, number>>;

export type ParsedFields = {
  description: string;
  detail: string | null;
  qty: number | null;
  uom: string | null;
  waste_pct: number | null;
  material_unit_cost: number | null;
  labour_unit_cost: number | null;
  markup_pct: number | null;
  margin_pct: number | null;
  sell_unit: number | null;
  taxable: boolean | null;
  colour: string | null;
  // Optional extras (copied cells; null when the file has no such column)
  total_qty?: number | null;
  notes?: string | null;
  material_total?: number | null;
  material_sales?: number | null;
  labour_total?: number | null;
  line_total?: number | null;
};

export type ParsedRow = {
  row_no: number;
  kind: RowKind;
  group_name: string | null;
  /** The source cells, plus sheet name and PDF page when known. */
  raw: { cells: string[]; sheet: string; page?: number };
  parsed: ParsedFields | null;
};

export type CategoryStrategy = "groups" | "single" | "none";
export type ImportOptions = {
  /** PST gross-up on material costs, in percent; null = off. */
  gross_up_pst_pct: number | null;
  default_markup_pct: number | null;
  category_strategy: CategoryStrategy;
};

export type ImportTotals = {
  material_cost: number;
  labour_cost: number;
  total_cost: number;
  sell: number;
  /** Tax added on material sales when gross_up_pst_pct is on, else 0. */
  materials_tax: number;
  sell_with_tax: number;
};

export type ImportSummary = {
  groups: number;
  items: number;
  totals: ImportTotals;
  /** Numbers from the file's own total row, when it has one. */
  file_totals: { material_cost: number | null; labour_cost: number | null; sell: number | null } | null;
  /** A separate materials-tax line found anywhere in the file. */
  materials_tax_detected: { pct: number | null; amount: number | null } | null;
  sheets: string[];
  duplicate_sheets: string[];
  header_row: number;
  /** The header cells as the file has them, for the mapping screen. */
  header?: string[];
  header_signature: string;
  mapping_source: "template" | "heuristic";
  warnings: string[];
};

export type ImportResult = {
  header: string[];
  signature: string;
  mapping: Mapping;
  /** Share (0–1) of the core fields that found a column. */
  mappingConfidence: number;
  options: ImportOptions;
  rows: ParsedRow[];
  summary: ImportSummary;
};

export type ImportTemplate = { id: string; name: string; header_signature: string; mapping: Mapping; options: Partial<ImportOptions>; uses: number };
