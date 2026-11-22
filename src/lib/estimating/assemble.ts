/**
 * Turns a catalogue assembly into the component rows stored on an estimate line, and prices those rows.
 * The stored rows are a snapshot: catalogue changes never alter a saved line until Refresh prices is applied.
 * A null unit cost means "not known yet". It is never priced as zero without being reported.
 */
import { convert, priceLine, type Component, type PricedComponent, type TaxCode, type Uom } from "./calc";

export type CatMaterial = {
  id: string;
  name: string;
  cost_uom: Uom;
  unit_cost_cents: number | null;
  purchase_uom: Uom;
  /** How much one purchase unit covers, in `coverage_uom` (23.6 SF per carton, 250 SF per pail). */
  coverage_per_purchase_unit: number | null;
  coverage_uom: Uom | null;
  pst_applies: boolean;
  default_waste_pct: number;
};
export type CatLabour = { id: string; name: string; uom: Uom; unit_cost_cents: number | null };
export type CatalogueView = { materials: Record<string, CatMaterial>; labour: Record<string, CatLabour> };

export type TemplateComponentInput = {
  kind: "material" | "labour" | "fixed";
  label: string;
  source: "finish_material" | "catalogue" | "labour_rate" | "fixed";
  catalogue_material_id: string | null;
  labour_rate_id: string | null;
  unit_cost_cents: number | null;
  cost_uom: Uom | null;
  qty_per_driver: number;
  waste_pct: number | null;
  round_up: boolean;
  pst_applies: boolean;
  on_gross: boolean;
  sort_order: number;
};
export type TemplateInput = { driver_uom: Uom; default_waste_pct: number; components: TemplateComponentInput[] };

export type SnapComponent = {
  kind: "material" | "labour" | "fixed";
  label: string;
  source: "finish_material" | "catalogue" | "labour_rate" | "fixed";
  catalogue_material_id: string | null;
  labour_rate_id: string | null;
  unit_cost_cents: number | null;
  cost_uom: Uom;
  purchase_uom: Uom;
  /** In the line's driving unit. */
  coverage_per_purchase_unit: number | null;
  qty_per_driver: number;
  waste_pct: number;
  round_up: boolean;
  pst_applies: boolean;
  on_gross: boolean;
  /** The cost was typed on the estimate; Refresh prices leaves it alone. */
  cost_overridden: boolean;
  /** Deliberately excluded from this line (no adhesive needed, say); stops it blocking a quote. */
  not_applicable: boolean;
  sort_order: number;
};

export type PriceBasis = "markup" | "margin" | "fixed_sell";
export type LineInput = {
  driver_qty: number;
  driver_uom: Uom;
  markup_pct: number;
  price_basis: PriceBasis;
  margin_pct: number | null;
  fixed_sell_cents: number | null;
  tax_code: TaxCode;
};

const PACKED: Uom[] = ["carton", "roll", "pail", "EA"];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function fits(from: Uom, to: Uom): boolean {
  try {
    convert(1, from, to);
    return true;
  } catch {
    return false;
  }
}

export function buildComponents(input: { template: TemplateInput; finishMaterialId: string | null; catalogue: CatalogueView }): { components: SnapComponent[]; issues: string[] } {
  const { template: t, catalogue } = input;
  const driver = t.driver_uom;
  const issues: string[] = [];
  const base = { cost_overridden: false, not_applicable: false };
  const finish = input.finishMaterialId ? (catalogue.materials[input.finishMaterialId] ?? null) : null;
  const wasteOf = (c: TemplateComponentInput, m: CatMaterial | null) => c.waste_pct ?? (m && m.default_waste_pct > 0 ? m.default_waste_pct : t.default_waste_pct);
  const lineWaste = wasteOf(t.components.find((c) => c.source === "finish_material") ?? ({ waste_pct: null } as TemplateComponentInput), finish);

  const components = [...t.components]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c, i): SnapComponent => {
      const common = { label: c.label, source: c.source, catalogue_material_id: null as string | null, labour_rate_id: null as string | null, qty_per_driver: c.qty_per_driver, on_gross: false, sort_order: i + 1, ...base };

      if (c.source === "finish_material" || c.source === "catalogue") {
        const m = c.source === "finish_material" ? finish : c.catalogue_material_id ? (catalogue.materials[c.catalogue_material_id] ?? null) : null;
        if (!m) {
          issues.push(c.source === "finish_material" ? `${c.label}: no material chosen for this finish.` : `${c.label}: no catalogue item chosen.`);
          return { ...common, kind: "material", unit_cost_cents: null, cost_uom: driver, purchase_uom: driver, coverage_per_purchase_unit: null, waste_pct: wasteOf(c, null), round_up: false, pst_applies: true };
        }
        let coverage: number | null = null;
        if (m.coverage_per_purchase_unit && m.coverage_uom && fits(m.coverage_uom, driver)) coverage = convert(m.coverage_per_purchase_unit, m.coverage_uom, driver);
        if (!coverage && !(fits(driver, m.purchase_uom) && fits(m.purchase_uom, m.cost_uom))) {
          issues.push(`${m.name} is priced per ${m.cost_uom}, which does not fit a line measured in ${driver}.`);
        } else if (m.unit_cost_cents == null) issues.push(`${m.name} has no price yet.`);
        return {
          ...common,
          kind: "material",
          label: m.name,
          catalogue_material_id: m.id,
          unit_cost_cents: m.unit_cost_cents,
          cost_uom: m.cost_uom,
          purchase_uom: m.purchase_uom,
          coverage_per_purchase_unit: coverage,
          waste_pct: wasteOf(c, m),
          round_up: c.round_up && PACKED.includes(m.purchase_uom),
          pst_applies: m.pst_applies,
        };
      }

      if (c.source === "labour_rate") {
        const r = c.labour_rate_id ? (catalogue.labour[c.labour_rate_id] ?? null) : null;
        if (!r) issues.push(`${c.label}: no labour rate chosen.`);
        else if (!fits(driver, r.uom)) issues.push(`${r.name} is paid per ${r.uom}, which does not fit a line measured in ${driver}.`);
        else if (r.unit_cost_cents == null) issues.push(`${r.name} has no cost yet.`);
        return {
          ...common,
          kind: "labour",
          label: r?.name ?? c.label,
          labour_rate_id: r?.id ?? null,
          unit_cost_cents: r?.unit_cost_cents ?? null,
          cost_uom: r?.uom ?? driver,
          purchase_uom: r?.uom ?? driver,
          coverage_per_purchase_unit: null,
          waste_pct: c.on_gross ? lineWaste : 0,
          round_up: false,
          pst_applies: false,
          on_gross: c.on_gross,
        };
      }

      if (c.unit_cost_cents == null) issues.push(`${c.label} has no amount yet.`);
      const uom = c.cost_uom && fits(driver, c.cost_uom) ? c.cost_uom : driver;
      return { ...common, kind: "fixed", unit_cost_cents: c.unit_cost_cents, cost_uom: uom, purchase_uom: uom, coverage_per_purchase_unit: null, waste_pct: 0, round_up: false, pst_applies: c.pst_applies };
    });
  return { components, issues };
}

/** One cost-times-quantity row, for prep, delivery, subcontract, allowance and lump-sum lines. */
export function simpleComponent(label: string, unitCostCents: number | null, uom: Uom, pstApplies = false): SnapComponent {
  return {
    kind: "fixed", label, source: "fixed", catalogue_material_id: null, labour_rate_id: null, unit_cost_cents: unitCostCents, cost_uom: uom, purchase_uom: uom,
    coverage_per_purchase_unit: null, qty_per_driver: 1, waste_pct: 0, round_up: false, pst_applies: pstApplies, on_gross: false, cost_overridden: false, not_applicable: false, sort_order: 1,
  };
}

export const sellFromMarkup = (costCents: number, markupPct: number) => Math.round(costCents * (1 + markupPct / 100));

/** Selling price for a target gross margin: cost ÷ (1 − margin). Not the same as marking up by that percentage. */
export function sellFromMargin(costCents: number, marginPct: number): number {
  if (!(marginPct < 100)) throw new Error("Margin must be below 100%");
  return Math.round(costCents / (1 - marginPct / 100));
}

function toCalc(c: SnapComponent): Component {
  return {
    // A per-unit amount behaves like labour (no waste); with PST it is costed like a material with no waste.
    kind: c.kind === "fixed" ? (c.pst_applies ? "material" : "labour") : c.kind,
    unitCostCents: c.unit_cost_cents ?? 0,
    costUom: c.cost_uom,
    purchaseUom: c.purchase_uom,
    ...(c.coverage_per_purchase_unit ? { coveragePerPurchaseUnit: c.coverage_per_purchase_unit } : {}),
    qtyPerDriver: c.qty_per_driver,
    wastePct: c.waste_pct,
    roundUp: c.round_up,
    pstApplies: c.pst_applies,
    onGross: c.on_gross,
  };
}

export type PricedEstimateLine = {
  costCents: number;
  sellCents: number;
  marginPct: number;
  markupPct: number;
  /** True when a component that applies has no known cost; the cost shown leaves it out. */
  unknown: boolean;
  unknownLabels: string[];
  /** Aligned with the input rows; rows that are not applicable or unknown price as zero. */
  components: PricedComponent[];
  /** Set when the units on a row cannot be worked out; the line cannot be priced until it is fixed. */
  error: string | null;
};

export function priceEstimateLine(line: LineInput, components: SnapComponent[], rates: { pstPct: number }): PricedEstimateLine {
  const live = components.map((c) => !c.not_applicable && c.unit_cost_cents != null);
  const unknownLabels = components.filter((c) => !c.not_applicable && c.unit_cost_cents == null).map((c) => c.label);
  let priced: PricedComponent[] = [];
  let error: string | null = null;
  try {
    const p = priceLine(
      { driverQty: line.driver_qty, driverUom: line.driver_uom, markupPct: 0, taxCode: line.tax_code, components: components.filter((_, i) => live[i]).map(toCalc) },
      rates,
    );
    let k = 0;
    priced = components.map((_, i) => (live[i] ? p.components[k++]! : { purchaseQty: 0, costCents: 0 }));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    priced = components.map(() => ({ purchaseQty: 0, costCents: 0 }));
  }
  const costCents = priced.reduce((s, c) => s + c.costCents, 0);
  const sellCents =
    line.price_basis === "fixed_sell"
      ? (line.fixed_sell_cents ?? 0)
      : line.price_basis === "margin"
        ? sellFromMargin(costCents, line.margin_pct ?? 0)
        : sellFromMarkup(costCents, line.markup_pct);
  return {
    costCents,
    sellCents,
    marginPct: sellCents === 0 ? 0 : round2(((sellCents - costCents) / sellCents) * 100),
    markupPct: costCents === 0 ? 0 : round2(((sellCents - costCents) / costCents) * 100),
    unknown: unknownLabels.length > 0,
    unknownLabels,
    components: priced,
    error,
  };
}

export type PriceChange = { index: number; label: string; fromCents: number | null; toCents: number; overrideKept?: true };

/** What Refresh prices would change. Rows with a hand-entered cost are listed but kept. */
export function refreshDiff(components: SnapComponent[], catalogue: CatalogueView): PriceChange[] {
  const out: PriceChange[] = [];
  components.forEach((c, index) => {
    const current = c.catalogue_material_id ? catalogue.materials[c.catalogue_material_id]?.unit_cost_cents : c.labour_rate_id ? catalogue.labour[c.labour_rate_id]?.unit_cost_cents : undefined;
    if (current == null || current === c.unit_cost_cents) return;
    out.push({ index, label: c.label, fromCents: c.unit_cost_cents, toCents: current, ...(c.cost_overridden ? { overrideKept: true as const } : {}) });
  });
  return out;
}

export function applyRefresh(components: SnapComponent[], changes: PriceChange[]): SnapComponent[] {
  const byIndex = new Map(changes.filter((c) => !c.overrideKept).map((c) => [c.index, c.toCents]));
  return components.map((c, i) => (byIndex.has(i) ? { ...c, unit_cost_cents: byIndex.get(i)! } : c));
}
