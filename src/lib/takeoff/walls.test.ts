import { describe, expect, test } from "bun:test";
import { edgeText, lineWallEdges, wallEdgesByFinish } from "./walls";

const wall = (id: string, cond: string, lf: number, height: number, extra: Record<string, unknown> = {}) => ({ id, condition_id: cond, measure_role: "surface_area", height_ft: height, computed: { perimeter_lf: lf, area_sf: lf * height }, origin: { method: "manual", reviewed: true }, ...extra });
const doc = {
  conditions: [{ id: "c-wt", finish_tag: "WT-1" }, { id: "c-ct", finish_tag: "CT-1", multiplier: 2 }],
  shapes: [
    wall("surround", "c-wt", 10, 6),                       // 30 in + 60 in + 30 in at 6 ft
    wall("splash", "c-wt", 10, 1.5),                       // backsplash, 18 in
    wall("b", "c-wt", 8, 4, { label: "Suite Type B" }),
    wall("x2", "c-ct", 5, 3),                              // a finish counted twice over
    wall("p", "c-wt", 99, 9, { origin: { method: "auto_v1", reviewed: false } }),
    { id: "floor", condition_id: "c-wt", measure_role: "floor_area", computed: { area_sf: 50, perimeter_lf: 30 }, origin: { reviewed: true } },
  ],
};
const LINKS = [{ condition_key: "c-wt", finish_id: "f-wt" }, { condition_key: "c-ct", finish_id: "f-ct" }];
const edges = wallEdgesByFinish(doc, LINKS);
const line = (o: Record<string, unknown> = {}) => ({ id: "L", finish_id: "f-wt", source: "takeoff", detached: false, driver_qty: 75, driver_uom: "SF", section: "Walls", ...o });

describe("the edges of tiled walls, from the takeoff", () => {
  test("per finish and estimate section: the top of every run and its two ends", () => {
    expect(edges["f-wt"]!.bySection["Walls"]).toEqual({ runs: 2, topLf: 20, endsLf: 15, allLf: 35 });
    expect(edges["f-wt"]!.bySection["Suite Type B walls"]).toEqual({ runs: 1, topLf: 8, endsLf: 8, allLf: 16 });
    expect(edges["f-wt"]!.total).toEqual({ runs: 3, topLf: 28, endsLf: 23, allLf: 51 });
    expect(edges["f-ct"]!.total).toEqual({ runs: 2, topLf: 10, endsLf: 12, allLf: 22 });
  });
  test("a wall tile line gets the edges of its own section", () => {
    const a = line(), b = line({ id: "L2", section: "Suite Type B walls", driver_qty: 32 });
    expect(lineWallEdges(a, [a, b], edges)).toEqual({ runs: 2, topLf: 20, endsLf: 15, allLf: 35 });
    expect(lineWallEdges(b, [a, b], edges)!.allLf).toBe(16);
  });
  test("none for a line that does not follow the takeoff, or a finish with no walls", () => {
    for (const l of [line({ source: "manual" }), line({ detached: true }), line({ finish_id: null }), line({ finish_id: "nope" })]) expect(lineWallEdges(l, [l], edges)).toBeNull();
  });
  test("written out for the person answering", () => {
    expect(edgeText({ runs: 2, topLf: 20, endsLf: 15, allLf: 35 })).toBe("The takeoff has 2 runs: 20 LF along the top and 15 LF up the ends, 35 LF in all.");
    expect(edgeText({ runs: 1, topLf: 8, endsLf: 8, allLf: 16 })).toBe("The takeoff has 1 run: 8 LF along the top and 8 LF up the ends, 16 LF in all.");
  });
});
