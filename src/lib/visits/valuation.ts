// Work-order valuation, pure: each work-order line is worth quantity × the labour rate it was created with. The rate is
// a snapshot taken when the line is made — the estimate's labour cost per driver unit when the estimate line has labour,
// else the catalogue's labour rate for the cost code — and a saved line keeps its rate when it is re-saved, whatever the
// estimate or catalogue say since. A blank rate stays null, never 0.
import { priceLine, type Component, type Uom } from "@/lib/estimating/calc";
import { rateFor, type LabourRate } from "@/lib/subcontract/logic";
import { num, type VisitLine } from "./lines";

export type LabourRateSource = "estimate" | "catalogue" | "manual";

/** A labour component of an estimate line as `work_order_items` returns it (null for people without view_pricing). */
export type LabourComponent = {
  unit_cost_cents: number | string | null;
  cost_uom: string;
  purchase_uom: string;
  coverage_per_purchase_unit?: number | string | null;
  qty_per_driver: number | string;
  waste_pct?: number | string | null;
  round_up?: boolean | null;
  on_gross?: boolean | null;
  labour_rate_id?: string | null;
};

/** The part of an estimate item the valuation reads. */
export type EstimateLabour = {
  estimate_line_id: string;
  quantity: number | string | null;
  uom: string | null;
  cost_code?: string | null;
  labour_components?: LabourComponent[] | null;
  labour_rate_id?: string | null;
};

/** The three valuation columns of an `install_visit_lines` row. */
export type LineValuation = {
  unit_labour_cost_cents: number | null;
  labour_rate_source: LabourRateSource | null;
  labour_rate_id: string | null;
};

export type ValuedLine = VisitLine & Partial<LineValuation> & { clear_manual?: boolean };

export const SOURCE_LABEL: Record<LabourRateSource, string> = { estimate: "from estimate", catalogue: "catalogue rate", manual: "entered" };

const toCalc = (c: LabourComponent): Component => ({
  kind: "labour",
  unitCostCents: num(c.unit_cost_cents),
  costUom: c.cost_uom as Uom,
  purchaseUom: c.purchase_uom as Uom,
  ...(num(c.coverage_per_purchase_unit) > 0 ? { coveragePerPurchaseUnit: num(c.coverage_per_purchase_unit) } : {}),
  qtyPerDriver: num(c.qty_per_driver),
  wastePct: num(c.waste_pct),
  roundUp: !!c.round_up,
  pstApplies: false,
  onGross: !!c.on_gross,
});

/**
 * The estimate line's labour cost for its whole quantity, with the estimate's own arithmetic (priceLine in
 * src/lib/estimating/calc.ts: unit conversion, coverage, waste paid on gross). Null when the line has no labour with a
 * known cost, or when its units cannot be converted.
 */
export function estimateLabourCostCents(item: EstimateLabour, quantity = num(item.quantity)): number | null {
  const parts = (item.labour_components ?? []).filter((c) => c.unit_cost_cents !== null && c.unit_cost_cents !== undefined && c.unit_cost_cents !== "");
  if (!parts.length || !item.uom) return null;
  try {
    return priceLine({ driverQty: quantity, driverUom: item.uom as Uom, markupPct: 0, taxCode: "GST", components: parts.map(toCalc) }, { pstPct: 0 }).costCents;
  } catch {
    return null;
  }
}

/**
 * The estimate's labour cost per one unit of the line's quantity (per SF, SY, LF…), in whole cents: the labour cost of
 * the estimated quantity divided by it, so waste paid on gross is spread evenly; priced for one unit when the estimate
 * has no quantity. Null when the line has no labour component with a cost.
 */
export function estimateLabourUnitCents(item: EstimateLabour): number | null {
  const qty = num(item.quantity);
  const total = estimateLabourCostCents(item, qty > 0 ? qty : 1);
  if (total === null) return null;
  return Math.round(total / (qty > 0 ? qty : 1));
}

const RATE_UOMS = new Set(["SF", "SY", "LF", "EA", "carton", "roll", "pail", "hour", "LS"]);

/** The catalogue's rate for a line, converted to the line's unit when the two differ by SF ↔ SY; null when it cannot be. */
function catalogueUnitCents(line: Pick<VisitLine, "cost_code" | "uom">, rates: LabourRate[]): { cents: number; id: string } | null {
  const r = rateFor({ cost_code: line.cost_code ?? null, uom: line.uom }, rates);
  if (!r || r.unit_cost_cents === null) return null;
  const from = (r.uom ?? "").trim() as Uom;
  const to = (line.uom ?? "").trim() as Uom;
  if (from === to || !RATE_UOMS.has(from) || !RATE_UOMS.has(to)) return { cents: r.unit_cost_cents, id: r.id };
  if (from === "SY" && to === "SF") return { cents: Math.round(r.unit_cost_cents / 9), id: r.id };
  if (from === "SF" && to === "SY") return { cents: r.unit_cost_cents * 9, id: r.id };
  return null;
}

/** The valuation for a new line: the estimate's labour rate when it has one, else the catalogue's by cost code, else nothing. */
export function valuationFor(line: Pick<VisitLine, "estimate_line_id" | "cost_code" | "uom">, items: EstimateLabour[], rates: LabourRate[]): LineValuation {
  const item = line.estimate_line_id ? items.find((i) => i.estimate_line_id === line.estimate_line_id) : undefined;
  if (item) {
    const cents = estimateLabourUnitCents(item);
    if (cents !== null)
      return { unit_labour_cost_cents: cents, labour_rate_source: "estimate", labour_rate_id: item.labour_rate_id ?? item.labour_components?.find((c) => c.labour_rate_id)?.labour_rate_id ?? null };
  }
  const cat = catalogueUnitCents({ cost_code: line.cost_code ?? item?.cost_code ?? null, uom: line.uom }, rates);
  if (cat) return { unit_labour_cost_cents: cat.cents, labour_rate_source: "catalogue", labour_rate_id: cat.id };
  return { unit_labour_cost_cents: null, labour_rate_source: null, labour_rate_id: null };
}

const hasRate = (l: Partial<LineValuation> | undefined): l is LineValuation & { unit_labour_cost_cents: number } =>
  !!l && typeof l.unit_labour_cost_cents === "number" && Number.isFinite(l.unit_labour_cost_cents) && l.unit_labour_cost_cents >= 0;

/**
 * The lines of a work order as they are to be saved. A line already saved (matched by id) keeps its stored rate; a rate
 * entered by pricing staff stays as entered (source "manual") when `canPrice`, and a line they cleared ("Use estimate
 * rate", `clear_manual`) is valued again from the estimate, then the catalogue; every other line gets the rate the
 * estimate or catalogue gives it now. Rates typed or cleared without view_pricing are ignored.
 */
export function valueLines(
  lines: ValuedLine[],
  ctx: { saved: (Pick<VisitLine, "id"> & Partial<LineValuation>)[]; items: EstimateLabour[]; rates: LabourRate[]; canPrice: boolean },
): (VisitLine & LineValuation)[] {
  const savedById = new Map(ctx.saved.filter((s) => s.id).map((s) => [s.id!, s]));
  return lines.map((l) => {
    const { unit_labour_cost_cents: given, labour_rate_source: givenSource, labour_rate_id: givenId, clear_manual, ...rest } = l;
    if (ctx.canPrice && clear_manual) return { ...rest, ...valuationFor(l, ctx.items, ctx.rates) };
    if (ctx.canPrice && givenSource === "manual" && hasRate({ unit_labour_cost_cents: given ?? null }))
      return { ...rest, unit_labour_cost_cents: Math.round(given!), labour_rate_source: "manual", labour_rate_id: null };
    const was = l.id ? savedById.get(l.id) : undefined;
    if (hasRate(was)) return { ...rest, unit_labour_cost_cents: was.unit_labour_cost_cents, labour_rate_source: was.labour_rate_source ?? null, labour_rate_id: was.labour_rate_id ?? null };
    void givenId;
    return { ...rest, ...valuationFor(l, ctx.items, ctx.rates) };
  });
}

/** quantity × rate in whole cents; null when the line has no rate. */
export function lineValueCents(line: Pick<VisitLine, "quantity"> & Pick<LineValuation, "unit_labour_cost_cents">): number | null {
  if (line.unit_labour_cost_cents === null || line.unit_labour_cost_cents === undefined) return null;
  return Math.round(line.unit_labour_cost_cents * num(line.quantity));
}

/** What a work order pays its installer: the costed lines added up, and how many lines have no rate yet. */
export function installerPay(lines: (Pick<VisitLine, "quantity"> & Partial<Pick<LineValuation, "unit_labour_cost_cents">>)[]): { total_cents: number; uncosted: number } {
  let total = 0;
  let uncosted = 0;
  for (const l of lines) {
    const v = lineValueCents({ quantity: l.quantity, unit_labour_cost_cents: l.unit_labour_cost_cents ?? null });
    if (v === null) uncosted++;
    else total += v;
  }
  return { total_cents: total, uncosted };
}

/** The approved estimate's whole labour cost, for the budget line on Install Plus; null when nothing on it has priced labour. */
export function estimateLabourTotalCents(items: EstimateLabour[]): number | null {
  let total: number | null = null;
  for (const i of items) {
    const c = estimateLabourCostCents(i);
    if (c !== null) total = (total ?? 0) + c;
  }
  return total;
}

/** "n lines uncosted" / "1 line uncosted" for the total row. */
export const uncostedText = (n: number) => (n === 0 ? "" : `${n} ${n === 1 ? "line" : "lines"} uncosted`);

/**
 * "Installer pay to date: $2,875 of $14,375 estimated labour (20%)" for Install Plus; without a priced estimate just the
 * pay so far, and the uncosted count when any work-order line still has no rate.
 */
export function labourBudgetLine(releasedCents: number, uncosted: number, estimateLabourCents: number | null): string {
  const dollars = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  let s = `Installer pay to date: ${dollars(releasedCents)}`;
  if (estimateLabourCents !== null && estimateLabourCents > 0) s += ` of ${dollars(estimateLabourCents)} estimated labour (${Math.round((releasedCents / estimateLabourCents) * 100)}%)`;
  else if (estimateLabourCents === null) s += " · estimate has no priced labour";
  if (uncosted > 0) s += ` · ${uncostedText(uncosted)}`;
  return s;
}
