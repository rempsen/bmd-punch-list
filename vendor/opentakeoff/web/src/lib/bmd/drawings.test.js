import { describe, expect, test } from "bun:test";
import { MAX_DRAWING_BYTES, labelsToSave, mergeSheets, pickDrawings } from "./drawings.js";

const f = (name, type = "application/pdf", size = 1000) => ({ name, type, size });

describe("choosing which dropped files are drawings", () => {
  test("PDFs are kept, by type or by name", () => {
    const { pdfs, refused } = pickDrawings([f("A-101.pdf"), f("PLANS.PDF", ""), f("scan", "application/pdf")]);
    expect(pdfs.map((x) => x.name)).toEqual(["A-101.pdf", "PLANS.PDF", "scan"]);
    expect(refused).toEqual([]);
  });
  test("anything else is refused with a plain reason", () => {
    const { pdfs, refused } = pickDrawings([f("photo.jpg", "image/jpeg"), f("plan.dwg", ""), f("empty.pdf", "application/pdf", 0), f("huge.pdf", "application/pdf", MAX_DRAWING_BYTES + 1)]);
    expect(pdfs).toEqual([]);
    expect(refused.map((r) => r.name)).toEqual(["photo.jpg", "plan.dwg", "empty.pdf", "huge.pdf"]);
    expect(refused[0].why).toMatch(/PDF/);
    expect(refused[2].why).toMatch(/empty/);
    expect(refused[3].why).toMatch(/too large/);
  });
  test("the same name twice in one drop is uploaded once", () => {
    expect(pickDrawings([f("A.pdf"), f("A.pdf")]).pdfs.length).toBe(1);
  });
});

describe("adding an uploaded drawing's pages to the sheet list", () => {
  const s = (file, page) => ({ key: `${file}#${page}`, file, page, label: "x" });
  test("a new drawing's pages go at the end", () => {
    const out = mergeSheets([s("A.pdf", 1)], "B.pdf", [s("B.pdf", 1), s("B.pdf", 2)]);
    expect(out.map((x) => x.key)).toEqual(["A.pdf#1", "B.pdf#1", "B.pdf#2"]);
  });
  test("a newer version replaces that drawing's pages where they were", () => {
    const out = mergeSheets([s("A.pdf", 1), s("A.pdf", 2), s("B.pdf", 1)], "A.pdf", [{ key: "A.pdf#1", file: "A.pdf", page: 1, label: null }]);
    expect(out.map((x) => x.key)).toEqual(["A.pdf#1", "B.pdf#1"]);
    expect(out[0].label).toBeNull();
  });
});

describe("remembering sheet numbers for quotes", () => {
  const sheets = [{ key: "A.pdf#1", label: "A-101" }, { key: "A.pdf#2", label: "A-102" }, { key: "A.pdf#3", label: "" }, { key: "A.pdf#4", label: null }];
  const doc = { shapes: [{ sheet_id: "A.pdf#1" }, { sheet_id: "A.pdf#3" }, { sheet_id: "A.pdf#4" }] };
  test("only measured sheets whose number has been read are sent, and each only once", () => {
    const sent = new Map();
    expect(labelsToSave(sheets, doc, sent)).toEqual([{ sheet_key: "A.pdf#1", label: "A-101" }]);
    sent.set("A.pdf#1", "A-101");
    expect(labelsToSave(sheets, doc, sent)).toEqual([]);
  });
  test("a number that changed with a new drawing version is sent again, and long ones are trimmed", () => {
    const sent = new Map([["A.pdf#1", "A-100"]]);
    expect(labelsToSave(sheets, doc, sent)).toEqual([{ sheet_key: "A.pdf#1", label: "A-101" }]);
    expect(labelsToSave([{ key: "A.pdf#1", label: "x".repeat(90) }], doc, new Map())[0].label.length).toBe(60);
  });
});
