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
