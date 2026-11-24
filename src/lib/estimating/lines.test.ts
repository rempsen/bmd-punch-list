import { describe, expect, test } from "bun:test";
import { simpleComponent, type SnapComponent } from "./assemble";
import { setLineWaste, windowLine } from "./lines";

const c = (o: Partial<SnapComponent>): SnapComponent => ({ ...simpleComponent("x", 100, "SF"), ...o });

describe("setLineWaste", () => {
  test("changes the finish material and labour paid on gross, and nothing else", () => {
    const out = setLineWaste(
      [c({ kind: "material", source: "finish_material", waste_pct: 5 }), c({ kind: "material", source: "catalogue", label: "Adhesive", waste_pct: 5 }), c({ kind: "labour", source: "labour_rate", waste_pct: 0 }), c({ kind: "labour", source: "labour_rate", on_gross: true, waste_pct: 5 }), c({ kind: "fixed" })],
      12,
    );
    expect(out.map((x) => x.waste_pct)).toEqual([12, 5, 0, 12, 0]);
  });
});

describe("windowLine", () => {
  test("one window type is one per-piece line: vendor price with PST, install and delivery without", () => {
    const item = windowLine({ versionId: "v", section: "Suites", type: "W1", product: "Roller shade 48x60", qty: 40, vendorCents: 31000, installCents: 4500, miscCents: 1200, markupPct: 35 });
    expect(item.line).toMatchObject({ kind: "assembly", description: "W1 – Roller shade 48x60", driver_qty: 40, driver_uom: "EA", markup_pct: 35, cost_code: "02-100", section: "Suites" });
    expect(item.components!.map((x) => [x.kind, x.unit_cost_cents, x.pst_applies])).toEqual([["material", 31000, true], ["labour", 4500, false], ["fixed", 1200, false]]);
  });
  test("a blank amount stays unknown", () => {
    const item = windowLine({ versionId: "v", section: "Suites", type: "W2", product: "", qty: 5, vendorCents: 20000, installCents: null, miscCents: null, markupPct: 35 });
    expect(item.components!.map((x) => x.unit_cost_cents)).toEqual([20000, null, null]);
    expect(item.line.description).toBe("W2");
  });
});

import { costTarget, guessCategory } from "./lines";
describe("where a cost typed on an estimate line is kept", () => {
  const fin = (p: Partial<{ catalogue_material_id: string | null; description: string | null }> = {}) => ({ id: "f1", tag: "CPT-1", description: null, catalogue_material_id: null, ...p });
  const comp = (p: Partial<SnapComponent> = {}): SnapComponent => ({ ...simpleComponent("CPT-1", null, "SF"), ...p });
  test("a catalogue material's cost goes to that material", () => {
    expect(costTarget(comp({ catalogue_material_id: "m1" }), fin(), 1)).toEqual({ kind: "material", id: "m1" });
  });
  test("a labour rate's cost goes to that rate", () => {
    expect(costTarget(comp({ labour_rate_id: "l1", kind: "labour" }), fin(), 3)).toEqual({ kind: "labour", id: "l1" });
  });
  test("a finish with no material yet gets one, named for the finish, in the line's unit", () => {
    expect(costTarget(comp(), fin({ description: "Corridor carpet tile" }), 1)).toEqual({ kind: "new_material", name: "CPT-1 – Corridor carpet tile", category: "carpet_tile", uom: "SF" });
  });
  test("a finish that already has a material reprices that material", () => {
    expect(costTarget(comp(), fin({ catalogue_material_id: "m9" }), 1)).toEqual({ kind: "material", id: "m9" });
  });
  test("a one-off cost with no finish stays on the line", () => {
    expect(costTarget(comp({ label: "Delivery" }), null, 1)).toEqual({ kind: "line_only" });
  });
  test("an unlinked part of a larger assembly stays on the line", () => {
    expect(costTarget(comp(), fin(), 3)).toEqual({ kind: "line_only" });
  });
  test("the category is read from the tag or the name", () => {
    expect(["CPT-1", "LVT-1", "LVP-2", "RB-1", "SV-1", "CT-3", "WT-1", "TR-1", "Millwork Base", "BRD-1"].map(guessCategory)).toEqual(["carpet_tile", "lvt", "lvp", "wall_base", "sheet_vinyl", "floor_tile", "wall_tile", "transitions", "wall_base", "other"]);
  });
});

import { changeLineUnit, unitChoices } from "./lines";
import { priceEstimateLine } from "./assemble";
describe("changing a line's unit of measure", () => {
  const one = (uom: "SF" | "SY" | "LF" | "EA", cents: number | null): SnapComponent => ({ ...simpleComponent("CPT-1", cents, uom), kind: "material", source: "catalogue" });
  const cost = (qty: number, uom: "SF" | "SY" | "LF" | "EA", comps: SnapComponent[]) => priceEstimateLine({ driver_qty: qty, driver_uom: uom, markup_pct: 0, tax_code: "GST", price_basis: "markup", margin_pct: null, fixed_sell_cents: null } as never, comps, { pstPct: 7 }).costCents;

  test("square feet to square yards converts the quantity and the unit cost, so the line's cost does not move", () => {
    const before = [one("SF", 200)];
    const r = changeLineUnit({ driver_qty: 900, driver_uom: "SF" }, before, "SY");
    expect(r.line).toEqual({ driver_qty: 100, driver_uom: "SY" });
    expect(r.components[0]).toMatchObject({ cost_uom: "SY", purchase_uom: "SY", unit_cost_cents: 1800 });
    expect(r.converted).toBe(true);
    expect(cost(100, "SY", r.components)).toBe(cost(900, "SF", before));
  });
  test("and back again", () => {
    const r = changeLineUnit({ driver_qty: 100, driver_uom: "SY" }, [one("SY", 1800)], "SF");
    expect(r.line).toEqual({ driver_qty: 900, driver_uom: "SF" });
    expect(r.components[0]!.unit_cost_cents).toBe(200);
  });
  test("an unknown cost stays unknown", () => {
    expect(changeLineUnit({ driver_qty: 90, driver_uom: "SF" }, [one("SF", null)], "SY").components[0]!.unit_cost_cents).toBeNull();
  });
  test("to an unrelated unit the numbers are kept as typed and only the unit changes", () => {
    const r = changeLineUnit({ driver_qty: 135.97, driver_uom: "SF" }, [one("SF", 250)], "LF");
    expect(r.line).toEqual({ driver_qty: 135.97, driver_uom: "LF" });
    expect(r.components[0]).toMatchObject({ cost_uom: "LF", purchase_uom: "LF", unit_cost_cents: 250 });
    expect(r.converted).toBe(false);
  });
  test("an assembly of several parts converts between square feet and yards without changing its cost", () => {
    const parts: SnapComponent[] = [
      { ...one("SF", 300), label: "Tile", coverage_per_purchase_unit: 45, purchase_uom: "carton", cost_uom: "SF", round_up: true },
      { ...one("SF", 150), label: "Install", kind: "labour", source: "labour_rate" },
    ];
    const r = changeLineUnit({ driver_qty: 900, driver_uom: "SF" }, parts, "SY");
    expect(r.line).toEqual({ driver_qty: 100, driver_uom: "SY" });
    expect(r.components[0]).toMatchObject({ coverage_per_purchase_unit: 5, cost_uom: "SF", unit_cost_cents: 300 });
    expect(cost(100, "SY", r.components)).toBe(cost(900, "SF", parts));
  });
  test("an assembly cannot be switched to an unrelated unit", () => {
    expect(() => changeLineUnit({ driver_qty: 9, driver_uom: "SF" }, [one("SF", 1), one("SF", 2)], "EA")).toThrow(/assembly/i);
  });
  test("the choices offered match what can be done", () => {
    expect(unitChoices("SF", 1)).toContain("LF");
    expect(unitChoices("SF", 3)).toEqual(["SF", "SY"]);
    expect(unitChoices("EA", 3)).toEqual(["EA"]);
  });
});

import { costInUnit } from "./lines";
describe("a cost typed in one unit, kept in the catalogue's unit", () => {
  test("the same unit is unchanged; square feet and yards convert; anything else cannot be", () => {
    expect(costInUnit(250, "SF", "SF")).toBe(250);
    expect(costInUnit(1800, "SY", "SF")).toBe(200);
    expect(costInUnit(200, "SF", "SY")).toBe(1800);
    expect(costInUnit(250, "LF", "SF")).toBeNull();
  });
});

import { partChoices, partFor, sectionChoices } from "./lines";
describe("adding install, adhesive or prep to a line", () => {
  const cat = {
    materials: { a1: { id: "a1", name: "Eco 373 15L", cost_uom: "pail", unit_cost_cents: 13581, purchase_uom: "pail", coverage_per_purchase_unit: 250, coverage_uom: "SF", pst_applies: true, default_waste_pct: 0 } },
    labour: { l1: { id: "l1", name: "Install LVT", uom: "SF", unit_cost_cents: 125 }, l2: { id: "l2", name: "Install wall base", uom: "LF", unit_cost_cents: null }, l3: { id: "l3", name: "Floor prep", uom: "SF", unit_cost_cents: 50 } },
  } as never;
  const mats = [{ id: "a1", name: "Eco 373 15L", category: "adhesive", active: true }, { id: "m2", name: "Dante", category: "lvt", active: true }, { id: "a3", name: "Old glue", category: "adhesive", active: false }];
  const rates = [{ id: "l1", name: "Install LVT", uom: "SF", active: true }, { id: "l2", name: "Install wall base", uom: "LF", active: true }, { id: "l3", name: "Floor prep", uom: "SF", active: true }];

  test("install offers the install rates that fit the line's unit", () => {
    expect(partChoices("install", mats as never, rates as never, "SF")).toEqual([{ type: "labour", id: "l1", name: "Install LVT" }]);
    expect(partChoices("install", mats as never, rates as never, "LF")).toEqual([{ type: "labour", id: "l2", name: "Install wall base" }]);
    expect(partChoices("install", mats as never, rates as never, "SY")).toEqual([{ type: "labour", id: "l1", name: "Install LVT" }]);
  });
  test("adhesive offers active adhesives; prep offers prep labour", () => {
    expect(partChoices("adhesive", mats as never, rates as never, "SF")).toEqual([{ type: "material", id: "a1", name: "Eco 373 15L" }]);
    expect(partChoices("prep", mats as never, rates as never, "SF")).toEqual([{ type: "labour", id: "l3", name: "Floor prep" }]);
  });
  test("a labour rate comes in at its catalogue cost, per the line's quantity", () => {
    expect(partFor("install", { type: "labour", id: "l1", name: "Install LVT" }, "SF", cat, 2)).toMatchObject({ kind: "labour", label: "Install LVT", labour_rate_id: "l1", unit_cost_cents: 125, cost_uom: "SF", qty_per_driver: 1, sort_order: 2, pst_applies: false });
  });
  test("an adhesive comes in by the pail with its coverage, rounded up to whole pails", () => {
    expect(partFor("adhesive", { type: "material", id: "a1", name: "Eco 373 15L" }, "SF", cat, 3)).toMatchObject({ kind: "material", catalogue_material_id: "a1", unit_cost_cents: 13581, purchase_uom: "pail", coverage_per_purchase_unit: 250, round_up: true, pst_applies: true });
  });
  test("something not in the catalogue yet comes in with its cost unknown, never zero", () => {
    expect(partFor("install", null, "LF", cat, 2)).toMatchObject({ kind: "labour", label: "Install", unit_cost_cents: null, cost_uom: "LF", labour_rate_id: null });
    expect(partFor("adhesive", null, "SF", cat, 2)).toMatchObject({ kind: "material", label: "Adhesive", unit_cost_cents: null, catalogue_material_id: null });
    expect(partFor("prep", null, "SF", cat, 2)).toMatchObject({ kind: "labour", label: "Prep", unit_cost_cents: null });
  });
});

describe("sections a line can be moved to", () => {
  test("the sections in use first, then the usual ones, with no repeats", () => {
    expect(sectionChoices(["Window coverings", "General"])).toEqual(["Window coverings", "General", "Flooring", "Prep"]);
    expect(sectionChoices([])).toEqual(["Flooring", "Window coverings", "Prep", "General"]);
  });
});

import { lineWasteShown, mainPart, setPartCoverage, setPartWaste, wasteApplies } from "./lines";
import { priceEstimateLine } from "./assemble";
describe("waste typed on an estimate line", () => {
  const line = { driver_qty: 100, driver_uom: "SF" as const, markup_pct: 0, price_basis: "markup" as const, margin_pct: null, fixed_sell_cents: null, tax_code: "GST" as const };
  const cost = (parts: SnapComponent[]) => priceEstimateLine(line, parts, { pstPct: 7 }).costCents;
  const mat = (p: Partial<SnapComponent> = {}) => c({ kind: "material", source: "catalogue", catalogue_material_id: "m1", unit_cost_cents: 400, ...p });
  const lab = (p: Partial<SnapComponent> = {}) => c({ kind: "labour", source: "labour_rate", labour_rate_id: "l1", unit_cost_cents: 75, ...p });

  test("the line's waste drives its main part: the finish material, or failing that the first part that is not labour", () => {
    expect(mainPart([lab(), mat({ source: "finish_material" }), mat()])).toBe(1);
    expect(mainPart([lab(), mat(), mat()])).toBe(1);
    expect(mainPart([c({})])).toBe(0);
    expect(mainPart([lab()])).toBe(0);
    expect(mainPart([lab(), lab()])).toBe(-1);
    expect(mainPart([])).toBe(-1);
  });
  test("a part left out of the line is never the main part while another is in", () => {
    expect(mainPart([mat({ not_applicable: true }), mat()])).toBe(1);
  });
  test("a line whose material came from the catalogue takes the line's waste (it used to be ignored)", () => {
    const out = setLineWaste([mat(), lab()], 5);
    expect(out.map((x) => x.waste_pct)).toEqual([5, 0]);
    expect(cost(out)).toBe(100 * 1.05 * 400 + 100 * 75);
  });
  test("a one-cost line (prep, misc, something measured in the takeoff) takes the line's waste", () => {
    const out = setLineWaste([c({ unit_cost_cents: 275 })], 10);
    expect(wasteApplies(out[0]!)).toBe(true);
    expect(cost(out)).toBe(30250);
    // and back to none
    expect(cost(setLineWaste(out, 0))).toBe(27500);
  });
  test("waste typed on the main part is the line's waste", () => {
    const r = setPartWaste([mat({ source: "finish_material" }), lab({ on_gross: true }), mat({ label: "Adhesive" })], 0, 8);
    expect(r.lineWastePct).toBe(8);
    expect(r.components.map((x) => x.waste_pct)).toEqual([8, 8, 0]);
  });
  test("waste typed on another part changes only that part, and the line's waste is left alone", () => {
    const r = setPartWaste([mat({ source: "finish_material", waste_pct: 5 }), lab(), mat({ label: "Adhesive" })], 2, 12);
    expect(r.lineWastePct).toBeUndefined();
    expect(r.components.map((x) => x.waste_pct)).toEqual([5, 0, 12]);
  });
  test("waste typed on labour pays it on the wasted quantity; zero pays it on the measured quantity again", () => {
    const parts = [mat({ source: "finish_material", waste_pct: 5 }), lab()];
    const on = setPartWaste(parts, 1, 5).components;
    expect(on[1]).toMatchObject({ waste_pct: 5, on_gross: true });
    expect(cost(on)).toBe(100 * 1.05 * 400 + Math.round(100 * 1.05 * 75));
    const off = setPartWaste(on, 1, 0).components;
    expect(off[1]).toMatchObject({ waste_pct: 0, on_gross: false });
    expect(cost(off)).toBe(100 * 1.05 * 400 + 7500);
  });
  test("typing waste never touches a cost, so an unknown cost stays unknown", () => {
    const r = setPartWaste([mat({ unit_cost_cents: null })], 0, 5);
    expect(r.components[0]!.unit_cost_cents).toBeNull();
    expect(r.components[0]!.cost_overridden).toBe(false);
  });
  test("the waste shown on the line is the waste its cost really includes", () => {
    expect(lineWasteShown(5, [mat({ waste_pct: 0 }), lab()])).toBe(0); // stored 5 that was never applied
    expect(lineWasteShown(5, [mat({ source: "finish_material", waste_pct: 5 })])).toBe(5);
    expect(lineWasteShown(5, [c({ waste_pct: 5 })])).toBe(0); // a plain cost row with waste not switched on
    expect(lineWasteShown(7, [lab(), lab()])).toBe(7); // nothing to read it from
  });
});

describe("what one purchase unit covers, typed on a line", () => {
  test("changes that part only", () => {
    const parts = [c({ kind: "material", purchase_uom: "pail", cost_uom: "pail", coverage_per_purchase_unit: 250, round_up: true }), c({})];
    const out = setPartCoverage(parts, 0, 200);
    expect(out[0]!.coverage_per_purchase_unit).toBe(200);
    expect(out[1]).toEqual(parts[1]!);
  });
});
