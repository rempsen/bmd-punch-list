import { describe, expect, it } from "bun:test";
import { findScopeHits, normaliseTerm, scansForScope, scopeSummary, scopeTermsBlock, snippetAround, stemWord, type ScopeKeyword } from "./scope-keywords";

const kw = (id: string, term: string, whole_word = false): ScopeKeyword => ({ id, term, group_key: "x", whole_word });
const KW = [kw("carpet", "carpet"), kw("ct", "carpet tile"), kw("tile", "tile"), kw("llp", "loose-lay plank"), kw("nos", "stair nosings"), kw("bs", "backsplash"), kw("CT", "CT", true), kw("lvp", "LVP", true), kw("wb", "wall base"), kw("sf", "SF", true)];
const ids = (t: string | string[]) => findScopeHits(t, KW).map((h) => h.keyword_id).sort();

describe("normaliser", () => {
  it("collapses hyphens and spaces and strips plurals", () => {
    expect(normaliseTerm("Loose-lay planks")).toBe("looselayplank");
    expect(normaliseTerm("loose lay plank")).toBe("looselayplank");
    expect(stemWord("backsplashes")).toBe("backsplash");
    expect(stemWord("nosings")).toBe("nosing");
    expect(stemWord("glass")).toBe("glass");
  });
});

describe("findScopeHits", () => {
  it("matches case-insensitively with plural, hyphen and space variants", () => {
    expect(ids("Install LOOSE LAY PLANK in corridors")).toEqual(["llp"]);
    expect(ids("looselay planks")).toEqual(["llp"]);
    expect(ids("Stair nosing at all landings")).toEqual(["nos"]);
    expect(ids("Kitchen backsplashes by owner")).toEqual(["bs"]);
    expect(ids("WALL-BASE: 4in")).toEqual(["wb"]);
  });
  it("keeps whole-word terms out of other words", () => {
    expect(ids("CT-1 at lobby")).toEqual(["CT"]);
    expect(ids("contract act")).toEqual([]);
    expect(ids("LVPs throughout")).toEqual(["lvp"]);
    expect(ids("Total 1200 SF")).toEqual(["sf"]);
    expect(ids("SFX unit")).toEqual([]);
  });
  it("does not match a non-whole-word term inside another word", () => {
    expect(ids("textile wallcovering")).toEqual([]);
    expect(ids("tiles and tiled walls")).toEqual(["tile"]);
  });
  it("counts the longer term, not the shorter ones inside it", () => {
    const h = findScopeHits("carpet tile CPT-1; carpet in suites; carpet tiles in corridor", KW);
    expect(h.find((x) => x.keyword_id === "ct")?.count).toBe(2);
    expect(h.find((x) => x.keyword_id === "carpet")?.count).toBe(1);
    expect(h.find((x) => x.keyword_id === "tile")).toBeUndefined();
  });
  it("reports pages and snippets", () => {
    const h = findScopeHits(["nothing here", "Provide LVP in suites", "LVP and LVP"], KW);
    expect(h.map((x) => [x.page, x.count])).toEqual([[2, 1], [3, 2]]);
    expect(h[0]!.snippet).toContain("Provide LVP in suites");
  });
  it("skips inactive keywords", () => {
    expect(findScopeHits("carpet", [{ ...kw("c", "carpet"), active: false }])).toEqual([]);
  });
});

describe("helpers", () => {
  it("snippet stays within 200 characters", () => {
    const t = `${"a ".repeat(300)}CARPET${" b".repeat(300)}`;
    const s = snippetAround(t, 600, 606);
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).toContain("CARPET");
  });
  it("scans plans, specs, and spec/drawing files under Other", () => {
    expect(scansForScope("plans", "A101.pdf")).toBe(true);
    expect(scansForScope("specifications", "x.pdf")).toBe(true);
    expect(scansForScope("other", "Interior Drawings.pdf")).toBe(true);
    expect(scansForScope("other", "notes.pdf")).toBe(false);
    expect(scansForScope("vendor", "spec sheet.pdf")).toBe(false);
  });
  it("builds the AI block and summary", () => {
    expect(scopeTermsBlock(["carpet", "LVP"])).toContain("carpet, LVP");
    expect(scopeTermsBlock([])).toBe("");
    expect(scopeSummary(["LVP", "carpet", "LVP"])).toBe("Scope found: LVP, carpet");
  });
});

describe("AI prompts carry the scope terms", () => {
  it("adds the block to the spec reader and the assistant", async () => {
    const { buildScopeRequest } = await import("@/lib/ai/scope");
    const { systemPrompt } = await import("@/lib/assistant/prompt");
    expect(buildScopeRequest({ specText: "x", scheduleText: "", scopeTerms: ["LVP"] }).system).toContain("BMD Materials' scope terms");
    expect(systemPrompt({ askerName: "a", today: "t", project: null, canPrice: false, canRemember: false, scopeTerms: ["LVP"] })).toContain("LVP");
  });
});
