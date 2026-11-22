import type { Uom } from "@/lib/estimating/calc";

export type Category =
  | "carpet_broadloom" | "carpet_tile" | "lvp" | "lvt" | "sheet_vinyl" | "rubber" | "floor_tile" | "wall_tile" | "wall_base"
  | "transitions" | "adhesive" | "underlay" | "prep" | "window_coverings" | "other";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "carpet_broadloom", label: "Carpet (broadloom)" },
  { value: "carpet_tile", label: "Carpet tile" },
  { value: "lvp", label: "LVP" },
  { value: "lvt", label: "LVT" },
  { value: "sheet_vinyl", label: "Sheet vinyl" },
  { value: "rubber", label: "Rubber flooring" },
  { value: "floor_tile", label: "Floor tile" },
  { value: "wall_tile", label: "Wall tile" },
  { value: "wall_base", label: "Wall base" },
  { value: "transitions", label: "Transitions" },
  { value: "adhesive", label: "Adhesive" },
  { value: "underlay", label: "Underlay" },
  { value: "prep", label: "Prep" },
  { value: "window_coverings", label: "Window coverings" },
  { value: "other", label: "Other" },
];
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;

export const UOMS: Uom[] = ["SF", "SY", "LF", "EA", "carton", "roll", "pail", "hour", "LS"];

/** Dollars (as typed or as a number) to cents. Blank, unreadable or negative is unknown: null, never zero. */
export function parseMoneyCents(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "" || !/^\d*\.?\d+$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

const UOM_WORDS: [RegExp, Uom][] = [
  [/^(sf|sq\.?\s*f(ee)?t\.?|sqft|square f(oo|ee)t)$/i, "SF"],
  [/^(sy|sq\.?\s*y(ar)?ds?\.?|sqyd|square yards?)$/i, "SY"],
  [/^(lf|lin\.?\s*f(ee)?t\.?|linear f(oo|ee)t|ft|feet)$/i, "LF"],
  [/^(ea|each|pc|pcs|piece|pieces|unit)$/i, "EA"],
  [/^(ctn|carton|cartons|box|bx|boxes|case)$/i, "carton"],
  [/^(roll|rolls|rl)$/i, "roll"],
  [/^(pail|pails|bucket)$/i, "pail"],
  [/^(hr|hrs|hour|hours)$/i, "hour"],
  [/^(ls|lump\s*sum)$/i, "LS"],
];
export function normaliseUom(v: unknown): Uom | null {
  const s = String(v ?? "").trim();
  return UOM_WORDS.find(([re]) => re.test(s))?.[1] ?? null;
}

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/broadloom/i, "carpet_broadloom"],
  [/carpet\s*tile|modular/i, "carpet_tile"],
  [/carpet/i, "carpet_broadloom"],
  [/\blvp\b|vinyl plank/i, "lvp"],
  [/\blvt\b|vinyl tile/i, "lvt"],
  [/sheet|pvc roll/i, "sheet_vinyl"],
  [/rubber\s*(floor|tile|roll)|^rubber$/i, "rubber"],
  [/wall\s*tile/i, "wall_tile"],
  [/tile|porcelain|ceramic/i, "floor_tile"],
  [/base/i, "wall_base"],
  [/transition|reducer|nosing|molding|moulding/i, "transitions"],
  [/adhesive|glue|mortar|grout|thinset/i, "adhesive"],
  [/underlay|underlayment|pad/i, "underlay"],
  [/prep|patch|level|primer/i, "prep"],
  [/window|shade|blind|drap/i, "window_coverings"],
];
const guessCategory = (v: unknown): Category => CATEGORY_WORDS.find(([re]) => re.test(String(v ?? "")))?.[1] ?? "other";

export type MaterialInput = {
  name: string;
  category: Category;
  manufacturer: string | null;
  product_line: string | null;
  colour: string | null;
  sku: string | null;
  cost_uom: Uom;
  purchase_uom: Uom;
  coverage_per_purchase_unit: number | null;
  /** Unit the coverage is measured in (SF per carton, SF per pail). */
  coverage_uom: Uom | null;
  unit_cost_cents: number | null;
};

const COLS: Record<string, RegExp> = {
  name: /^(product\s*name|name|product|description|item|item\s*name|material)$/i,
  manufacturer: /^(mfr|mfg|manufacturer|brand|make)$/i,
  product_line: /^(product\s*line|line|collection|series|style)$/i,
  colour: /^(colou?r|finish|colou?r\s*name)$/i,
  sku: /^(sku|item\s*#|item\s*no\.?|item\s*number|part\s*#|part\s*number|code|product\s*code)$/i,
  category: /^(category|type|product\s*type|class)$/i,
  uom: /^(uom|unit|units|unit\s*of\s*measure|price\s*unit|per)$/i,
  price: /^(price|cost|unit\s*cost|unit\s*price|net|net\s*price|your\s*price|dealer\s*price)$/i,
  coverage: /^(sf\s*\/\s*(ctn|carton|box)|sf\s*per\s*(ctn|carton|box)|coverage|sq\s*ft\s*\/\s*(ctn|carton|box)|carton\s*size|sf\s*\/\s*pail|sf\s*\/\s*roll)$/i,
};

const text = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Reads a supplier price list. Header wording varies by supplier; rows start at spreadsheet row 2. */
export function parseMaterialRows(rows: Record<string, unknown>[]): { rows: MaterialInput[]; problems: string[] } {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const col = (key: keyof typeof COLS) => headers.find((h) => COLS[key]!.test(h.trim()));
  const nameCol = col("name");
  if (!nameCol) throw new Error("Could not find a product name column. Expected a heading such as Name, Product or Description.");
  const c = { manufacturer: col("manufacturer"), product_line: col("product_line"), colour: col("colour"), sku: col("sku"), category: col("category"), uom: col("uom"), price: col("price"), coverage: col("coverage") };
  const get = (r: Record<string, unknown>, k: string | undefined) => (k ? r[k] : undefined);

  const out: MaterialInput[] = [];
  const problems: string[] = [];
  rows.forEach((r, i) => {
    const name = text(r[nameCol]);
    if (!name) return;
    const at = `Row ${i + 2}: ${name}`;
    const rawUom = text(get(r, c.uom));
    let costUom = normaliseUom(rawUom);
    if (!costUom) {
      if (rawUom) problems.push(`${at} has unit "${rawUom}" which was not recognised; set to each.`);
      costUom = "EA";
    }
    const cover = Number(String(get(r, c.coverage) ?? "").replace(/[^\d.]/g, ""));
    const coverage = Number.isFinite(cover) && cover > 0 ? cover : null;
    const cents = parseMoneyCents(get(r, c.price));
    if (cents == null) problems.push(`${at} has no price; it will be saved as unknown.`);
    out.push({
      name,
      category: guessCategory(get(r, c.category) ?? name),
      manufacturer: text(get(r, c.manufacturer)),
      product_line: text(get(r, c.product_line)),
      colour: text(get(r, c.colour)),
      sku: text(get(r, c.sku)),
      cost_uom: costUom,
      // Priced by area but packed by the carton: the price unit stays, the purchase unit becomes the carton.
      purchase_uom: coverage && (costUom === "SF" || costUom === "SY" || costUom === "LF") ? "carton" : costUom,
      coverage_per_purchase_unit: coverage,
      coverage_uom: coverage ? (costUom === "SY" || costUom === "LF" ? costUom : "SF") : null,
      unit_cost_cents: cents,
    });
  });
  return { rows: out, problems };
}

type ExistingMaterial = { id: string; name: string; sku: string | null; colour: string | null; unit_cost_cents: number | null };

/** New items to add and price differences to review. Existing items are never deleted, and never overwritten without review. */
export function planMaterialImport(incoming: MaterialInput[], existing: ExistingMaterial[]) {
  const key = (s: string | null) => (s ?? "").trim().toLowerCase();
  const bySku = new Map(existing.filter((e) => e.sku).map((e) => [key(e.sku), e]));
  const byName = new Map(existing.map((e) => [`${key(e.name)}|${key(e.colour)}`, e]));
  const inserts: MaterialInput[] = [];
  const priceChanges: { id: string; name: string; fromCents: number | null; toCents: number }[] = [];
  let unchanged = 0;
  for (const m of incoming) {
    const hit = (m.sku ? bySku.get(key(m.sku)) : undefined) ?? byName.get(`${key(m.name)}|${key(m.colour)}`);
    if (!hit) inserts.push(m);
    else if (m.unit_cost_cents != null && m.unit_cost_cents !== hit.unit_cost_cents) {
      priceChanges.push({ id: hit.id, name: hit.name, fromCents: hit.unit_cost_cents, toCents: m.unit_cost_cents });
    } else unchanged += 1;
  }
  return { inserts, priceChanges, unchanged };
}
