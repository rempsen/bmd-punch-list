import { describe, expect, test } from "bun:test";
import { symbolProposals } from "./symbolCount.js";
import { acceptProposals, isProposal, reviewCount, reviewList } from "./autoReview.js";
import { takeoffQuantities } from "./quantities.js";

const DIMS = { w: 1000, h: 800 };
const doc0 = () => ({ conditions: [{ id: "c1", finish_tag: "FD-1", color: "#111111", multiplier: 1, waste_pct: 0 }], shapes: [], sheets: [] });
const result = (over = {}) => ({
  seed: { segments: 6, center: [100, 100], length_px: 80 },
  matches: [{ at: [300, 100], score: 1, rotation: 0, mirrored: false }, { at: [500, 400], score: 0.95, rotation: 90, mirrored: false, extra: 0.4 }],
  withheld: [{ at: [700, 600], score: 0.8, rotation: 0, mirrored: false, reason: "2 of 6 segments not found" }],
  rejected: [], candidates: { considered: 40, dropped: 0 }, complete: true, ...over,
});
const make = (over = {}) => symbolProposals(doc0(), { sheetId: "s#1", conditionId: "c1", result: result(), dims: DIMS, sweepId: "sw-1", now: () => "2026-11-24T12:00:00.000Z", ...over });

describe("symbolProposals (count every symbol like the one boxed)", () => {
  test("the example and each match become count proposals; nothing is counted until accepted", () => {
    const { doc, found, close, partial } = make();
    expect({ found, close, partial }).toEqual({ found: 3, close: 1, partial: false });
    expect(doc.shapes.length).toBe(4);
    expect(doc.shapes.every(isProposal)).toBe(true);
    expect(doc.shapes[0]).toMatchObject({ sheet_id: "s#1", condition_id: "c1", measure_role: "count", verts_norm: [[0.1, 0.125]], computed: { count: 1 } });
    expect(doc.shapes[0].origin.auto).toMatchObject({ kind: "count", sweep: "sw-1", from: "symbol" });
    expect(takeoffQuantities(doc).rows).toEqual([]);
  });
  test("the matches are one item to review; a near-match is its own item, rated by how alike it is, and says why", () => {
    const { doc } = make();
    expect(reviewCount(doc.shapes)).toBe(2);
    const items = reviewList(doc, []).flatMap((s) => s.groups.flatMap((g) => g.items));
    const all = items.find((i) => i.ids.length === 3), near = items.find((i) => i.ids.length === 1);
    expect(all).toMatchObject({ kind: "count", unit: "EA", qty: 3, finish: "FD-1", from: "symbol" });
    expect(near).toMatchObject({ kind: "count", unit: "EA", qty: 1 });
    expect(near.confidence).toBe(0.8);
    expect(near.why).toContain("80% alike");
    expect(near.why).toContain("2 of 6 segments not found");
  });
  test("a match with more linework than the example is pointed out", () => {
    const { doc } = make();
    expect(doc.shapes[2].origin.auto.notes.join(" ")).toContain("more linework than your example");
  });
  test("accepting counts them", () => {
    const { doc } = make();
    const ids = doc.shapes.filter((s) => s.origin.auto.sweep === "sw-1").map((s) => s.id);
    expect(takeoffQuantities(acceptProposals(doc, ids).doc).rows[0].ea).toBe(3);
  });
  test("a symbol already counted there is not proposed again", () => {
    const first = make();
    const again = symbolProposals(first.doc, { sheetId: "s#1", conditionId: "c1", result: result(), dims: DIMS, sweepId: "sw-2" });
    expect(again.found + again.close).toBe(0);
    expect(again.doc.shapes.length).toBe(4);
  });
  test("an example with too little linework, or nothing like it on the sheet, says so and proposes nothing", () => {
    expect(() => make({ result: result({ seed: { segments: 1, center: [1, 1], length_px: 5 } }) })).toThrow("Draw the box around the whole symbol");
    const none = make({ result: result({ matches: [], withheld: [] }) });
    expect(none.found).toBe(0);
    expect(none.doc.shapes).toEqual([]);
  });
  test("a sheet too busy to search completely is reported", () => {
    expect(make({ result: result({ complete: false, candidates: { considered: 250000, dropped: 9 } }) }).partial).toBe(true);
  });
});
