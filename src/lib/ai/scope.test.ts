import { describe, expect, test } from "bun:test";
import { buildScopeRequest, findTags, parseProposals, proposalToFinish, suggestSheetName } from "./scope";

describe("scope proposals from specs", () => {
  test("the request carries extracted text only: no file bytes, no pricing fields", () => {
    const r = buildScopeRequest({ specText: "09 65 19 RESILIENT TILE FLOORING\nLVP-1: Shaw Contract, Terrain II, colour Dune. Guest rooms.", scheduleText: "FINISH SCHEDULE\nRoom 201 floor LVP-1 base RB-1" });
    expect(Object.keys(r).sort()).toEqual(["prompt", "system"]);
    expect(r.prompt).toContain("LVP-1: Shaw Contract");
    expect(r.prompt).toContain("FINISH SCHEDULE");
    expect(r.system).toMatch(/never invent/i);
    expect(JSON.stringify(r)).not.toMatch(/cost|markup|margin|unit price|\$/i);
  });
  test("a PDF or other file content passed as text is refused, and long text is cut to size", () => {
    expect(() => buildScopeRequest({ specText: "%PDF-1.7 \u0000\u0001 binary", scheduleText: "" })).toThrow("Send the text of the document, not the file itself.");
    expect(() => buildScopeRequest({ specText: "data:application/pdf;base64,JVBERi0x", scheduleText: "" })).toThrow("Send the text of the document, not the file itself.");
    expect(() => buildScopeRequest({ specText: " ", scheduleText: "" })).toThrow("There is no text to read.");
    expect(buildScopeRequest({ specText: "x".repeat(500_000), scheduleText: "" }).prompt.length).toBeLessThan(130_000);
  });
  test("reads the model's answer, keeping only well-formed proposals", () => {
    const text = 'Here you go:\n```json\n[{"tag":"LVP-1","product":"Terrain II","manufacturer":"Shaw Contract","colour":"Dune","appliesTo":"Guest rooms","specRef":"09 65 19 2.1","confidence":0.9},{"tag":"","product":"x"},{"tag":"RB-1","product":"Rubber base 4 in","confidence":7},"junk",{"tag":"lvp-1","product":"duplicate"}]\n```';
    expect(parseProposals(text)).toEqual([
      { tag: "LVP-1", product: "Terrain II", manufacturer: "Shaw Contract", colour: "Dune", appliesTo: "Guest rooms", specRef: "09 65 19 2.1", confidence: 0.9 },
      { tag: "RB-1", product: "Rubber base 4 in", manufacturer: null, colour: null, appliesTo: null, specRef: null, confidence: 1 },
    ]);
    expect(parseProposals("I could not find any finishes.")).toEqual([]);
    expect(parseProposals('{"proposals":[{"tag":"CPT-1","product":"Carpet tile"}]}')).toHaveLength(1);
  });
  test("an accepted proposal becomes a finish with no material or price attached", () => {
    expect(proposalToFinish({ tag: "LVP-1", product: "Terrain II", manufacturer: "Shaw Contract", colour: "Dune", appliesTo: "Guest rooms", specRef: "09 65 19", confidence: 0.9 }, "p1", 4)).toEqual({ project_id: "p1", tag: "LVP-1", description: "Shaw Contract Terrain II, Dune. Guest rooms (spec 09 65 19)", assembly_template_id: null, catalogue_material_id: null, sort_order: 4 });
  });
});

describe("reading a sheet's own text", () => {
  const page = { width: 2592, height: 1728 };
  const items = [
    { str: "LEVEL 2 FINISH PLAN", x: 2100, y: 1560, size: 18 },
    { str: "ID-201", x: 2380, y: 1640, size: 36 },
    { str: "LVP-1", x: 400, y: 500, size: 8 },
    { str: "SEE A-501 FOR DETAILS", x: 300, y: 300, size: 8 },
    { str: "LVP-1", x: 900, y: 700, size: 8 },
    { str: "RB-1", x: 905, y: 720, size: 8 },
  ];
  test("the sheet number and title come from the title block, not from a cross-reference in the drawing", () => {
    expect(suggestSheetName(items, page)).toEqual({ sheet_number: "ID-201", title: "Level 2 Finish Plan" });
    expect(suggestSheetName([{ str: "ROOM 101", x: 10, y: 10, size: 8 }], page)).toBeNull();
    expect(suggestSheetName([], page)).toBeNull();
  });
  test("finds every place a finish tag is written on the sheet", () => {
    expect(findTags(items, "lvp-1")).toEqual([{ x: 400, y: 500 }, { x: 900, y: 700 }]);
    expect(findTags(items, "RB-1")).toHaveLength(1);
    expect(findTags(items, "LVP")).toEqual([]);
    expect(findTags(items, "  ")).toEqual([]);
  });
});
