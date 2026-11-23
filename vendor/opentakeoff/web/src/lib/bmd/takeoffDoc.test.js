import { describe, expect, test } from "bun:test";
import { emptyAnnotations } from "../store.js";
import { addCondition, addShape, finishTotals, removeShape, renameCondition, scaleFor, setScale, setShapeArea, sheetKey, sheetShapes, updateCondition } from "./takeoffDoc.js";

const dims = { w: 2000, h: 1000 };
const key = sheetKey("Plans.pdf", 4);
const square = [[100, 100], [300, 100], [300, 300], [100, 300]];   // 200 px a side

describe("the takeoff document, in OpenTakeoff's own format", () => {
  test("a sheet is named by its file and page, as the full workspace names it", () => {
    expect(key).toBe("Plans.pdf#4");
  });
  test("a new finish gets a colour and a hatch, and never a waste factor (waste is added on the estimate)", () => {
    const doc = addCondition(emptyAnnotations(), "LVT-1");
    const c = doc.conditions[0];
    expect(c).toMatchObject({ finish_tag: "LVT-1", multiplier: 1, waste_pct: 0, materials: [] });
    expect(c.color).toMatch(/^#/);
    expect(c.hatch).toBeTruthy();
    expect(addCondition(doc, "LVT-1").conditions).toHaveLength(1);
    expect(addCondition(doc, "CPT-1").conditions[1].color).not.toBe(c.color);
  });
  test("an area is stored as the full workspace stores it and measured at the sheet's scale", () => {
    let doc = setScale(addCondition(emptyAnnotations(), "LVT-1"), key, 0.05, "detected", dims);
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: square, dims, method: "one_click_v1" });
    const s = doc.shapes[0];
    expect(s).toMatchObject({ sheet_id: key, measure_role: "floor_area", computed: { area_sf: 100, perimeter_lf: 40 } });
    expect(s.verts_norm[0]).toEqual([0.05, 0.1]);
    expect(s.origin).toMatchObject({ method: "one_click_v1", reviewed: true });
    expect(s.id).toMatch(/^shp-/);
  });
  test("nothing is measured on a sheet that has no scale", () => {
    const doc = addCondition(emptyAnnotations(), "LVT-1");
    expect(() => addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: square, dims })).toThrow("Set the scale for this sheet first.");
  });
  test("a line, a count and a cut-out each measure as what they are", () => {
    let doc = setScale(addCondition(emptyAnnotations(), "RB-1"), key, 0.05, "standard", dims);
    const c = doc.conditions[0].id;
    doc = addShape(doc, { sheetId: key, conditionId: c, role: "linear", pointsPx: [[0, 0], [200, 0], [200, 100]], dims });
    doc = addShape(doc, { sheetId: key, conditionId: c, role: "count", pointsPx: [[50, 50]], dims });
    doc = addShape(doc, { sheetId: key, conditionId: c, role: "floor_area", pointsPx: square, dims });
    doc = addShape(doc, { sheetId: key, conditionId: c, role: "deduct", pointsPx: [[150, 150], [250, 150], [250, 250], [150, 250]], dims });
    expect(doc.shapes.map((s) => [s.measure_role, s.computed])).toEqual([
      ["linear", { perimeter_lf: 15, area_sf: 0 }],
      ["count", { count: 1 }],
      ["floor_area", { area_sf: 100, perimeter_lf: 40 }],
      ["deduct", { area_sf: 25, perimeter_lf: 20 }],
    ]);
    expect(finishTotals(doc)[0]).toMatchObject({ tag: "RB-1", areaSf: 75, lengthLf: 15, count: 1, shapes: 4 });
  });
  test("changing a sheet's scale re-measures what is on that sheet and nothing else", () => {
    let doc = setScale(addCondition(emptyAnnotations(), "LVT-1"), key, 0.05, "detected", dims);
    doc = setScale(doc, "Plans.pdf#5", 0.05, "detected", dims);
    const c = doc.conditions[0].id;
    doc = addShape(doc, { sheetId: key, conditionId: c, role: "floor_area", pointsPx: square, dims });
    doc = addShape(doc, { sheetId: "Plans.pdf#5", conditionId: c, role: "floor_area", pointsPx: square, dims });
    doc = setScale(doc, key, 0.1, "calibrated", dims);
    expect(scaleFor(doc, key)).toMatchObject({ upp: 0.1, source: "calibrated" });
    expect(sheetShapes(doc, key)[0].computed.area_sf).toBe(400);
    expect(sheetShapes(doc, "Plans.pdf#5")[0].computed.area_sf).toBe(100);
  });
  test("totals are measured quantities with no waste added, by finish", () => {
    let doc = setScale(addCondition(addCondition(emptyAnnotations(), "LVT-1"), "CPT-1"), key, 0.05, "detected", dims);
    doc = updateCondition(doc, doc.conditions[0].id, { waste_pct: 10 });   // set in the full workspace by someone
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: square, dims });
    const t = finishTotals(doc);
    expect(t.map((r) => [r.tag, r.areaSf, r.areaSy])).toEqual([["LVT-1", 100, 11.11], ["CPT-1", 0, 0]]);
  });
  test("removing a measurement leaves everything else in the document alone", () => {
    let doc = { ...setScale(addCondition(emptyAnnotations(), "LVT-1"), key, 0.05, "detected", dims), markups: [{ id: "m1" }], project_name: "Test" };
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: square, dims });
    const after = removeShape(doc, doc.shapes[0].id);
    expect(after.shapes).toEqual([]);
    expect(after.markups).toEqual([{ id: "m1" }]);
    expect(after.project_name).toBe("Test");
  });
  test("a finish can be renamed, but not to a blank tag or another finish's tag", () => {
    const doc = addCondition(addCondition(emptyAnnotations(), "LVT-1"), "CPT-1");
    const id = doc.conditions[0].id;
    expect(renameCondition(doc, id, " LVT-2 ").conditions[0].finish_tag).toBe("LVT-2");
    expect(() => renameCondition(doc, id, "  ")).toThrow();
    expect(() => renameCondition(doc, id, "cpt-1")).toThrow(/already/);
    expect(renameCondition(doc, id, "lvt-1").conditions[0].finish_tag).toBe("lvt-1");
  });
  test("a measurement can be given an area name, which joins the project's list of areas", () => {
    let doc = setScale(addCondition(emptyAnnotations(), "LVT-1"), key, 0.05, "standard", dims);
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: square, dims, area: "Level 2" });
    expect(doc.shapes[0].label).toBe("Level 2");
    expect(doc.shape_labels).toEqual(["Level 2"]);
    doc = setShapeArea(doc, doc.shapes[0].id, "Corridors");
    expect(doc.shapes[0].label).toBe("Corridors");
    expect(doc.shape_labels).toEqual(["Level 2", "Corridors"]);
    doc = setShapeArea(doc, doc.shapes[0].id, "  ");
    expect("label" in doc.shapes[0]).toBe(false);
  });
});
