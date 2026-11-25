import { describe, expect, test } from "bun:test";
import { buildComponents, priceEstimateLine, type CatalogueView, type LineInput } from "./assemble";
import { answerExtra, extraQuestion, extrasOf, templateForOffer } from "./lines";

// A wall tile assembly as it is set up under Materials → Assemblies: tile, install at $8.50 a SF, and a Schluter
// edge priced by the linear foot. The edge is not measured in SF, so each line is asked whether it has one.
const catalogue: CatalogueView = {
  materials: { wt: { id: "wt", name: "Subway 3x6", cost_uom: "SF", unit_cost_cents: 400, purchase_uom: "SF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: false, default_waste_pct: 10 } },
  labour: { iwt: { id: "iwt", name: "Install wall tile", uom: "SF", unit_cost_cents: 850 } },
};
const part = (o: Record<string, unknown>) => ({ kind: "material" as const, label: "Material", source: "finish_material" as const, catalogue_material_id: null, labour_rate_id: null, unit_cost_cents: null, cost_uom: null, qty_per_driver: 1, waste_pct: null, round_up: false, pst_applies: false, on_gross: false, sort_order: 1, ...o });
const wallTile = (schluterCents: number | null) => ({
  driver_uom: "SF" as const, default_waste_pct: 10,
  components: [part({}), part({ kind: "labour", label: "Install wall tile", source: "labour_rate", labour_rate_id: "iwt", sort_order: 2 }), part({ kind: "fixed", label: "Schluter edge", source: "fixed", unit_cost_cents: schluterCents, cost_uom: "LF", qty_per_driver: 0, sort_order: 3 })],
});
const line = (o: Partial<LineInput> = {}): LineInput => ({ driver_qty: 60, driver_uom: "SF", markup_pct: 0, price_basis: "markup", margin_pct: null, fixed_sell_cents: null, tax_code: "GST", ...o });
const rates = { pstPct: 7 };
const built = (cents: number | null = 450) => buildComponents({ template: wallTile(cents), finishMaterialId: "wt", catalogue });

describe("a part priced in a unit the line is not measured in is a yes-or-no question", () => {
  test("the Schluter edge comes onto a wall tile line priced per LF, waiting for its answer", () => {
    const { components, issues } = built();
    expect(components[2]).toMatchObject({ kind: "fixed", label: "Schluter edge", cost_uom: "LF", purchase_uom: "LF", unit_cost_cents: 450, qty_per_driver: 0, not_applicable: false });
    expect(issues).toEqual(["Schluter edge: answer yes or no on the line."]);
    expect(extraQuestion(components[2]!, "SF")).toBe("ask");
    expect(extrasOf(components, "SF").map((x) => [x.index, x.state, x.label, x.uom])).toEqual([[2, "ask", "Schluter edge", "LF"]]);
    expect(extraQuestion(components[0]!, "SF")).toBeNull();
    expect(extraQuestion(components[1]!, "SF")).toBeNull();
  });
  test("install is carried at $8.50 a SF", () => {
    const p = priceEstimateLine(line(), answerExtra(built().components, 2, false), rates);
    expect(p.components[1]!.costCents).toBe(60 * 850);
  });
  test("until it is answered the line's cost is not complete, so a quote cannot go out", () => {
    const p = priceEstimateLine(line(), built().components, rates);
    expect(p.unknown).toBe(true);
    expect(p.unknownLabels).toEqual(["Schluter edge: yes or no?"]);
  });
  test("No: nothing is carried and nothing is missing", () => {
    const c = answerExtra(built().components, 2, false);
    expect(extraQuestion(c[2]!, "SF")).toBe("no");
    const p = priceEstimateLine(line(), c, rates);
    expect(p.unknown).toBe(false);
    expect(p.components[2]!.costCents).toBe(0);
  });
  test("Yes: the LF times the cost per LF is carried in the line, whatever the line's SF", () => {
    const c = answerExtra(built().components, 2, true, 22);
    expect(extraQuestion(c[2]!, "SF")).toBe("yes");
    const p = priceEstimateLine(line(), c, rates);
    expect(p.components[2]!.costCents).toBe(22 * 450);
    expect(p.unknown).toBe(false);
    expect(priceEstimateLine(line({ driver_qty: 600 }), c, rates).components[2]!.costCents).toBe(22 * 450);
    expect(p.costCents).toBe(p.components.reduce((n, x) => n + x.costCents, 0));
  });
  test("Yes with no cost entered yet: the cost is missing, never zero", () => {
    const p = priceEstimateLine(line(), answerExtra(built(null).components, 2, true, 22), rates);
    expect(p.unknown).toBe(true);
    expect(p.unknownLabels).toEqual(["Schluter edge"]);
  });
  test("Yes needs a length; answering again changes it; No then Yes brings it back", () => {
    expect(() => answerExtra(built().components, 2, true, 0)).toThrow("Type how many LF");
    let c = answerExtra(built().components, 2, true, 22);
    c = answerExtra(c, 2, true, 30);
    expect(c[2]!.qty_per_driver).toBe(30);
    c = answerExtra(answerExtra(c, 2, false), 2, true, 12);
    expect(c[2]).toMatchObject({ not_applicable: false, qty_per_driver: 12 });
  });
});

describe("walls measured in the takeoff use the wall tile assembly", () => {
  const floor = { id: "t-floor", category: "floor_tile", driver_uom: "SF", active: true }, wall = { id: "t-wall", category: "wall_tile", driver_uom: "SF", active: true };
  test("a finish set up as floor tile gets wall tile labour and the Schluter question on its Walls line", () => {
    expect(templateForOffer(floor, "Walls", [floor, wall])).toBe(wall);
    expect(templateForOffer(floor, "Suite Type B walls", [floor, wall])).toBe(wall);
    expect(templateForOffer(null, "Walls", [floor, wall])).toBe(wall);
  });
  test("floors keep their own assembly; with no wall tile assembly nothing changes", () => {
    expect(templateForOffer(floor, "Flooring", [floor, wall])).toBe(floor);
    expect(templateForOffer(floor, "Hallways", [floor, wall])).toBe(floor);
    expect(templateForOffer(floor, "Walls", [floor])).toBe(floor);
    expect(templateForOffer(floor, "Walls", [floor, { ...wall, active: false }])).toBe(floor);
  });
});
