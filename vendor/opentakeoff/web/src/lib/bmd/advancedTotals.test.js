import { describe, expect, test } from "bun:test";
import { conditionTotals, sheetTotals, sheetGroupedRows, verticalWallSf } from "../totals.js";

// The advanced takeoff screen totals through lib/totals.js. An automatic-takeoff proposal nobody has accepted
// must not be counted there either — the same rule the simple screen and the estimate already follow.
const cond = { id: "c1", name: "CPT-1", finish_tag: "CPT-1", multiplier: 1, waste_pct: 0 };
const area = (id, sf, origin) => ({ id, sheet_id: "s1", condition_id: "c1", measure_role: "floor_area", computed: { area_sf: sf, perimeter_lf: 40 }, ...(origin ? { origin } : {}) });
const shapes = [
  area("drawn", 100, { method: "manual", reviewed: true }),
  area("old", 50),
  area("accepted", 25, { method: "auto_v1", reviewed: true }),
  area("proposal", 999, { method: "auto_v1", reviewed: false }),
];

describe("advanced takeoff totals", () => {
  test("a proposal that has not been accepted is not counted", () => {
    expect(conditionTotals([cond], shapes)[0].floor_sf).toBe(175);
  });
  test("the per-sheet and grouped totals leave it out too", () => {
    expect(sheetTotals([cond], shapes)[0].rows[0].floor_sf).toBe(175);
    expect(sheetGroupedRows([cond], shapes)[0].rows[0].floor_sf).toBe(175);
    expect(verticalWallSf(shapes, "c1", 10)).toBe(1200);
  });
  test("a sheet holding only proposals shows no rows at all", () => {
    expect(sheetTotals([cond], [area("p", 10, { method: "auto_v1", reviewed: false })])).toEqual([]);
  });
});
