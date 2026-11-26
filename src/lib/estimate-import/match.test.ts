import { describe, expect, test } from "bun:test";
import { aiMatchPrompt, guessCategory, matchLine, normaliseAlias, parseAiMatch, priceDelta, type CatalogueEntry, type ImportedLine } from "./match";

const line = (description: string, uom: string | null = "SF", material: number | null = null, labour: number | null = null): ImportedLine => ({ description, detail: null, uom, material_unit_cost: material, labour_unit_cost: labour });
const item = (id: string, name: string, category: string, unit: string, mat: number | null = null, lab: number | null = null): CatalogueEntry => ({ kind: "item", id, name, description: null, category, unit, material_unit_cost: mat, labour_unit_cost: lab });
const LVT = item("lvt1", "LVT 1", "lvt", "SF", 4.25);
const CARPET_TILE = item("ct", "Carpet tile", "carpet_tile", "SF", 3.1);
const RUBBER = item("rb", "Rubber base", "wall_base", "LF", 2.2);

describe("normaliseAlias", () => {
  test("case", () => expect(normaliseAlias("LVT Plank")).toBe("lvt plank"));
  test("punctuation", () => expect(normaliseAlias("LVT-1, (main)")).toBe("lvt 1 main"));
  test("double spaces", () => expect(normaliseAlias("  carpet   tile ")).toBe("carpet tile"));
  test("trailing periods", () => expect(normaliseAlias("Rubber base...")).toBe("rubber base"));
});

describe("matchLine", () => {
  test("alias exact", () => {
    const r = matchLine(line("LVT"), [LVT, CARPET_TILE], [{ alias_norm: "lvt", catalogue_item_id: "lvt1", assembly_id: null }]);
    expect(r.status).toBe("exact_alias");
    expect(r.candidates[0]!.catalogue_item_id).toBe("lvt1");
    expect(r.candidates[0]!.score).toBe(1);
  });
  test("plank synonym puts LVT 1 on top", () => {
    const r = matchLine(line("Kitchen Plank Flooring"), [LVT, CARPET_TILE, RUBBER], []);
    expect(r.status).toBe("fuzzy");
    expect(r.candidates[0]!.catalogue_item_id).toBe("lvt1");
  });
  test("SY line vs SF carpet: converts to $35.10/SY and earns the price bonus", () => {
    const carpet = item("cb", "Broadloom carpet", "carpet_broadloom", "SF", 3.9);
    const withPrice = matchLine(line("Carpet Main Floor", "SY", 35), [carpet], []).candidates[0]!;
    const without = matchLine(line("Carpet Main Floor", "SY", 80), [carpet], []).candidates[0]!;
    expect(withPrice.reason).toContain("$35.10/SY");
    expect(withPrice.score).toBeGreaterThan(without.score);
    expect(priceDelta(line("Carpet", "SY", 35), withPrice).material!.catalogue).toBe(35.1);
  });
  test("floor heat vs flooring-only catalogue → none", () => {
    expect(matchLine(line("Floor Heat mat and thermostat"), [LVT, CARPET_TILE, RUBBER], []).status).toBe("none");
  });
  test("sorted and capped at 5", () => {
    const cat = Array.from({ length: 8 }, (_, i) => item(`c${i}`, i % 2 ? "Carpet tile grey" : "Carpet", "carpet_tile", "SF"));
    const r = matchLine(line("Carpet tile"), cat, []);
    expect(r.candidates.length).toBe(5);
    for (let i = 1; i < r.candidates.length; i++) expect(r.candidates[i - 1]!.score).toBeGreaterThanOrEqual(r.candidates[i]!.score);
  });
});

describe("priceDelta", () => {
  test("SF catalogue price compared per SY", () => {
    const d = priceDelta(line("x", "SY", 36), { uom: "SF", material_unit_cost: 4, labour_unit_cost: null });
    expect(d.material).toEqual({ imported: 36, catalogue: 36, delta: 0, pct: 0 });
  });
  test("SY catalogue price compared per SF", () => {
    expect(priceDelta(line("x", "SF", 4), { uom: "SY", material_unit_cost: 36, labour_unit_cost: null }).material!.catalogue).toBe(4);
  });
  test("20% off needs verification", () => expect(priceDelta(line("x", "SF", 12), { uom: "SF", material_unit_cost: 10, labour_unit_cost: null }).needs_verification).toBe(true));
  test("10% off does not", () => expect(priceDelta(line("x", "SF", 11, 2.2), { uom: "SF", material_unit_cost: 10, labour_unit_cost: 2 }).needs_verification).toBe(false));
  test("labour 20% off needs verification", () => expect(priceDelta(line("x", "SF", 10, 2.4), { uom: "SF", material_unit_cost: 10, labour_unit_cost: 2 }).needs_verification).toBe(true));
});

describe("AI ranking", () => {
  test("keeps only listed ids and the catalogue's numbers", () => {
    const cands = matchLine(line("Plank"), [LVT], []).candidates;
    expect(aiMatchPrompt(line("Plank"), cands)).toContain("lvt1");
    const r = parseAiMatch('{"matches":[{"id":"nope","reason":"x"},{"id":"lvt1","reason":"same plank","material_unit_cost":1}]}', cands);
    expect(r.length).toBe(1);
    expect(r[0]!.material_unit_cost).toBe(4.25);
    expect(parseAiMatch("not json", cands)).toEqual([]);
  });
});

describe("guessCategory", () => {
  const kws = [{ id: "k1", term: "carpet", group_key: "carpet", whole_word: false }, { id: "k2", term: "porcelain", group_key: "tile", whole_word: false }];
  test("from scope groups", () => {
    expect(guessCategory("Porcelain tile 12x24", kws)).toBe("floor_tile");
    expect(guessCategory("Carpet main floor", kws)).toBe("carpet_broadloom");
    expect(guessCategory("Floor heat", kws)).toBe("other");
  });
});
