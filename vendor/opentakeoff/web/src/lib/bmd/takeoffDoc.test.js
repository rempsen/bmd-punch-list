import { describe, expect, test } from "bun:test";
import { emptyAnnotations } from "../store.js";
import { addCondition, addShape, finishTotals, removeShape, renameCondition, reshapeShape, scaleFor, setScale, setShapeArea, setShapeFinish, sheetKey, sheetShapes, updateCondition } from "./takeoffDoc.js";

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
  test("a measurement can be given a new outline (a room with its cabinets included) and is measured again, keeping what it is", () => {
    let doc = setScale(addCondition(emptyAnnotations(), "LVT-1"), key, 0.05, "detected", dims);
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "floor_area", pointsPx: square, dims, method: "one_click_v1", area: "Level 2" });
    const before = doc.shapes[0];
    const next = reshapeShape(doc, before.id, [[100, 100], [400, 100], [400, 300], [100, 300]], dims, { fixtures_included: true });
    const s = next.shapes[0];
    expect(next.shapes).toHaveLength(1);
    expect(s).toMatchObject({ id: before.id, condition_id: before.condition_id, label: "Level 2", computed: { area_sf: 150, perimeter_lf: 50 } });
    expect(s.verts_norm[1]).toEqual([0.2, 0.1]);
    expect(s.origin).toMatchObject({ method: "one_click_v1", reviewed: true, fixtures_included: true });
    expect(doc.shapes[0].computed.area_sf).toBe(100);   // the document it came from is untouched, so undo is one step
    expect(reshapeShape(doc, "shp-missing", square, dims)).toBe(doc);
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

describe("changing the finish of something already measured", () => {
  const twoFinishes = () => {
    let doc = setScale(addCondition(addCondition(emptyAnnotations(), "CPT-1"), "LVT-1"), key, 0.05, "detected", dims);
    const [cpt, lvt] = doc.conditions;
    doc = addShape(doc, { sheetId: key, conditionId: cpt.id, role: "floor_area", pointsPx: square, dims, method: "one_click_v1", area: "Level 2" });
    return { doc, cpt, lvt, room: doc.shapes[0] };
  };

  test("a room moves to the new finish, keeping its outline, area name and how it was made, and the totals follow", () => {
    const { doc, cpt, lvt, room } = twoFinishes();
    const next = setShapeFinish(doc, room.id, lvt.id, dims);
    expect(next.shapes[0]).toMatchObject({ id: room.id, condition_id: lvt.id, label: "Level 2", verts_norm: room.verts_norm, origin: room.origin, computed: { area_sf: 100 } });
    const totals = Object.fromEntries(finishTotals(next).map((t) => [t.tag, t.areaSf]));
    expect(totals).toEqual({ "CPT-1": 0, "LVT-1": 100 });
    expect(next.conditions).toEqual(doc.conditions);
    expect(cpt.id).not.toBe(lvt.id);
  });

  test("a cut-out made in that room goes with it, so the old finish is not left with a negative area", () => {
    const { doc, lvt, room } = twoFinishes();
    const cut = { id: "shp-cut", sheet_id: key, condition_id: room.condition_id, measure_role: "deduct", cuts_shape_id: room.id, verts_norm: [[0.06, 0.12], [0.08, 0.12], [0.08, 0.16], [0.06, 0.16]], origin: { method: "manual", reviewed: true } };
    const withCut = { ...doc, shapes: [...doc.shapes, cut] };
    const next = setShapeFinish(withCut, room.id, lvt.id, dims);
    expect(next.shapes.find((s) => s.id === "shp-cut").condition_id).toBe(lvt.id);
  });

  test("its height-based quantities are worked out again at the new finish's height", () => {
    let doc = setScale(addCondition(addCondition(emptyAnnotations(), "WC-1"), "WC-2"), key, 0.05, "detected", dims);
    doc = updateCondition(updateCondition(doc, doc.conditions[0].id, { height_ft: 4 }), doc.conditions[1].id, { height_ft: 8 });
    doc = addShape(doc, { sheetId: key, conditionId: doc.conditions[0].id, role: "surface_area", pointsPx: [[100, 100], [300, 100]], dims });
    const wall = doc.shapes[0];
    expect(wall.computed).toMatchObject({ perimeter_lf: 10, area_sf: 40 });
    const next = setShapeFinish(doc, wall.id, doc.conditions[1].id, dims);
    expect(next.shapes[0].computed).toMatchObject({ perimeter_lf: 10, area_sf: 80 });
  });

  test("an unknown finish is refused; an unknown measurement or the same finish changes nothing", () => {
    const { doc, cpt, room } = twoFinishes();
    expect(() => setShapeFinish(doc, room.id, "cnd-nope", dims)).toThrow(/finish/i);
    expect(setShapeFinish(doc, "shp-nope", cpt.id, dims)).toBe(doc);
    expect(setShapeFinish(doc, room.id, cpt.id, dims)).toBe(doc);
  });
});
