import { describe, expect, test } from "bun:test";
import { clampView, filterSheets, fitView, sheetLabel, zoomAt } from "./view";

const page = { width: 2592, height: 1728 }; // a 36 × 24 in sheet, in points
const box = { width: 1200, height: 700 };

describe("plan view", () => {
  test("a sheet opens fitted inside the window and centred", () => {
    const v = fitView(page, box);
    expect(v.scale).toBeCloseTo(700 / 1728, 5);
    expect(v.x).toBeCloseTo((1200 - 2592 * v.scale) / 2, 3);
    expect(v.y).toBeCloseTo(0, 3);
  });
  test("zooming keeps the point under the pointer still", () => {
    const v = fitView(page, box);
    const at = { x: 900, y: 200 };
    const before = { x: (at.x - v.x) / v.scale, y: (at.y - v.y) / v.scale };
    const z = zoomAt(v, 2, at, page, box);
    expect(z.scale).toBeCloseTo(v.scale * 2, 5);
    expect((at.x - z.x) / z.scale).toBeCloseTo(before.x, 3);
    expect((at.y - z.y) / z.scale).toBeCloseTo(before.y, 3);
  });
  test("zoom stops at sensible limits, and the sheet cannot be dragged out of sight", () => {
    const v = fitView(page, box);
    expect(zoomAt(v, 1000, { x: 0, y: 0 }, page, box).scale).toBe(12);
    expect(zoomAt(v, 0.0001, { x: 0, y: 0 }, page, box).scale).toBeCloseTo(v.scale / 2, 5);
    const lost = clampView({ scale: 1, x: 99999, y: -99999 }, page, box);
    expect(lost.x).toBe(1200 - 80);
    expect(lost.y).toBe(80 - 1728);
  });
});

describe("sheets", () => {
  const sheets = [
    { id: "1", page_number: 1, sheet_number: "A-101", title: "Level 1 Floor Plan" },
    { id: "2", page_number: 2, sheet_number: null, title: null },
    { id: "3", page_number: 12, sheet_number: "ID-201", title: "Finish Plan Level 2" },
  ];
  test("a sheet without a number is known by its page", () => {
    expect(sheets.map(sheetLabel)).toEqual(["A-101", "Page 2", "ID-201"]);
  });
  test("search matches the sheet number, the title or the page number, in any case", () => {
    expect(filterSheets(sheets, "finish").map((s) => s.id)).toEqual(["3"]);
    expect(filterSheets(sheets, "a-1").map((s) => s.id)).toEqual(["1"]);
    expect(filterSheets(sheets, "12").map((s) => s.id)).toEqual(["3"]);
    expect(filterSheets(sheets, "page 2").map((s) => s.id)).toEqual(["2"]);
    expect(filterSheets(sheets, "  ").length).toBe(3);
  });
});
