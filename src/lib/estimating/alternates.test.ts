import { describe, expect, test } from "bun:test";
import { compareVersions, planSwap } from "./alternates";
import { buildComponents, simpleComponent, type CatalogueView } from "./assemble";
import type { EstLine, EstVersion, Finish } from "./data";

const rates = { pstPct: 7, gstPct: 5, hstPct: 13 };
const catalogue: CatalogueView = {
  materials: {
    lvt: { id: "lvt", name: "Vinyl tile", cost_uom: "SF", unit_cost_cents: 300, purchase_uom: "SF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 5 },
    por: { id: "por", name: "Porcelain 24x24", cost_uom: "SF", unit_cost_cents: 650, purchase_uom: "SF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 10 },
  },
  labour: { ilvt: { id: "ilvt", name: "Install LVT", uom: "SF", unit_cost_cents: 150 }, itile: { id: "itile", name: "Install floor tile", uom: "SF", unit_cost_cents: 700 } },
};
const tpl = (labour: string, cost_code: string) => ({
  id: `t-${labour}`, name: labour, category: "lvt" as const, driver_uom: "SF" as const, cost_code, default_waste_pct: 5, sort_order: 1, active: true,
  components: [
    { kind: "material" as const, label: "Material", source: "finish_material" as const, catalogue_material_id: null, labour_rate_id: null, unit_cost_cents: null, cost_uom: null, qty_per_driver: 1, waste_pct: null, round_up: true, pst_applies: false, on_gross: false, sort_order: 1 },
    { kind: "labour" as const, label: "Install", source: "labour_rate" as const, catalogue_material_id: null, labour_rate_id: labour, unit_cost_cents: null, cost_uom: null, qty_per_driver: 1, waste_pct: null, round_up: false, pst_applies: false, on_gross: false, sort_order: 2 },
  ],
});
const lvtT = tpl("ilvt", "01-04");
const tileT = tpl("itile", "01-10");
const fLvt: Finish = { id: "f-lvt", project_id: "p", tag: "LVT-1", description: "Vinyl tile", assembly_template_id: lvtT.id, catalogue_material_id: "lvt", sort_order: 1 };
const fPor: Finish = { id: "f-por", project_id: "p", tag: "PT-1", description: "Porcelain tile", assembly_template_id: tileT.id, catalogue_material_id: "por", sort_order: 2 };
const line = (id: string, section: string, qty: number, o: Partial<EstLine> = {}): EstLine => ({
  id, version_id: "v1", section, finish_id: "f-lvt", kind: "assembly", description: "LVT-1 – Vinyl tile", driver_qty: qty, driver_uom: "SF", source: "manual", waste_pct: 5,
  markup_pct: 30, price_basis: "markup", margin_pct: null, fixed_sell_cents: null, cost_code: "01-04", tax_code: "GST", notes: null, sort_order: 1, selection: "required",
  selection_group: null, is_allowance: false, subject_to_measure: false, takeoff_condition_id: null, detached: false, row_version: 3,
  components: buildComponents({ template: lvtT, finishMaterialId: "lvt", catalogue }).components, ...o,
});
const lines = [line("a", "Main lobby", 800), line("b", "Elevator lobby L2", 200), line("c", "Elevator lobby L3", 200), line("d", "Main lobby", 1, { finish_id: null, kind: "prep", description: "Prep", driver_uom: "LS", components: [simpleComponent("Prep", 50000, "LS")] })];

describe("planSwap", () => {
  test("limited to the main lobby, only those lines change; the others keep their components", () => {
    const plan = planSwap({ lines, fromFinishId: "f-lvt", to: fPor, template: tileT, catalogue, sections: ["Main lobby"] });
    expect(plan.items.map((i) => i.id)).toEqual(["a"]);
    const item = plan.items[0]!;
    expect(item.row_version).toBe(3);
    expect(item.line).toMatchObject({ finish_id: "f-por", description: "PT-1 – Porcelain tile", waste_pct: 10, cost_code: "01-10" });
    expect(item.line.driver_qty).toBeUndefined(); // quantity, markup and section are left as they were
    expect(item.components!.map((c) => [c.label, c.unit_cost_cents])).toEqual([["Porcelain 24x24", 650], ["Install floor tile", 700]]);
    expect(plan.untouched).toBe(2);
  });
  test("across the whole price, every line on that finish changes and other finishes do not", () => {
    const plan = planSwap({ lines, fromFinishId: "f-lvt", to: fPor, template: tileT, catalogue });
    expect(plan.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(plan.untouched).toBe(0);
  });
  test("a line with a hand-entered unit cost is reported as kept, not overwritten", () => {
    const withOverride = lines.map((l) => (l.id === "b" ? { ...l, components: l.components.map((c, i) => (i === 0 ? { ...c, unit_cost_cents: 280, cost_overridden: true } : c)) } : l));
    const plan = planSwap({ lines: withOverride, fromFinishId: "f-lvt", to: fPor, template: tileT, catalogue });
    expect(plan.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(plan.overrideKept).toEqual([{ id: "b", description: "LVT-1 – Vinyl tile", section: "Elevator lobby L2" }]);
  });
  test("lines with a hand-set selling price are left alone too", () => {
    const fixed = lines.map((l) => (l.id === "c" ? { ...l, price_basis: "fixed_sell" as const, fixed_sell_cents: 99900 } : l));
    expect(planSwap({ lines: fixed, fromFinishId: "f-lvt", to: fPor, template: tileT, catalogue }).overrideKept.map((k) => k.id)).toEqual(["c"]);
  });
});

describe("compareVersions", () => {
  const version = (id: string, name: string, ls: EstLine[], is_base = false): EstVersion => ({ id, project_id: "p", kind: "estimate", co_number: null, name, description: null, default_markup_pct: 30, sort_order: 1, is_base, locked: false, status: "draft", lines: ls });
  const swapped = lines.map((l) => {
    const item = planSwap({ lines, fromFinishId: "f-lvt", to: fPor, template: tileT, catalogue, sections: ["Main lobby"] }).items.find((i) => i.id === l.id);
    return item ? { ...l, ...item.line, components: item.components! } : l;
  }) as EstLine[];
  const cmp = compareVersions([version("v1", "Base", lines, true), version("v2", "Alternate 1 – porcelain in main lobby", swapped)], rates);

  test("the swapped line prices at the new material at once, and the delta shows what Base was", () => {
    const main = cmp.rows.find((r) => r.section === "Main lobby")!;
    const baseSell = main.sellCents[0]!;
    const altSell = main.sellCents[1]!;
    // Base: 800 SF vinyl tile 5% waste + PST and $1.50 install, +30%, plus prep $500 +30%
    expect(baseSell).toBe(Math.round((Math.round(840 * 300 * 1.07) + 120000) * 1.3) + 65000);
    expect(altSell).toBe(Math.round((Math.round(880 * 650 * 1.07) + 560000) * 1.3) + 65000);
    expect(main.deltaCents).toEqual([0, altSell - baseSell]);
    expect(main.changed).toEqual([false, true]);
  });
  test("sections that were not swapped show no difference", () => {
    const l2 = cmp.rows.find((r) => r.section === "Elevator lobby L2")!;
    expect(l2.deltaCents).toEqual([0, 0]);
    expect(l2.changed).toEqual([false, false]);
  });
  test("totals carry subtotal, tax and total for each price with the difference from Base", () => {
    expect(cmp.totals.map((t) => t.name)).toEqual(["Base", "Alternate 1 – porcelain in main lobby"]);
    expect(cmp.totals[1]!.deltaCents).toBe(cmp.totals[1]!.totalCents - cmp.totals[0]!.totalCents);
    expect(cmp.totals[0]!.deltaCents).toBe(0);
  });
  test("a section that exists only in an alternate still appears", () => {
    const extra = compareVersions([version("v1", "Base", lines, true), version("v2", "Alt", [...lines, line("z", "Roof terrace", 100)])], rates);
    const row = extra.rows.find((r) => r.section === "Roof terrace")!;
    expect(row.sellCents[0]).toBe(0);
    expect(row.changed).toEqual([false, true]);
  });
});
