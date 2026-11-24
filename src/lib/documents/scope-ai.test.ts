import { describe, expect, it } from "vitest";
import { parseScopeAi, scopeAiPrompt } from "./scope-ai";

describe("parseScopeAi", () => {
  const asked = new Set(["a", "b"]);
  it("keeps valid items for asked hits", () => {
    const r = parseScopeAi('Sure: {"items":[{"id":"a","verdict":"in_scope","suggestion":"Price LVP in corridors"},{"id":"z","verdict":"in_scope","suggestion":"x"},{"id":"b","verdict":"maybe","suggestion":"x"}]}', asked);
    expect(r).toEqual([{ id: "a", verdict: "in_scope", suggestion: "Price LVP in corridors" }]);
  });
  it("returns nothing for non-JSON", () => {
    expect(parseScopeAi("no idea", asked)).toEqual([]);
  });
});

describe("scopeAiPrompt", () => {
  it("includes id, term and page", () => {
    expect(scopeAiPrompt([{ id: "a", term: "LVP", document: "A-101.pdf", page: 3, snippet: "LVP-1" }])).toContain('id=a | term="LVP" | A-101.pdf p.3');
  });
});
