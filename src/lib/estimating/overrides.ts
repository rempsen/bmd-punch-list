/**
 * In-place editing maths for the Estimate tab: markup ⇄ margin ⇄ sell, order units on a part, and the line-level overrides.
 * Markup % is the source of truth on a line; margin is derived from it. Money is integer cents.
 */
import type { Uom } from "./calc";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Markup m% as a gross margin: m / (100 + m). 35% markup is a 25.93% margin. */
export function markupToMargin(markupPct: number): number {
  if (!(markupPct > -100)) throw new Error("Markup must be above -100%");
  return round2((markupPct / (100 + markupPct)) * 100);
}

/** Margin g% as a markup: g / (100 − g). Margins of 100% or more are impossible. */
export function marginToMarkup(marginPct: number): number {
  if (!(marginPct < 100)) throw new Error("Margin must be below 100%");
  return round2((marginPct / (100 - marginPct)) * 100);
}

export const sellFromCost = (costCents: number, markupPct: number): number => Math.round(costCents * (1 + markupPct / 100));

/** The markup a typed selling price implies. Null when there is no cost to mark up. */
export function markupFromSell(costCents: number, sellCents: number): number | null {
  if (costCents <= 0) return null;
  return round2(((sellCents - costCents) / costCents) * 100);
}

/** A margin typed in an input: a number below 100. Null (with the reason) when it cannot be used. */
export function parseMargin(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(raw.replace(/[%,\s]/g, ""));
  if (raw.trim() === "" || !Number.isFinite(n)) return { ok: false, error: "Enter the margin as a number" };
  if (n >= 100) return { ok: false, error: "Margin must be below 100%" };
  if (n < 0) return { ok: false, error: "Margin cannot be negative" };
  return { ok: true, value: n };
}

/** Units a part can be ordered in, beyond the cost units. */
export const ORDER_UNITS = ["SF", "SY", "LF", "EA", "carton", "box", "roll", "bag", "pail"] as const;

export type OrderPart = {
  /** Price per cost unit, or per order unit when `pricePer` is "order_unit". */
  unitCostCents: number;
  /** How many cost units one order unit holds (24 SF per carton). */
  factor: number;
  pricePer: "cost_unit" | "order_unit";
};

/**
 * A part bought in whole order units. `needQty` is what the line needs in the part's cost unit, waste included.
 * Order qty = ceil(need / factor); cost = order qty × factor × unit cost, or order qty × unit cost when priced per order unit.
 */
export function priceOrderPart(needQty: number, p: OrderPart): { orderQty: number; costUnitQty: number; costCents: number } {
  if (!(p.factor > 0)) throw new Error("One order unit must hold more than zero");
  const orderQty = Math.max(0, Math.ceil(needQty / p.factor - 1e-9));
  const costUnitQty = round2(orderQty * p.factor);
  const costCents = Math.round(p.pricePer === "order_unit" ? orderQty * p.unitCostCents : orderQty * p.factor * p.unitCostCents);
  return { orderQty, costUnitQty, costCents };
}

/** "1 roll = 12 ft × 100 ft" as square yards: width × length ÷ 9. */
export const rollFactorSY = (widthFt: number, lengthFt: number): number => Math.round(((widthFt * lengthFt) / 9) * 100) / 100;

/** A line's cost when its unit cost is typed on the line: quantity × that cost; the parts are then for information only. */
export const overrideCost = (qty: number, unitCostCents: number): number => Math.round(qty * unitCostCents);

/** The parts' cost restated per unit of the line, to show beside a typed line unit cost. */
export const perUnit = (costCents: number, qty: number): number | null => (qty > 0 ? Math.round(costCents / qty) : null);

/** The markup a category shows: its own if set, else the one its un-overridden lines share, else the price's default. */
export function categoryMarkup(section: string, sectionMarkups: Record<string, number>, lines: { section: string; markup_pct: number; markup_overridden?: boolean }[], defaultPct: number): number {
  if (sectionMarkups[section] != null) return sectionMarkups[section]!;
  const follow = lines.filter((l) => l.section === section && !l.markup_overridden).map((l) => l.markup_pct);
  return follow.length > 0 && follow.every((m) => m === follow[0]) ? follow[0]! : defaultPct;
}

/** Lines a category markup applies to: those in it that were not set individually and do not have a selling price typed by hand. */
export const followsCategory = (l: { section: string; markup_overridden?: boolean; price_basis: string }, section: string) => l.section === section && !l.markup_overridden && l.price_basis !== "fixed_sell";

/** A change-history entry's values are the patch it made; reverting applies the "from" patch back to the line or part. */
export type ChangeTarget = { line_id: string | null; component_index: number | null; from_value: unknown };
export function revertPatch<C extends object>(change: ChangeTarget, components: C[]): { line: Record<string, unknown>; components?: C[] } | null {
  const from = change.from_value;
  if (from == null || typeof from !== "object" || Array.isArray(from)) return null;
  if (change.component_index == null) return { line: from as Record<string, unknown> };
  if (change.component_index < 0 || change.component_index >= components.length) return null;
  return { line: {}, components: components.map((c, i) => (i === change.component_index ? { ...c, ...(from as Partial<C>) } : c)) };
}

const money = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
/** One side of a change, for the Changes list: the figure that was typed, or "—" when cleared. */
export function describeValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v !== "object") return String(v);
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, x] of Object.entries(o)) {
    if (k === "markup_overridden" || k === "cost_overridden" || k === "price_basis") continue;
    if (x == null) parts.push(k.endsWith("_cents") ? "cleared" : "—");
    else if (k.endsWith("_cents") && typeof x === "number") parts.push(money(x));
    else if (k.endsWith("_pct") && typeof x === "number") parts.push(`${x}%`);
    else parts.push(String(x));
  }
  return parts.join(" · ") || "—";
}

export type UnitLabel = Uom | string;
