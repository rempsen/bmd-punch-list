/**
 * Turning reviewed import rows into estimate lines. Pure: the review screen and the tests share it, and the
 * database function `commit_estimate_import` saves what it returns.
 *
 * Kept imported: the file's own extended costs are typed onto the line (so the line adds up to the file to the
 * cent) and the line stays priced by its markup. When the file charged a separate materials tax, PST is applied to
 * the material part instead (PST is part of BMD's input cost; lines carry GST only).
 * Matched: the catalogue material or assembly supplies the parts; the imported labour is kept for a bare material.
 */
import { buildComponents, priceEstimateLine, simpleComponent, type CatalogueView, type LineInput, type SnapComponent } from "@/lib/estimating/assemble";
import { convert, type Uom } from "@/lib/estimating/calc";
import { marginToMarkup, markupToMargin } from "@/lib/estimating/overrides";
import type { SaveItem } from "@/lib/estimating/data";
import type { Template } from "@/lib/catalogue/data";
import { UOMS } from "@/lib/catalogue/logic";
import { convertPrice, type Candidate } from "./match";
import type { ImportOptions, ParsedFields, ParsedRow } from "./types";

export type DecisionAction = "keep_imported" | "catalogue" | "new_product" | "skip";
export type Decision = { action: DecisionAction; candidate?: Candidate; keepPrice?: boolean };
export type GroupStrategy = "groups" | "map" | "single";
export type PayloadContext = { options: ImportOptions; category: string; catalogue: CatalogueView; templates: Template[] };

export function categoryFor(group: string | null, mapping: Record<string, string>, strategy: GroupStrategy | string): string {
  if (strategy === "single") return "Imported";
  if (strategy === "map") return mapping[group ?? "General"] || "General";
  return group || "General";
}

/** The imported total against the file's: more than $1 apart needs a person to say so. */
export function reconciliation(sell: number, target: number | null, ack: boolean) {
  const difference = target == null ? 0 : sell - target;
  const required = Math.abs(difference) > 1 + 1e-9;
  return { difference, required, allowed: !required || ack };
}

const cents = (d: number) => Math.round(d * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;

function lineUnit(p: ParsedFields): { qty: number; uom: Uom } {
  if (p.qty == null || !(p.qty > 0)) throw new Error(`${p.description}: a quantity is needed`);
  if (!p.uom || !(UOMS as string[]).includes(p.uom)) throw new Error(`${p.description}: the unit "${p.uom ?? ""}" is not one the estimate uses`);
  return { qty: p.qty, uom: p.uom as Uom };
}

function markupOf(p: ParsedFields, options: ImportOptions): number {
  if (p.markup_pct != null) return p.markup_pct;
  if (p.margin_pct != null && p.margin_pct < 100) return marginToMarkup(p.margin_pct);
  return options.default_markup_pct ?? 35;
}

/** What the file says this line costs, in dollars: material before PST, and labour. Null when the file does not say. */
function fileCosts(p: ParsedFields) {
  const q = p.total_qty ?? p.qty ?? 0;
  const material = p.material_total ?? (p.material_unit_cost != null ? q * p.material_unit_cost : null);
  const labour = p.labour_total ?? (p.labour_unit_cost != null ? (p.qty ?? 0) * p.labour_unit_cost : null);
  return { material, labour };
}

/** What the file sells this line for, including any materials tax it charged separately. */
function fileSell(p: ParsedFields, options: ImportOptions): number | null {
  const sell = p.line_total ?? (p.sell_unit != null && p.qty != null ? p.sell_unit * (p.total_qty ?? p.qty) : null);
  if (sell == null) return null;
  const pct = options.gross_up_pst_pct ?? 0;
  if (!pct) return sell;
  const { material } = fileCosts(p);
  const materialSales = p.material_sales ?? (material ?? 0) * (1 + markupOf(p, options) / 100);
  return sell + materialSales * (pct / 100);
}

const typed = (label: string, kind: "material" | "labour", total: number | null, qty: number, uom: Uom, pst: boolean): SnapComponent => ({
  ...simpleComponent(label, total == null ? null : cents(total), uom, pst),
  kind,
  qty_per_driver: 1 / qty,
  cost_overridden: true,
});

export function payloadPrice(item: SaveItem, rates: { pstPct: number }) {
  const l = item.line;
  const input: LineInput = {
    driver_qty: Number(l.driver_qty ?? 0), driver_uom: (l.driver_uom ?? "SF") as Uom, markup_pct: Number(l.markup_pct ?? 0), price_basis: l.price_basis ?? "markup",
    margin_pct: l.margin_pct ?? null, fixed_sell_cents: l.fixed_sell_cents ?? null, tax_code: l.tax_code ?? "GST", unit_cost_override_cents: l.unit_cost_override_cents ?? null,
  };
  return priceEstimateLine(input, item.components ?? [], rates);
}

export function rowToPayload(row: ParsedRow, decision: Decision, ctx: PayloadContext, rates: { pstPct: number } = { pstPct: 7 }): SaveItem {
  const p = row.parsed;
  if (!p || row.kind !== "item" || decision.action === "skip") throw new Error("This row is not an included item");
  const { qty, uom } = lineUnit(p);
  const markup = markupOf(p, ctx.options);
  const gross = !!ctx.options.gross_up_pst_pct;
  const base = {
    section: ctx.category, kind: "assembly" as const, description: p.description.trim(), notes: p.detail, source: "import" as const,
    markup_pct: markup, margin_pct: r2(markupToMargin(markup)), markup_overridden: true, tax_code: p.taxable === false ? ("EXEMPT" as const) : ("GST" as const),
    price_basis: "markup" as const, fixed_sell_cents: null, unit_cost_override_cents: null,
  };
  const c = decision.candidate;
  const linked = decision.action !== "keep_imported" && !!c;

  if (!linked) {
    const { material, labour } = fileCosts(p);
    const components = [
      ...(material != null || labour == null ? [typed("Material (imported)", "material", material, qty, uom, gross)] : []),
      ...(labour != null ? [typed("Labour (imported)", "labour", labour, qty, uom, false)] : []),
    ].map((x, i) => ({ ...x, sort_order: i + 1 }));
    const item: SaveItem = { line: { ...base, driver_qty: qty, driver_uom: uom, waste_pct: p.waste_pct ?? 0 }, components };
    return keepFileSell(item, fileSell(p, ctx.options), rates);
  }

  const importedLabour = p.labour_unit_cost;
  if (c!.catalogue_item_id) {
    const m = ctx.catalogue.materials[c!.catalogue_item_id];
    if (!m) throw new Error(`${p.description}: ${c!.name} is no longer in the catalogue`);
    if (!m.coverage_per_purchase_unit) {
      try { convert(1, uom, m.cost_uom); } catch { throw new Error(`${p.description}: cannot convert ${uom} to ${m.cost_uom}`); }
    }
    const waste = p.waste_pct ?? m.default_waste_pct;
    const { components: built } = buildComponents({
      template: { driver_uom: uom, default_waste_pct: waste, components: [{ kind: "material", label: m.name, source: "catalogue", catalogue_material_id: m.id, labour_rate_id: null, unit_cost_cents: null, cost_uom: m.cost_uom, qty_per_driver: 1, waste_pct: waste, round_up: false, pst_applies: m.pst_applies, on_gross: false, sort_order: 1 }] },
      finishMaterialId: null, catalogue: ctx.catalogue,
    });
    let mat = built[0]!;
    if (decision.keepPrice && p.material_unit_cost != null) {
      // The file's own extended material cost, carried on the line's unit, so no unit conversion rounds it.
      const material = p.material_total ?? (p.total_qty ?? (p.qty ?? 0) * (1 + (waste ?? 0) / 100)) * p.material_unit_cost;
      const typedMat = typed(m.name, "material", material, qty, uom, gross);
      mat = { ...mat, unit_cost_cents: typedMat.unit_cost_cents, cost_uom: typedMat.cost_uom, purchase_uom: typedMat.purchase_uom, coverage_per_purchase_unit: null, qty_per_driver: typedMat.qty_per_driver, waste_pct: 0, cost_overridden: true, pst_applies: gross };
    }
    // Labour stays the file's extended labour (it may include waste the catalogue line would not add).
    const fileLabour = fileCosts(p).labour;
    const labourPart = fileLabour != null ? typed("Labour (imported)", "labour", fileLabour, qty, uom, false) : importedLabour != null ? { ...simpleComponent("Labour (imported)", cents(importedLabour), uom), kind: "labour" as const, cost_overridden: true } : null;
    const components = [mat, ...(labourPart ? [{ ...labourPart, sort_order: 2 }] : [])];
    const item: SaveItem = { line: { ...base, driver_qty: qty, driver_uom: uom, waste_pct: waste }, components };
    checked(item, p, rates);
    return decision.keepPrice ? keepFileSell(item, fileSell(p, ctx.options), rates) : item;
  }

  const tpl = ctx.templates.find((t) => t.id === c!.assembly_id);
  if (!tpl) throw new Error(`${p.description}: the assembly ${c!.name} is no longer in the catalogue`);
  let driverQty: number;
  try { driverQty = convert(qty, uom, tpl.driver_uom); } catch { throw new Error(`${p.description}: cannot convert ${uom} to ${tpl.driver_uom}`); }
  const { components } = buildComponents({ template: tpl, finishMaterialId: null, catalogue: ctx.catalogue });
  if (decision.keepPrice) {
    // The file's own extended costs on the file's own unit, so converting units and rounding a per-unit price cannot move the total.
    // The material part still points at the assembly's catalogue material.
    const { material, labour } = fileCosts(p);
    const linkedMat = components.find((x) => x.kind === "material" && x.catalogue_material_id);
    const parts = [
      ...(material != null || labour == null ? [{ ...typed(linkedMat?.label ?? "Material (imported)", "material", material, qty, uom, gross), catalogue_material_id: linkedMat?.catalogue_material_id ?? null }] : []),
      ...(labour != null ? [typed("Labour (imported)", "labour", labour, qty, uom, false)] : []),
    ].map((x, i) => ({ ...x, sort_order: i + 1 }));
    const kept: SaveItem = { line: { ...base, driver_qty: qty, driver_uom: uom, waste_pct: p.waste_pct ?? 0 }, components: parts };
    checked(kept, p, rates);
    return keepFileSell(kept, fileSell(p, ctx.options), rates);
  }
  const item: SaveItem = { line: { ...base, driver_qty: r2(driverQty * 10000) / 10000, driver_uom: tpl.driver_uom, waste_pct: tpl.default_waste_pct, unit_cost_override_cents: null }, components };
  return checked(item, p, rates);
}

/** Markup when it reproduces the file's selling price to within 2¢; otherwise the file's price is kept as a fixed sell. */
function keepFileSell(item: SaveItem, want: number | null, rates: { pstPct: number }): SaveItem {
  if (want == null) return item;
  const priced = payloadPrice(item, rates);
  if (Math.abs(priced.sellCents - cents(want)) <= 2) return item;
  return { ...item, line: { ...item.line, price_basis: "fixed_sell", fixed_sell_cents: cents(want) } };
}

function checked(item: SaveItem, p: ParsedFields, rates: { pstPct: number }): SaveItem {
  const priced = payloadPrice(item, rates);
  if (priced.error) throw new Error(`${p.description}: ${/convert/i.test(priced.error) ? priced.error : `cannot price this line (${priced.error})`}`);
  return item;
}
