import { describe, expect, test } from "bun:test";
import { areaWithCutouts, measureShape, perimeterLessOpenings, polygonArea, polylineLength, recomputeShapes, takeoffLinks, totalsByCondition, type Shape } from "./geometry";
import { calibrate, feetPerPoint, parseScaleText, scaleAt, scaleLabel, suggestScale } from "./scale";

describe("scale", () => {
  test("reads the scales printed on drawings", () => {
    expect(parseScaleText('1/8" = 1\'-0"')).toEqual({ ratio: 96 });
    expect(parseScaleText('1/4" = 1\'-0"')).toEqual({ ratio: 48 });
    expect(parseScaleText('SCALE: 3/16"=1\'-0"')).toEqual({ ratio: 64 });
    expect(parseScaleText('1 1/2" = 1\'-0"')).toEqual({ ratio: 8 });
    expect(parseScaleText("1\" = 20'")).toEqual({ ratio: 240 });
    expect(parseScaleText("1:100")).toEqual({ ratio: 100 });
    expect(parseScaleText("SCALE: N.T.S.")).toBeNull();
    expect(parseScaleText("ROOM 101")).toBeNull();
    expect(parseScaleText("1:0")).toBeNull();
  });
  test("converts a scale to feet per point of paper", () => {
    expect(feetPerPoint(96)).toBeCloseTo(0.11111, 5);
    expect(scaleLabel(feetPerPoint(96))).toBe('1/8" = 1\'-0"');
    expect(scaleLabel(feetPerPoint(100))).toBe("1:100");
    expect(scaleLabel(0.1234)).toBe("1:107 (calibrated)");
  });
  test("suggests a scale only when the sheet states exactly one", () => {
    const page = { width: 2592, height: 1728 };
    expect(suggestScale([{ str: 'SCALE: 1/8" = 1\'-0"', x: 2000, y: 1600 }, { str: "A-101", x: 2400, y: 1650 }], page)).toEqual({ ratio: 96, source: 'SCALE: 1/8" = 1\'-0"' });
    expect(suggestScale([{ str: '1/8" = 1\'-0"', x: 1, y: 1 }, { str: '1/8" = 1\'-0"', x: 9, y: 9 }], page)).toMatchObject({ ratio: 96 });
    expect(suggestScale([{ str: '1/8" = 1\'-0"', x: 1, y: 1 }, { str: '1/4" = 1\'-0"', x: 9, y: 9 }], page)).toBeNull();
    expect(suggestScale([], page)).toBeNull();
    expect(suggestScale([{ str: "N.T.S.", x: 1, y: 1 }], page)).toBeNull();
  });
  test("calibrates from two points and a known length", () => {
    expect(calibrate({ x: 100, y: 100 }, { x: 244, y: 100 }, 16)).toBeCloseTo(0.11111, 5);
    expect(() => calibrate({ x: 1, y: 1 }, { x: 1, y: 1 }, 16)).toThrow("Pick two different points");
    expect(() => calibrate({ x: 1, y: 1 }, { x: 9, y: 1 }, 0)).toThrow("Enter the real length");
  });
  test("an enlarged detail keeps its own scale inside its region", () => {
    const scales = [{ region: null, feet_per_point: 0.111 }, { region: { x: 100, y: 100, width: 200, height: 200 }, feet_per_point: 0.0278 }];
    expect(scaleAt(scales, { x: 150, y: 150 })).toBe(0.0278);
    expect(scaleAt(scales, { x: 500, y: 150 })).toBe(0.111);
    expect(scaleAt([], { x: 1, y: 1 })).toBeNull();
  });
});

const fpp = feetPerPoint(96);
// 20 ft × 15 ft at 1/8" scale is 180 × 135 points.
const rect = [{ x: 100, y: 100 }, { x: 280, y: 100 }, { x: 280, y: 235 }, { x: 100, y: 235 }];
const shape = (o: Partial<Shape>): Shape => ({ id: "s", sheet_id: "sh", condition_id: "c1", kind: "area", vertices: rect, cutouts: [], openings_ft: 0, multiplier: 1, section: null, scale_feet_per_point: fpp, ...o });

describe("geometry", () => {
  test("a 20 ft by 15 ft room is 300 SF, 33.33 SY", () => {
    expect(polygonArea(rect)).toBe(24300);
    const m = measureShape(shape({}));
    expect(m.sf).toBeCloseTo(300, 2);
    expect(m.sy).toBeCloseTo(33.33, 2);
    expect(m.lf).toBeCloseTo(70, 2);
  });
  test("a cut-out comes off the area", () => {
    const hole = [{ x: 120, y: 120 }, { x: 165, y: 120 }, { x: 165, y: 156 }, { x: 120, y: 156 }]; // 5 ft × 4 ft
    expect(areaWithCutouts(rect, [hole])).toBe(24300 - 45 * 36);
    expect(measureShape(shape({ cutouts: [hole] })).sf).toBeCloseTo(280, 2);
  });
  test("door openings come off the perimeter", () => {
    expect(perimeterLessOpenings(rect, 3, fpp)).toBeCloseTo(67, 2);
    expect(measureShape(shape({ openings_ft: 3 })).lf).toBeCloseTo(67, 2);
  });
  test("a typical-floor multiplier repeats the quantity", () => {
    expect(measureShape(shape({ multiplier: 28 })).sf).toBeCloseTo(8400, 1);
  });
  test("the same room drawn on a rotated page measures the same", () => {
    const rotated = rect.map((p) => ({ x: 1728 - p.y, y: p.x }));
    expect(measureShape(shape({ vertices: rotated })).sf).toBeCloseTo(300, 2);
    expect(polygonArea([...rect].reverse())).toBe(24300);
  });
  test("lines measure their length and counts count", () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }])).toBe(180);
    expect(measureShape(shape({ kind: "linear", vertices: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }] })).lf).toBeCloseTo(20, 2);
    expect(measureShape(shape({ kind: "count", vertices: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], multiplier: 2 })).ea).toBe(6);
  });
  test("condition totals add up shapes across sheets, split by section", () => {
    const t = totalsByCondition([shape({ id: "a", section: "Level 2" }), shape({ id: "b", section: "Level 3", multiplier: 2 }), shape({ id: "c", condition_id: "c2", kind: "count", vertices: [{ x: 1, y: 1 }] })]);
    expect(t["c1"]!.sf).toBeCloseTo(900, 1);
    expect(t["c1"]!.bySection["Level 3"]!.sf).toBeCloseTo(600, 1);
    expect(t["c2"]!.ea).toBe(1);
  });
});

describe("takeoff into the estimate", () => {
  const shapes = [shape({ id: "a" }), shape({ id: "b", sheet_id: "other" })];
  test("changing a sheet's scale recomputes its shapes and leaves other sheets alone", () => {
    const next = recomputeShapes(shapes, "sh", feetPerPoint(48));
    expect(measureShape(next[0]!).sf).toBeCloseTo(75, 2);
    expect(measureShape(next[1]!).sf).toBeCloseTo(300, 2);
  });
  test("a linked line is flagged when the takeoff moves, and keeps its priced quantity until accepted", () => {
    const lines = [
      { id: "l1", takeoff_condition_id: "c1", detached: false, driver_qty: 600, driver_uom: "SF" as const, section: "General" },
      { id: "l2", takeoff_condition_id: "c1", detached: true, driver_qty: 123, driver_uom: "SF" as const, section: "General" },
      { id: "l3", takeoff_condition_id: null, detached: false, driver_qty: 5, driver_uom: "SF" as const, section: "General" },
    ];
    expect(takeoffLinks(lines, totalsByCondition(shapes))).toEqual([{ lineId: "l1", pricedQty: 600, takeoffQty: 600, changed: false }]);
    const after = takeoffLinks(lines, totalsByCondition(recomputeShapes(shapes, "sh", feetPerPoint(48))));
    expect(after).toEqual([{ lineId: "l1", pricedQty: 600, takeoffQty: 375, changed: true }]);
  });
  test("a line in square yards or linear feet takes the matching measure; a sectioned line takes its section", () => {
    const totals = totalsByCondition([shape({ id: "a", section: "Level 2" }), shape({ id: "b", section: "Level 3" })]);
    const l = (o: object) => ({ id: "l", takeoff_condition_id: "c1", detached: false, driver_qty: 0, driver_uom: "SF" as const, section: "General", ...o });
    expect(takeoffLinks([l({ driver_uom: "SY" })], totals)[0]!.takeoffQty).toBeCloseTo(66.67, 2);
    expect(takeoffLinks([l({ driver_uom: "LF" })], totals)[0]!.takeoffQty).toBeCloseTo(140, 2);
    expect(takeoffLinks([l({ section: "Level 3" })], totals)[0]!.takeoffQty).toBeCloseTo(300, 2);
  });
});

import { hitTest, parseFeet } from "./geometry";
describe("drawing helpers", () => {
  test("lengths can be typed as feet, feet and inches, or metres", () => {
    expect(parseFeet("16")).toBe(16);
    expect(parseFeet("16'")).toBe(16);
    expect(parseFeet("16' 6\"")).toBe(16.5);
    expect(parseFeet("16-6")).toBe(16.5);
    expect(parseFeet("6\"")).toBe(0.5);
    expect(parseFeet("3 m")).toBeCloseTo(9.8425, 4);
    expect(parseFeet("3000mm")).toBeCloseTo(9.8425, 4);
    expect(parseFeet("abc")).toBeNull();
    expect(parseFeet("0")).toBeNull();
  });
  test("clicking picks the shape under the pointer: inside an area, near a line, on a count mark", () => {
    const area = shape({ id: "area" });
    const line = shape({ id: "line", kind: "linear", vertices: [{ x: 400, y: 100 }, { x: 600, y: 100 }] });
    const count = shape({ id: "count", kind: "count", vertices: [{ x: 700, y: 300 }] });
    const all = [area, line, count];
    expect(hitTest(all, { x: 150, y: 150 }, 6)).toBe("area");
    expect(hitTest(all, { x: 500, y: 104 }, 6)).toBe("line");
    expect(hitTest(all, { x: 500, y: 120 }, 6)).toBeNull();
    expect(hitTest(all, { x: 703, y: 298 }, 6)).toBe("count");
    expect(hitTest(all, { x: 900, y: 900 }, 6)).toBeNull();
    // A line drawn over a room is picked ahead of the room beneath it.
    expect(hitTest([area, shape({ id: "base", kind: "linear", vertices: [{ x: 100, y: 150 }, { x: 280, y: 150 }] })], { x: 150, y: 151 }, 6)).toBe("base");
  });
});
