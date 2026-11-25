// Shared pricing arithmetic for BMD Projects. Used by the estimate worksheet,
// the quotation PDF and the QuickBooks roll-up so all three always agree.
// Money is integer cents. Quantities are rounded to 2 decimals for display.

export type Uom = "SF" | "SY" | "LF" | "EA" | "carton" | "roll" | "pail" | "hour" | "LS";
export type TaxCode = "GST" | "HST" | "EXEMPT" | "ZERO";

export type Component = {
  kind: "material" | "labour" | "fixed";
  /** Price per `costUom`, before PST. */
  unitCostCents: number;
  /** Unit the price is quoted in (e.g. SF, SY, EA, pail). */
  costUom: Uom;
  /** Unit it is bought in (e.g. carton, SY, pail). */
  purchaseUom: Uom;
  /** How many driver units one purchase unit covers (23.6 SF per carton, 250 SF per pail). */
  coveragePerPurchaseUnit?: number;
  /** Quantity of this component per one unit of the line's driving quantity. */
  qtyPerDriver: number;
  wastePct: number;
  /** Round the purchase quantity up to a whole purchase unit. */
  roundUp: boolean;
  /** Add PST to this component's cost (materials bought by BMD). */
  pstApplies: boolean;
  /** Labour only: cost on the quantity including waste instead of the measured quantity. */
  onGross?: boolean;
};

export type Line = {
  driverQty: number;
  driverUom: Uom;
  markupPct: number;
  taxCode: TaxCode;
  components: Component[];
};

const EPS = 1e-9;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const cents = (n: number) => Math.round(n + (n >= 0 ? EPS : -EPS));

export function convert(qty: number, from: Uom, to: Uom): number {
  if (from === to) return qty;
  if (from === "SF" && to === "SY") return qty / 9;
  if (from === "SY" && to === "SF") return qty * 9;
  throw new Error(`Cannot convert ${from} to ${to}`);
}

const MEASURED = new Set(["SF", "SY", "LF", "EA"]);
/**
 * A part with its own quantity: priced in a measured unit that does not convert to the line's (a Schluter edge by the
 * LF on a wall tiled by the SF), with no coverage to size it by. Its quantity is its own, not so much per unit of the line.
 * Kept in step with the database's seed_material_orders.
 */
export function ownQty(driver: string, uom: string | null | undefined, coverage?: number | null): boolean {
  if (!uom || (coverage != null && Number(coverage) > 0) || !MEASURED.has(driver) || !MEASURED.has(uom)) return false;
  try {
    convert(1, driver as Uom, uom as Uom);
    return false;
  } catch {
    return true;
  }
}

export type PricedComponent = { purchaseQty: number; costCents: number };
export type PricedLine = { costCents: number; sellCents: number; marginPct: number; components: PricedComponent[] };

function priceComponent(c: Component, line: Line, pstPct: number): PricedComponent {
  if (c.kind === "fixed") {
    const cost = c.unitCostCents * c.qtyPerDriver * (c.pstApplies ? 1 + pstPct / 100 : 1);
    return { purchaseQty: round2(c.qtyPerDriver), costCents: cents(cost) };
  }
  const applyWaste = c.kind === "material" || c.onGross === true;
  const driverQty = line.driverQty * c.qtyPerDriver * (applyWaste ? 1 + c.wastePct / 100 : 1);

  let purchaseQty: number;
  let costQty: number; // quantity expressed in costUom
  if (c.coveragePerPurchaseUnit && c.coveragePerPurchaseUnit > 0) {
    let packs = driverQty / c.coveragePerPurchaseUnit;
    if (c.roundUp) packs = Math.ceil(packs - EPS);
    purchaseQty = packs;
    costQty = c.costUom === c.purchaseUom ? packs : convert(packs * c.coveragePerPurchaseUnit, line.driverUom, c.costUom);
  } else {
    let q = convert(driverQty, line.driverUom, c.purchaseUom);
    if (c.roundUp) q = Math.ceil(q - EPS);
    purchaseQty = q;
    costQty = convert(q, c.purchaseUom, c.costUom);
  }
  const cost = costQty * c.unitCostCents * (c.pstApplies ? 1 + pstPct / 100 : 1);
  return { purchaseQty: round2(purchaseQty), costCents: cents(cost) };
}

export function priceLine(line: Line, rates: { pstPct: number }): PricedLine {
  if (!(line.driverQty >= 0)) throw new Error("Quantity must be zero or more");
  const components = line.components.map((c) => priceComponent(c, line, rates.pstPct));
  const costCents = components.reduce((s, c) => s + c.costCents, 0);
  const sellCents = cents(costCents * (1 + line.markupPct / 100));
  const marginPct = sellCents === 0 ? 0 : round2(((sellCents - costCents) / sellCents) * 100);
  return { costCents, sellCents, marginPct, components };
}

export type TotalsInput = { sellCents: number; taxCode: TaxCode; costCode: string; section: string };
export type Totals = {
  subtotalCents: number;
  byCostCode: Record<string, number>;
  bySection: Record<string, number>;
  taxByCode: Record<string, number>;
  taxCents: number;
  totalCents: number;
};

/** Tax is calculated per tax code on the summed amounts, the way QuickBooks does it. */
export function totals(lines: TotalsInput[], rates: { gstPct: number; hstPct: number }): Totals {
  const byCostCode: Record<string, number> = {};
  const bySection: Record<string, number> = {};
  const baseByTax: Record<string, number> = {};
  let subtotalCents = 0;
  for (const l of lines) {
    subtotalCents += l.sellCents;
    byCostCode[l.costCode] = (byCostCode[l.costCode] ?? 0) + l.sellCents;
    bySection[l.section] = (bySection[l.section] ?? 0) + l.sellCents;
    baseByTax[l.taxCode] = (baseByTax[l.taxCode] ?? 0) + l.sellCents;
  }
  const rate: Record<string, number> = { GST: rates.gstPct, HST: rates.hstPct, EXEMPT: 0, ZERO: 0 };
  const taxByCode: Record<string, number> = {};
  let taxCents = 0;
  for (const [code, base] of Object.entries(baseByTax)) {
    const t = cents((base * (rate[code] ?? 0)) / 100);
    taxByCode[code] = t;
    taxCents += t;
  }
  return { subtotalCents, byCostCode, bySection, taxByCode, taxCents, totalCents: subtotalCents + taxCents };
}
