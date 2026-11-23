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
