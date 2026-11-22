import { describe, expect, test } from "bun:test";
import { applyRefresh, buildComponents, priceEstimateLine, refreshDiff, sellFromMargin, sellFromMarkup, simpleComponent, type CatalogueView, type LineInput, type SnapComponent } from "./assemble";
import { priceLine } from "./calc";

const rates = { pstPct: 7 };
const cat = (): CatalogueView => ({
  materials: {
    lvp: { id: "lvp", name: "Dante Pro", cost_uom: "SF", unit_cost_cents: 250, purchase_uom: "carton", coverage_per_purchase_unit: 23.6, coverage_uom: "SF", pst_applies: true, default_waste_pct: 10 },
    glue: { id: "glue", name: "Eco 373", cost_uom: "pail", unit_cost_cents: 8900, purchase_uom: "pail", coverage_per_purchase_unit: 250, coverage_uom: "SF", pst_applies: true, default_waste_pct: 5 },
    cpt: { id: "cpt", name: "Formworks", cost_uom: "SY", unit_cost_cents: 3200, purchase_uom: "SY", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 8 },
    shade: { id: "shade", name: "Roller W1", cost_uom: "EA", unit_cost_cents: 31000, purchase_uom: "EA", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 0 },
    nopx: { id: "nopx", name: "Mystery Tile", cost_uom: "SF", unit_cost_cents: null, purchase_uom: "SF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 10 },
    base: { id: "base", name: "Rubber Base 4in", cost_uom: "LF", unit_cost_cents: 120, purchase_uom: "LF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 5 },
  },
  labour: {
    ilvp: { id: "ilvp", name: "Install LVP", uom: "SF", unit_cost_cents: 175 },
    icpt: { id: "icpt", name: "Install carpet", uom: "SY", unit_cost_cents: 650 },
    iwin: { id: "iwin", name: "Install window covering", uom: "EA", unit_cost_cents: 4500 },
    tbd: { id: "tbd", name: "Install rubber", uom: "SF", unit_cost_cents: null },
  },
});
const tc = (o: Partial<Parameters<typeof buildComponents>[0]["template"]["components"][number]>) => ({
  kind: "material" as const, label: "Material", source: "finish_material" as const, catalogue_material_id: null, labour_rate_id: null, unit_cost_cents: null, cost_uom: null,
  qty_per_driver: 1, waste_pct: null, round_up: true, pst_applies: false, on_gross: false, sort_order: 1, ...o,
});
const lvpTemplate = {
  driver_uom: "SF" as const,
  default_waste_pct: 5,
  components: [tc({}), tc({ label: "Adhesive", source: "catalogue", catalogue_material_id: "glue", sort_order: 2 }), tc({ kind: "labour", label: "Install LVP", source: "labour_rate", labour_rate_id: "ilvp", sort_order: 3 })],
};
const line = (o: Partial<LineInput> = {}): LineInput => ({ driver_qty: 1000, driver_uom: "SF", markup_pct: 30, price_basis: "markup", margin_pct: null, fixed_sell_cents: null, tax_code: "GST", ...o });

describe("buildComponents", () => {
  test("LVP assembly: carton-packed material, pail adhesive with its own coverage and waste, labour on the measured area", () => {
    const { components, issues } = buildComponents({ template: lvpTemplate, finishMaterialId: "lvp", catalogue: cat() });
    expect(issues).toEqual([]);
    expect(components.map((c) => [c.label, c.kind, c.unit_cost_cents, c.cost_uom, c.purchase_uom, c.coverage_per_purchase_unit, c.waste_pct, c.round_up, c.pst_applies])).toEqual([
      ["Dante Pro", "material", 250, "SF", "carton", 23.6, 10, true, true],
      ["Eco 373", "material", 8900, "pail", "pail", 250, 5, true, true],
      ["Install LVP", "labour", 175, "SF", "SF", null, 0, false, false],
    ]);
    const priced = priceEstimateLine(line(), components, rates);
    // 47 cartons x 23.6 SF x $2.50 +7% = 2967.11; 5 pails (1050 SF / 250 → 4.2 → 5) x $89 +7% = 476.15; labour 1000 x $1.75 = 1750.00
    expect(priced.costCents).toBe(296711 + 47615 + 175000);
    expect(priced.unknown).toBe(false);
    expect(priced.sellCents).toBe(Math.round(priced.costCents * 1.3));
  });

  test("broadloom measured in SF, bought and installed by the SY, is not rounded to a pack", () => {
    const t = { driver_uom: "SF" as const, default_waste_pct: 8, components: [tc({}), tc({ kind: "labour", label: "Install", source: "labour_rate", labour_rate_id: "icpt", sort_order: 2 })] };
    const { components } = buildComponents({ template: t, finishMaterialId: "cpt", catalogue: cat() });
    expect(components[0]).toMatchObject({ round_up: false, purchase_uom: "SY", waste_pct: 8 });
    const priced = priceEstimateLine(line({ driver_qty: 4500, markup_pct: 0 }), components, rates);
    expect(priced.components[0]!.purchaseQty).toBe(540);
    expect(priced.costCents).toBe(Math.round(540 * 3200 * 1.07) + 500 * 650);
  });

  test("carton coverage quoted in another unit is converted to the line's unit", () => {
    const c = cat();
    c.materials["lvp"] = { ...c.materials["lvp"]!, coverage_per_purchase_unit: 2.6222, coverage_uom: "SY" };
    const { components } = buildComponents({ template: lvpTemplate, finishMaterialId: "lvp", catalogue: c });
    expect(components[0]!.coverage_per_purchase_unit).toBeCloseTo(23.6, 3);
  });

  test("window coverings: vendor piece with PST, install and a per-piece charge without", () => {
    const t = {
      driver_uom: "EA" as const,
      default_waste_pct: 0,
      components: [tc({}), tc({ kind: "labour", label: "Install", source: "labour_rate", labour_rate_id: "iwin", sort_order: 2 }), tc({ kind: "fixed", label: "Delivery and staging", source: "fixed", unit_cost_cents: 1200, cost_uom: "EA", sort_order: 3 })],
    };
    const { components, issues } = buildComponents({ template: t, finishMaterialId: "shade", catalogue: cat() });
    expect(issues).toEqual([]);
    const priced = priceEstimateLine(line({ driver_qty: 40, driver_uom: "EA", markup_pct: 35 }), components, rates);
    expect(priced.costCents).toBe(1554800);
    expect(priced.sellCents).toBe(2098980);
  });

  test("unknown prices stay unknown and are reported, never priced as zero silently", () => {
    const t = { driver_uom: "SF" as const, default_waste_pct: 5, components: [tc({}), tc({ label: "Adhesive", source: "catalogue", sort_order: 2 }), tc({ kind: "labour", label: "Install rubber", source: "labour_rate", labour_rate_id: "tbd", sort_order: 3 })] };
    const { components, issues } = buildComponents({ template: t, finishMaterialId: "nopx", catalogue: cat() });
    expect(components.map((c) => c.unit_cost_cents)).toEqual([null, null, null]);
    expect(issues).toEqual(["Mystery Tile has no price yet.", "Adhesive: no catalogue item chosen.", "Install rubber has no cost yet."]);
    const priced = priceEstimateLine(line(), components, rates);
    expect(priced.unknown).toBe(true);
    expect(priced.unknownLabels).toEqual(["Mystery Tile", "Adhesive", "Install rubber"]);
  });

  test("a component marked not applicable is left out and no longer blocks", () => {
    const { components } = buildComponents({ template: { driver_uom: "SF", default_waste_pct: 5, components: [tc({}), tc({ label: "Adhesive", source: "catalogue", sort_order: 2 })] }, finishMaterialId: "lvp", catalogue: cat() });
    components[1]!.not_applicable = true;
    const priced = priceEstimateLine(line({ markup_pct: 0 }), components, rates);
    expect(priced.unknown).toBe(false);
    expect(priced.costCents).toBe(296711);
  });

  test("a material that cannot be measured in the line's unit is reported", () => {
    const { issues } = buildComponents({ template: { driver_uom: "SF", default_waste_pct: 5, components: [tc({})] }, finishMaterialId: "base", catalogue: cat() });
    expect(issues).toEqual(["Rubber Base 4in is priced per LF, which does not fit a line measured in SF."]);
  });

  test("no finish material chosen is reported", () => {
    const { issues, components } = buildComponents({ template: lvpTemplate, finishMaterialId: null, catalogue: cat() });
    expect(issues[0]).toBe("Material: no material chosen for this finish.");
    expect(components[0]!.unit_cost_cents).toBeNull();
  });
});

describe("price basis", () => {
  const comps: SnapComponent[] = [simpleComponent("Subcontract", 100000, "LS")];
  test("markup and margin are different sums and both are reported", () => {
    expect(sellFromMarkup(100000, 35)).toBe(135000);
    expect(sellFromMargin(100000, 35)).toBe(153846);
    expect(Math.abs(sellFromMargin(100000, 25.9259) - sellFromMarkup(100000, 35))).toBeLessThanOrEqual(1);
    const byMargin = priceEstimateLine(line({ driver_qty: 1, driver_uom: "LS", price_basis: "margin", margin_pct: 25 }), comps, rates);
    expect(byMargin.sellCents).toBe(133333);
    expect(byMargin.marginPct).toBe(25);
    expect(byMargin.markupPct).toBeCloseTo(33.33, 2);
  });
  test("a margin of 100% or more is refused", () => expect(() => sellFromMargin(100, 100)).toThrow());
  test("a fixed selling price is kept whatever the cost, markup or waste", () => {
    const fixed = line({ driver_qty: 1, driver_uom: "LS", price_basis: "fixed_sell", fixed_sell_cents: 2487525, markup_pct: 99 });
    expect(priceEstimateLine(fixed, comps, rates).sellCents).toBe(2487525);
    expect(priceEstimateLine(fixed, [simpleComponent("Subcontract", 999999, "LS")], rates).sellCents).toBe(2487525);
    expect(priceEstimateLine(fixed, [simpleComponent("Unknown cost", null, "LS")], rates)).toMatchObject({ sellCents: 2487525, unknown: true });
  });
});

describe("saved lines and catalogue changes", () => {
  test("changing a catalogue price does not change a saved line until Refresh prices is applied", () => {
    const catalogue = cat();
    const { components } = buildComponents({ template: lvpTemplate, finishMaterialId: "lvp", catalogue });
    const before = priceEstimateLine(line(), components, rates).costCents;

    catalogue.materials["lvp"] = { ...catalogue.materials["lvp"]!, unit_cost_cents: 275 };
    catalogue.labour["ilvp"] = { ...catalogue.labour["ilvp"]!, unit_cost_cents: 190 };
    expect(priceEstimateLine(line(), components, rates).costCents).toBe(before);

    const diff = refreshDiff(components, catalogue);
    expect(diff).toEqual([
      { index: 0, label: "Dante Pro", fromCents: 250, toCents: 275 },
      { index: 2, label: "Install LVP", fromCents: 175, toCents: 190 },
    ]);
    const refreshed = applyRefresh(components, diff);
    expect(components[0]!.unit_cost_cents).toBe(250); // original untouched
    const after = priceEstimateLine(line(), refreshed, rates).costCents;
    expect(after).toBe(Math.round(47 * 23.6 * 275 * 1.07) + 47615 + 190000);
  });

  test("a hand-entered cost is kept by Refresh prices and flagged", () => {
    const catalogue = cat();
    const { components } = buildComponents({ template: lvpTemplate, finishMaterialId: "lvp", catalogue });
    components[0] = { ...components[0]!, unit_cost_cents: 240, cost_overridden: true };
    catalogue.materials["lvp"] = { ...catalogue.materials["lvp"]!, unit_cost_cents: 275 };
    expect(refreshDiff(components, catalogue)).toEqual([{ index: 0, label: "Dante Pro", fromCents: 240, toCents: 275, overrideKept: true }]);
    expect(applyRefresh(components, refreshDiff(components, catalogue))[0]!.unit_cost_cents).toBe(240);
  });

  test("a price that becomes known fills an unknown one", () => {
    const catalogue = cat();
    const { components } = buildComponents({ template: { driver_uom: "SF", default_waste_pct: 5, components: [tc({})] }, finishMaterialId: "nopx", catalogue });
    catalogue.materials["nopx"] = { ...catalogue.materials["nopx"]!, unit_cost_cents: 410 };
    expect(refreshDiff(components, catalogue)).toEqual([{ index: 0, label: "Mystery Tile", fromCents: null, toCents: 410 }]);
  });

  test("the snapshot prices exactly as the calculation module does", () => {
    const { components } = buildComponents({ template: { driver_uom: "SF", default_waste_pct: 5, components: [tc({}), tc({ kind: "labour", label: "Install LVP", source: "labour_rate", labour_rate_id: "ilvp", sort_order: 2 })] }, finishMaterialId: "lvp", catalogue: cat() });
    const direct = priceLine({ driverQty: 1000, driverUom: "SF", markupPct: 30, taxCode: "GST", components: [
      { kind: "material", unitCostCents: 250, costUom: "SF", purchaseUom: "carton", coveragePerPurchaseUnit: 23.6, qtyPerDriver: 1, wastePct: 10, roundUp: true, pstApplies: true },
      { kind: "labour", unitCostCents: 175, costUom: "SF", purchaseUom: "SF", qtyPerDriver: 1, wastePct: 0, roundUp: false, pstApplies: false },
    ] }, rates);
    const mine = priceEstimateLine(line(), components, rates);
    expect([mine.costCents, mine.sellCents]).toEqual([direct.costCents, direct.sellCents]);
    expect(mine.sellCents).toBe(613224);
  });
});
