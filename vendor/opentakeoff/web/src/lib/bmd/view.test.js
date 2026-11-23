import { describe, expect, test } from "bun:test";
import { fitView, nearShape, toImage, zoomAt } from "./view.js";

describe("looking at a sheet", () => {
  test("a sheet is fitted inside the window with a margin and centred", () => {
    const v = fitView({ w: 2000, h: 1000 }, { w: 1000, h: 800 }, 20);
    expect(v.k).toBeCloseTo(0.48);
    expect(v.x).toBeCloseTo(20);
    expect(v.y).toBeCloseTo((800 - 480) / 2);
  });
  test("zooming keeps the point under the pointer where it is", () => {
    const v = { k: 0.5, x: 100, y: 50 };
    const before = toImage(v, 400, 300);
    const z = zoomAt(v, 400, 300, 2);
    const after = toImage(z, 400, 300);
    expect(z.k).toBe(1);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });
  test("zoom stops at sensible limits", () => {
    expect(zoomAt({ k: 0.03, x: 0, y: 0 }, 0, 0, 0.1).k).toBe(0.02);
    expect(zoomAt({ k: 10, x: 0, y: 0 }, 0, 0, 5).k).toBe(12);
  });
  test("a click picks the measurement under it: inside an area, near a line, on a count mark", () => {
    const dims = { w: 1000, h: 1000 };
    const area = { id: "a", measure_role: "floor_area", verts_norm: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]] };
    const line = { id: "l", measure_role: "linear", verts_norm: [[0.5, 0.5], [0.9, 0.5]] };
    const mark = { id: "c", measure_role: "count", verts_norm: [[0.7, 0.2]] };
    const all = [area, line, mark];
    expect(nearShape(all, dims, 200, 200, 8)?.id).toBe("a");
    expect(nearShape(all, dims, 700, 504, 8)?.id).toBe("l");
    expect(nearShape(all, dims, 703, 203, 8)?.id).toBe("c");
    expect(nearShape(all, dims, 50, 900, 8)).toBeNull();
  });
});
