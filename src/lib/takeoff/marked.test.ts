import { describe, expect, test } from "bun:test";
import { chosenDrawings, drawingFiles, measuredSheets, sheetLabel, sheetMarks, splitSheetKey } from "./marked";

const doc = {
  conditions: [
    { id: "c1", finish_tag: "CPT-1", color: "#2f7d4f" },
    { id: "c2", finish_tag: "RB-1", color: "#334155" },
    { id: "c3", finish_tag: "TR-1", color: "#c2410c" },
  ],
  shapes: [
    { id: "a", sheet_id: "Arch Set.pdf#4", condition_id: "c1", measure_role: "floor_area", verts_norm: [[0, 0], [0.5, 0], [0.5, 0.5]], verts_norm_holes: [[[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]], computed: { area_sf: 400.4, perimeter_lf: 80 } },
    { id: "b", sheet_id: "Arch Set.pdf#4", condition_id: "c1", measure_role: "deduct", verts_norm: [[0, 0], [0.1, 0], [0.1, 0.1]], computed: { area_sf: 20 } },
    { id: "b2", sheet_id: "Arch Set.pdf#4", condition_id: "c1", measure_role: "deduct", cuts_shape_id: "a", verts_norm: [[0, 0], [0.1, 0], [0.1, 0.1]], computed: { area_sf: 15 } },
    { id: "c", sheet_id: "Arch Set.pdf#4", condition_id: "c2", measure_role: "linear", verts_norm: [[0, 0], [1, 1]], computed: { perimeter_lf: 136.04 } },
    { id: "d", sheet_id: "Arch Set.pdf#4", condition_id: "c3", measure_role: "count", verts_norm: [[0.3, 0.3]], computed: {} },
    { id: "e", sheet_id: "Arch Set.pdf#4", condition_id: "c3", measure_role: "count", verts_norm: [[0.4, 0.3]], computed: { count: 1 } },
    { id: "f", sheet_id: "Arch Set.pdf#12", condition_id: "c1", measure_role: "floor_area", verts_norm: [[0, 0], [1, 0], [1, 1]], computed: { area_sf: 90 } },
    { id: "g", sheet_id: "Arch Set.pdf#2", condition_id: "c1", measure_role: "floor_area", verts_norm: [[0, 0], [1, 0], [1, 1]], computed: { area_sf: 50 }, origin: { reviewed: false } },
    { id: "h", sheet_id: "A#1.pdf#3", condition_id: "gone", measure_role: "floor_area", verts_norm: [[0, 0], [1, 0], [1, 1]], computed: { area_sf: 10 } },
  ],
};

describe("which sheets can go on a quote", () => {
  test("a sheet key is split at its last #, so file names may contain one", () => {
    expect(splitSheetKey("A#1.pdf#3")).toEqual({ file: "A#1.pdf", page: 3 });
    expect(splitSheetKey("nonsense")).toBeNull();
  });
  test("only sheets with accepted measurements, in file then page order", () => {
    expect(measuredSheets(doc).map((s) => [s.key, s.shapes])).toEqual([["A#1.pdf#3", 1], ["Arch Set.pdf#4", 6], ["Arch Set.pdf#12", 1]]);
    expect(measuredSheets(null)).toEqual([]);
  });
  test("a sheet is named by its number from the title block, else by file and page", () => {
    expect(sheetLabel("Arch Set.pdf#4", { "Arch Set.pdf#4": "A-100" })).toBe("A-100");
    expect(sheetLabel("Arch Set.pdf#4", {})).toBe("Arch Set, page 4");
  });
});

describe("what is drawn on a marked-up sheet", () => {
  const m = sheetMarks(doc, "Arch Set.pdf#4");
  test("each measurement keeps its finish colour and shape", () => {
    expect(m.marks.map((x) => [x.kind, x.colour])).toEqual([["area", "#2f7d4f"], ["cut", "#2f7d4f"], ["cut", "#2f7d4f"], ["line", "#334155"], ["count", "#c2410c"], ["count", "#c2410c"]]);
    expect(m.marks[0]!.holes.length).toBe(1);
  });
  test("the key lists each finish once with what was measured on this sheet, cut-outs taken off once", () => {
    expect(m.key).toEqual([
      { label: "CPT-1", colour: "#2f7d4f", kind: "area", quantity: "380 SF" },
      { label: "RB-1", colour: "#334155", kind: "line", quantity: "136 LF" },
      { label: "TR-1", colour: "#c2410c", kind: "count", quantity: "2 EA" },
    ]);
  });
  test("measurements waiting for review and other sheets are left off", () => {
    expect(sheetMarks(doc, "Arch Set.pdf#2").marks).toEqual([]);
    expect(sheetMarks(doc, "Arch Set.pdf#12").key[0]!.quantity).toBe("90 SF");
  });
});

describe("the drawings chosen for a quote", () => {
  test("come out in sheet order with their names, and a sheet no longer measured is dropped", () => {
    const out = chosenDrawings(["Arch Set.pdf#12", "Arch Set.pdf#4", "Arch Set.pdf#2", "Gone.pdf#1"], doc, { "Arch Set.pdf#4": "A-100" });
    expect(out).toEqual([
      { key: "Arch Set.pdf#4", file: "Arch Set.pdf", page: 4, label: "A-100" },
      { key: "Arch Set.pdf#12", file: "Arch Set.pdf", page: 12, label: "Arch Set, page 12" },
    ]);
  });
});

describe("finding the document behind a sheet", () => {
  const row = (id: string, section: string, file_name: string, version: number) => ({ id, section, file_name, version, storage_path: `p/${id}`, mime: file_name.endsWith(".jpg") ? "image/jpeg" : "application/pdf" });
  test("the newest version of each plan is used, named the way the takeoff names it", () => {
    const files = drawingFiles([row("1", "plans", "A.pdf", 1), row("2", "plans", "A.pdf", 2), row("3", "specifications", "A.pdf", 1), row("4", "specifications", "Spec.pdf", 1), row("5", "plans", "photo.jpg", 1), row("6", "quotes", "Q.pdf", 1)]);
    expect([...files.keys()]).toEqual(["A.pdf", "Specifications - A.pdf", "Spec.pdf"]);
    expect(files.get("A.pdf")).toEqual({ id: "2", path: "p/2" });
    expect(files.get("Specifications - A.pdf")!.id).toBe("3");
  });
});
