import { describe, expect, test } from "bun:test";
import { emptyAnnotations } from "../store.js";
import { heightText, parseHeight } from "./feet.js";
import { addCondition, addShape, finishTotals, setScale, setShapeFinish, setShapeHeight, sheetKey, wallRun } from "./takeoffDoc.js";
import { takeoffQuantities } from "./quantities.js";
import { conditionTotals } from "../totals.js";

// 12 image pixels to the foot, so an inch is one pixel.
const dims = { w: 2000, h: 1000 }, key = sheetKey("Plans.pdf", 4), UPP = 1 / 12;
const start = () => setScale(addCondition(addCondition(emptyAnnotations(), "WT-1"), "CT-1"), key, UPP, "standard", dims);
const wall = (doc, pointsPx, heightFt, extra = {}) => addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "surface_area", pointsPx, dims, heightFt, ...extra });
const BACKSPLASH = [[100, 100], [220, 100]];                       // 10 ft
const SURROUND = [[300, 300], [300, 330], [360, 330], [360, 300]];   // 30 in, 60 in, 30 in

describe("a height typed in feet or inches", () => {
  test("marked values are read as marked", () => {
    expect(parseHeight('18"')).toBe(1.5);
    expect(parseHeight("18 in")).toBe(1.5);
    expect(parseHeight("72 inches")).toBe(6);
    expect(parseHeight("6'")).toBe(6);
    expect(parseHeight("6 ft")).toBe(6);
    expect(parseHeight("6' 6\"")).toBe(6.5);
    expect(parseHeight("6-6")).toBe(6.5);
    expect(parseHeight("4.5 ft")).toBe(4.5);
  });
  test("a bare number takes the unit chosen beside it", () => {
    expect(parseHeight("18", "in")).toBe(1.5);
    expect(parseHeight("6", "ft")).toBe(6);
    expect(parseHeight("18")).toBe(1.5);   // inches unless feet is chosen
  });
  test("nothing, zero, words or a height taller than a building are refused", () => {
    for (const bad of ["", "0", "abc", "-4", "0 in", "500 ft"]) expect(Number.isNaN(parseHeight(bad))).toBe(true);
  });
  test("a height is written back the way an installer says it", () => {
    expect([1.5, 6, 6.5, 0.5, 4, 2.5, 8.25].map(heightText)).toEqual(["18 in", "6 ft", "6 ft 6 in", "6 in", "4 ft", "30 in", "8 ft 3 in"]);
  });
});

describe("wall tile: a line on the plan and a height", () => {
  test("a 10 ft backsplash 18 in high is 15 SF of wall", () => {
    const doc = wall(start(), BACKSPLASH, 1.5);
    const s = doc.shapes[0];
    expect(s).toMatchObject({ measure_role: "surface_area", height_ft: 1.5, height_override: true });
    expect(s.computed).toEqual({ area_sf: 15, perimeter_lf: 10 });
    expect(s.origin).toMatchObject({ method: "manual", reviewed: true });
  });
  test("a tub surround, 30 in + 60 in + 30 in at 6 ft, is 60 SF, and reads back wall by wall", () => {
    const doc = wall(start(), SURROUND, 6);
    expect(doc.shapes[0].computed).toEqual({ area_sf: 60, perimeter_lf: 10 });
    expect(wallRun(doc.shapes[0], dims, UPP)).toEqual({ lengthsFt: [2.5, 5, 2.5], lengthFt: 10, heightFt: 6, areaSf: 60, text: "30 in + 5 ft + 30 in = 10 ft long × 6 ft high = 60.0 SF" });
  });
  test("a double-click's repeated last point is not a wall of its own, and lengths read to a tenth of an inch", () => {
    const doc = wall(start(), [[100, 100], [220, 100], [220, 100]], 1.5);
    expect(doc.shapes[0].verts_norm.length).toBe(2);
    expect(wallRun(doc.shapes[0], dims, UPP).text).toBe("10 ft long × 18 in high = 15.0 SF");
    expect(heightText(18.87)).toBe("18 ft 10.4 in");
  });
  test("a wall needs a height, a scale and at least two points", () => {
    expect(() => wall(start(), BACKSPLASH, 0)).toThrow("Type how high the tile goes");
    expect(() => wall(start(), BACKSPLASH, undefined)).toThrow("Type how high the tile goes");
    expect(() => wall(start(), [[1, 1]], 6)).toThrow("Click at least two points");
    expect(() => addShape(addCondition(emptyAnnotations(), "WT-1"), { sheetId: key, conditionId: "x", role: "surface_area", pointsPx: BACKSPLASH, dims, heightFt: 6 })).toThrow();
  });
  test("each wall keeps its own height; changing one changes only that wall", () => {
    let doc = wall(wall(start(), BACKSPLASH, 1.5), SURROUND, 6);
    doc = setShapeHeight(doc, doc.shapes[0].id, 2, dims);
    expect(doc.shapes.map((s) => [s.height_ft, s.computed.area_sf])).toEqual([[2, 20], [6, 60]]);
    expect(() => setShapeHeight(doc, doc.shapes[0].id, 0, dims)).toThrow("Type how high the tile goes");
    expect(setShapeHeight(doc, "nope", 3, dims)).toBe(doc);
  });
  test("moving a wall to another finish keeps the height typed for it", () => {
    let doc = wall(start(), BACKSPLASH, 1.5);
    doc = setShapeFinish(doc, doc.shapes[0].id, doc.conditions[1].id, dims);
    expect(doc.shapes[0]).toMatchObject({ condition_id: doc.conditions[1].id, height_ft: 1.5 });
    expect(doc.shapes[0].computed.area_sf).toBe(15);
  });
  test("the finish's totals show wall SF apart from floor SF", () => {
    let doc = wall(wall(start(), BACKSPLASH, 1.5), SURROUND, 6);
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: [[500, 500], [620, 500], [620, 620], [500, 620]], dims });
    expect(finishTotals(doc)[0]).toMatchObject({ areaSf: 100, wallSf: 75 });
    expect(conditionTotals(doc.conditions, doc.shapes)[0]).toMatchObject({ floor_sf: 100, wall_sf: 75 });
  });
});

describe("wall tile on the estimate", () => {
  test("walls are their own section, so they get their own line and their own labour", () => {
    let doc = wall(wall(start(), BACKSPLASH, 1.5), SURROUND, 6);
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: [[500, 500], [620, 500], [620, 620], [500, 620]], dims });
    expect(takeoffQuantities(doc).rows.map((r) => [r.section, r.floor_sf, r.wall_sf])).toEqual([["Walls", 0, 75], ["", 100, 0]]);
  });
  test("a wall with an area name is that area's walls", () => {
    const doc = wall(start(), SURROUND, 6, { area: "Suite Type B" });
    expect(takeoffQuantities(doc).rows.map((r) => [r.section, r.wall_sf])).toEqual([["Suite Type B walls", 60]]);
  });
});
