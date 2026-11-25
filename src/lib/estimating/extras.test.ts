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

// ── Schluter as a catalogue item: SKUs and price changes kept in Materials ──────────────────────────────────
import { ownQty } from "./calc";
import { pickExtraSku, repairExtras, trimChoices } from "./lines";

const withSku = (): CatalogueView => ({
  materials: {
    ...catalogue.materials,
    jolly: { id: "jolly", name: "Schluter Jolly 10 mm satin", cost_uom: "LF", unit_cost_cents: 500, purchase_uom: "LF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 10 },
    rondec: { id: "rondec", name: "Schluter Rondec 12.5 mm", cost_uom: "LF", unit_cost_cents: 700, purchase_uom: "LF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 0 },
    grout: { id: "grout", name: "Grout", cost_uom: "SF", unit_cost_cents: 20, purchase_uom: "SF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 0 },
  },
  labour: catalogue.labour,
});
const trimTemplate = (materialId: string | null) => ({
  driver_uom: "SF" as const, default_waste_pct: 10,
  components: [part({}), part({ kind: "labour", label: "Install wall tile", source: "labour_rate", labour_rate_id: "iwt", sort_order: 2 }), part({ label: "Schluter edge", source: "catalogue", catalogue_material_id: materialId, cost_uom: "LF", qty_per_driver: 0, sort_order: 3 })],
});

describe("which parts have their own quantity", () => {
  test("a measured unit that does not convert to the line's, with no coverage", () => {
    expect(ownQty("SF", "LF", null)).toBe(true);
    expect(ownQty("SF", "EA", null)).toBe(true);
    expect(ownQty("LF", "SF", null)).toBe(true);
    expect(ownQty("SF", "SY", null)).toBe(false);
    expect(ownQty("SF", "SF", null)).toBe(false);
    expect(ownQty("SF", "pail", null)).toBe(false);      // adhesive by the pail is sized by its coverage
    expect(ownQty("SF", "LF", 8)).toBe(false);
  });
});

describe("the Schluter edge as a catalogue item", () => {
  test("with a SKU chosen in the assembly it comes in at the catalogue's price per LF, asking", () => {
    const { components, issues } = buildComponents({ template: trimTemplate("jolly"), finishMaterialId: "wt", catalogue: withSku() });
    expect(components[2]).toMatchObject({ kind: "material", source: "catalogue", catalogue_material_id: "jolly", label: "Schluter edge", cost_uom: "LF", purchase_uom: "LF", unit_cost_cents: 500, qty_per_driver: 0, waste_pct: 10, pst_applies: true });
    expect(issues).toEqual(["Schluter edge: answer yes or no on the line."]);
    expect(extraQuestion(components[2]!, "SF")).toBe("ask");
  });
  test("with no SKU chosen yet it still asks, per LF, and says to pick one", () => {
    const { components, issues } = buildComponents({ template: trimTemplate(null), finishMaterialId: "wt", catalogue: withSku() });
    expect(components[2]).toMatchObject({ kind: "material", label: "Schluter edge", cost_uom: "LF", purchase_uom: "LF", unit_cost_cents: null, qty_per_driver: 0 });
    expect(issues).toEqual(["Schluter edge: answer yes or no on the line.", "Schluter edge: no catalogue item chosen."]);
  });
  test("Yes carries LF × price, with the item's waste and PST", () => {
    const c = answerExtra(buildComponents({ template: trimTemplate("jolly"), finishMaterialId: "wt", catalogue: withSku() }).components, 2, true, 22);
    const p = priceEstimateLine(line(), c, rates);
    expect(p.components[2]).toEqual({ purchaseQty: 24.2, costCents: Math.round(22 * 1.1 * 500 * 1.07) });
  });
  test("another SKU can be chosen on the line; it takes that item's price and keeps the answer", () => {
    let c = answerExtra(buildComponents({ template: trimTemplate("jolly"), finishMaterialId: "wt", catalogue: withSku() }).components, 2, true, 22);
    c = pickExtraSku(c, 2, withSku().materials.rondec!);
    expect(c[2]).toMatchObject({ catalogue_material_id: "rondec", label: "Schluter edge", unit_cost_cents: 700, waste_pct: 0, qty_per_driver: 22, cost_overridden: false });
    expect(priceEstimateLine(line(), c, rates).components[2]!.costCents).toBe(Math.round(22 * 700 * 1.07));
    expect(() => pickExtraSku(c, 2, withSku().materials.grout!)).toThrow("Grout is priced per SF. Choose one priced per LF.");
  });
  test("the finish's own material in another unit is a set-up mistake, reported, not a question", () => {
    const { issues } = buildComponents({ template: { driver_uom: "SF", default_waste_pct: 5, components: [part({})] }, finishMaterialId: "jolly", catalogue: withSku() });
    expect(issues).toEqual(["Schluter Jolly 10 mm satin is priced per LF, which does not fit a line measured in SF."]);
  });
  test("the items offered are the tile trims priced in the part's unit", () => {
    const mats = [
      { id: "a", name: "Jolly", category: "tile_trim", cost_uom: "LF", active: true },
      { id: "b", name: "Corner", category: "tile_trim", cost_uom: "EA", active: true },
      { id: "c", name: "Old Rondec", category: "tile_trim", cost_uom: "LF", active: false },
      { id: "d", name: "Reducer", category: "transitions", cost_uom: "LF", active: true },
    ];
    expect(trimChoices(mats, "LF").map((m) => m.id)).toEqual(["a"]);
  });
  test("Refresh prices picks up a new catalogue price for the chosen SKU", async () => {
    const { refreshDiff } = await import("./assemble");
    const c = buildComponents({ template: trimTemplate("jolly"), finishMaterialId: "wt", catalogue: withSku() }).components;
    const later = withSku();
    later.materials.jolly = { ...later.materials.jolly!, unit_cost_cents: 550 };
    expect(refreshDiff(c, later)).toEqual([{ index: 2, label: "Schluter edge", fromCents: 500, toCents: 550 }]);
  });
});

describe("a line whose cost was typed over by hand", () => {
  const typed = (c: ReturnType<typeof built>["components"]) => priceEstimateLine(line({ unit_cost_override_cents: 1500 }), c, rates);
  test("still asks the Schluter question, and a quote cannot go out until it is answered", () => {
    const p = typed(built().components);
    expect(p.costOverridden).toBe(true);
    expect(p.unknown).toBe(true);
    expect(p.unknownLabels).toEqual(["Schluter edge: yes or no?"]);
  });
  test("Yes carries the edge on top of the typed cost; No adds nothing", () => {
    expect(typed(answerExtra(built().components, 2, true, 22)).costCents).toBe(60 * 1500 + 22 * 450);
    expect(typed(answerExtra(built().components, 2, true, 22)).unknown).toBe(false);
    const no = typed(answerExtra(built().components, 2, false));
    expect(no.costCents).toBe(60 * 1500);
    expect(no.unknown).toBe(false);
  });
  test("Yes with no cost for the edge is still a missing cost", () => {
    expect(typed(answerExtra(built(null).components, 2, true, 22)).unknownLabels).toEqual(["Schluter edge"]);
  });
});

describe("a line built before the edge was asked about is repaired", () => {
  // What the app built before this change: the edge in the line's own unit, with nothing to answer.
  const stale = () => {
    const c = buildComponents({ template: trimTemplate(null), finishMaterialId: "wt", catalogue: withSku() }).components;
    c[2] = { ...c[2]!, cost_uom: "SF", purchase_uom: "SF" };
    return c;
  };
  test("the edge goes back to LF, waiting for its answer; nothing else changes", () => {
    const r = repairExtras(stale(), trimTemplate(null), "wt", withSku(), "SF");
    expect(r.fixed).toBe(1);
    expect(r.components[2]).toMatchObject({ cost_uom: "LF", purchase_uom: "LF", qty_per_driver: 0, label: "Schluter edge" });
    expect(extraQuestion(r.components[2]!, "SF")).toBe("ask");
    expect(r.components.slice(0, 2)).toEqual(stale().slice(0, 2));
  });
  test("a line that is already right, or answered, is left alone", () => {
    const good = buildComponents({ template: trimTemplate(null), finishMaterialId: "wt", catalogue: withSku() }).components;
    expect(repairExtras(good, trimTemplate(null), "wt", withSku(), "SF").fixed).toBe(0);
    const answered = answerExtra(good, 2, true, 10);
    expect(repairExtras(answered, trimTemplate(null), "wt", withSku(), "SF").components).toBe(answered);
    const typedCost = stale();
    typedCost[2] = { ...typedCost[2]!, qty_per_driver: 1 };
    expect(repairExtras(typedCost, trimTemplate(null), "wt", withSku(), "SF").fixed).toBe(0);
  });
});
