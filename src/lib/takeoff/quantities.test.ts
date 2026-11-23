import { describe, expect, test } from "bun:test";
import { finishLinks, offerUom, takeoffOffers, totalsByFinish, type QtyRow } from "./quantities";

const row = (finish_id: string, section: string, p: Partial<QtyRow> = {}): QtyRow => ({ finish_id, condition_key: "cnd-" + finish_id + section, section, floor_sf: 0, wall_sf: 0, border_sf: 0, lf: 0, ea: 0, ...p });
const line = (id: string, finish_id: string | null, p: Record<string, unknown> = {}) => ({ id, finish_id, source: "takeoff", detached: false, driver_qty: 0, driver_uom: "SF", section: "General", ...p });

describe("totalsByFinish", () => {
  test("adds a finish's conditions together and keeps its sections", () => {
    const t = totalsByFinish([row("f1", "", { floor_sf: 90 }), row("f1", "Level 2", { floor_sf: 45, lf: 10 }), row("f2", "", { ea: 4 })]);
    expect(t["f1"]!.sf).toBe(135);
    expect(t["f1"]!.sy).toBe(15);
    expect(t["f1"]!.bySection["General"]!.sf).toBe(90);
    expect(t["f1"]!.bySection["Level 2"]!.lf).toBe(10);
    expect(t["f2"]!.ea).toBe(4);
  });
  test("wall and border area count as area", () => {
    expect(totalsByFinish([row("f1", "", { floor_sf: 10, wall_sf: 20, border_sf: 5 })])["f1"]!.sf).toBe(35);
  });
});

describe("finishLinks", () => {
  const totals = totalsByFinish([row("f1", "", { floor_sf: 90 }), row("f1", "Level 2", { floor_sf: 45 })]);
  test("a line that follows the takeoff is flagged when the takeoff moves", () => {
    expect(finishLinks([line("a", "f1", { driver_qty: 100, section: "Flooring" })], totals)).toEqual([{ lineId: "a", pricedQty: 100, takeoffQty: 135, changed: true }]);
  });
  test("lines split by section each take their own section", () => {
    const l = finishLinks([line("a", "f1", { driver_qty: 90 }), line("b", "f1", { driver_qty: 5, driver_uom: "SY", section: "Level 2" })], totals);
    expect(l).toEqual([{ lineId: "a", pricedQty: 90, takeoffQty: 90, changed: false }, { lineId: "b", pricedQty: 5, takeoffQty: 5, changed: false }]);
  });
  test("manual, detached and unlinked lines are left alone", () => {
    expect(finishLinks([line("a", "f1", { source: "manual" }), line("b", "f1", { detached: true }), line("c", null)], totals)).toEqual([]);
  });
  test("a finish no longer measured reads zero", () => {
    expect(finishLinks([line("a", "gone", { driver_qty: 12 })], totals)[0]).toMatchObject({ takeoffQty: 0, changed: true });
  });
});

describe("offers", () => {
  const finishes = [{ id: "f1", tag: "CPT-1" }, { id: "f2", tag: "RB-1" }, { id: "f3", tag: "LVT-1" }];
  const totals = totalsByFinish([row("f1", "", { floor_sf: 90 }), row("f1", "Level 2", { floor_sf: 45 }), row("f2", "", { lf: 60 })]);
  test("measured finishes not yet on the price are offered, one per section", () => {
    const o = takeoffOffers([], totals, finishes);
    expect(o.map((x) => [x.tag, x.section, x.measure.sf, x.measure.lf])).toEqual([["CPT-1", "General", 90, 0], ["CPT-1", "Level 2", 45, 0], ["RB-1", "General", 0, 60]]);
  });
  test("a finish already on the price, or with nothing measured, is not offered", () => {
    expect(takeoffOffers([line("a", "f1")], totals, finishes).map((x) => x.tag)).toEqual(["RB-1"]);
  });
  test("the unit follows the assembly when it fits what was measured", () => {
    expect(offerUom({ sf: 90, sy: 10, lf: 0, ea: 0 }, "SY")).toBe("SY");
    expect(offerUom({ sf: 90, sy: 10, lf: 0, ea: 0 }, "LF")).toBe("SF");
    expect(offerUom({ sf: 0, sy: 0, lf: 60, ea: 0 }, null)).toBe("LF");
    expect(offerUom({ sf: 0, sy: 0, lf: 0, ea: 3 }, "SF")).toBe("EA");
  });
});
