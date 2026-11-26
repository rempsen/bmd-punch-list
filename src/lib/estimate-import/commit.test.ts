import { describe, expect, test } from "bun:test";
import { buildImport, fileTarget, importTotals, parseWorkbook } from "./parse";
import { fixtureXlsx, FIXTURE_CSV } from "./__fixtures__/build-xlsx";
import { categoryFor, payloadPrice, reconciliation, rowToPayload } from "./commit";
import type { CatalogueView } from "@/lib/estimating/assemble";
import type { Template } from "@/lib/catalogue/data";
import type { ParsedRow } from "./types";

const PST = { pstPct: 7 };
const xlsx = buildImport(parseWorkbook(fixtureXlsx(), "xlsx"));
const csv = buildImport(parseWorkbook(new TextEncoder().encode(FIXTURE_CSV), "csv"));
const row: ParsedRow = { row_no: 1, kind: "item", group_name: "Floor", raw: { cells: [], sheet: "Estimate" }, parsed: { description: "LVT 1", detail: "Oak", qty: 10, uom: "SF", waste_pct: 5, material_unit_cost: 5, labour_unit_cost: 2, markup_pct: 35, margin_pct: null, sell_unit: null, taxable: true, colour: null } };
const catalogue: CatalogueView = {
  materials: { "m-1": { id: "m-1", name: "LVT 1", cost_uom: "SY", unit_cost_cents: 1800, purchase_uom: "SY", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 5 } },
  labour: { "l-1": { id: "l-1", name: "Install LVT", uom: "SF", unit_cost_cents: 150 } },
};
const template = { id: "a-1", name: "LVT supply & install", category: "lvt", driver_uom: "SF", cost_code: null, default_waste_pct: 5, sort_order: 1, active: true, components: [
  { kind: "material", label: "LVT", source: "catalogue", catalogue_material_id: "m-1", labour_rate_id: null, unit_cost_cents: null, cost_uom: "SY", qty_per_driver: 1, waste_pct: 5, round_up: false, pst_applies: true, on_gross: false, sort_order: 1 },
  { kind: "labour", label: "Install", source: "labour_rate", catalogue_material_id: null, labour_rate_id: "l-1", unit_cost_cents: null, cost_uom: "SF", qty_per_driver: 1, waste_pct: null, round_up: false, pst_applies: false, on_gross: false, sort_order: 2 },
] } as unknown as Template;
const ctx = (options = xlsx.options) => ({ options, category: "Floor", catalogue, templates: [template] });
const sumOf = (items: ReturnType<typeof rowToPayload>[]) => items.reduce((s, i) => { const p = payloadPrice(i, PST); return { cost: s.cost + p.costCents, sell: s.sell + p.sellCents }; }, { cost: 0, sell: 0 });

describe("keep imported", () => {
  test("the fixture's lines add up to the file: cost 29,443.24 and sell 39,748.37 with the 7% materials tax folded in", () => {
    const items = xlsx.rows.filter((r) => r.kind === "item").map((r) => rowToPayload(r, { action: "keep_imported" }, ctx()));
    const t = sumOf(items);
    const want = importTotals(xlsx.rows, xlsx.options);
    expect(Math.abs(t.cost / 100 - want.total_cost)).toBeLessThan(0.05);
    expect(Math.abs(t.sell / 100 - want.sell_with_tax)).toBeLessThan(0.05);
    expect(t.cost / 100).toBeCloseTo(29443.24, 1);
    expect(t.sell / 100).toBeCloseTo(39748.37, 1);
    expect(reconciliation(t.sell / 100, fileTarget(xlsx.summary, xlsx.options), false).allowed).toBe(true);
  });
  test("without a materials tax line the lines add up to the file's own totals", () => {
    const items = csv.rows.filter((r) => r.kind === "item").map((r) => rowToPayload(r, { action: "keep_imported" }, ctx(csv.options)));
    const t = sumOf(items);
    expect(t.cost / 100).toBeCloseTo(28153.41, 1);
    expect(t.sell / 100).toBeCloseTo(38007.10, 1);
  });
  test("lines stay live: priced by markup with typed costs, no PST when the file has none", () => {
    const p = rowToPayload(row, { action: "keep_imported" }, ctx(csv.options));
    expect(p.line.price_basis).toBe("markup");
    expect(p.line.markup_pct).toBe(35);
    expect(p.line.source).toBe("import");
    expect(p.components?.every((c) => c.cost_overridden && c.catalogue_material_id == null)).toBe(true);
    expect(p.components?.some((c) => c.pst_applies)).toBe(false);
  });
  test("a sell that markup does not reproduce is kept as a fixed sell", () => {
    const odd: ParsedRow = { ...row, parsed: { ...row.parsed!, line_total: 123.45 } };
    const p = rowToPayload(odd, { action: "keep_imported" }, ctx(csv.options));
    expect(p.line.price_basis).toBe("fixed_sell");
    expect(p.line.fixed_sell_cents).toBe(12345);
  });
});

describe("matched to the catalogue", () => {
  test("a catalogue material converts SY to SF and keeps the imported labour", () => {
    const p = rowToPayload(row, { action: "catalogue", candidate: { catalogue_item_id: "m-1", name: "LVT 1", score: 1, uom: "SY", material_unit_cost: 18, labour_unit_cost: null, reason: "" } }, ctx(csv.options));
    const m = p.components!.find((c) => c.kind === "material")!;
    expect(m.catalogue_material_id).toBe("m-1");
    expect(m.cost_overridden).toBe(false);
    // 10 SF × 1.05 waste = 10.5 SF = 1.1667 SY × $18 × 1.07 PST = $22.47, labour 10 × $2 = $20
    expect(payloadPrice(p, PST).costCents).toBe(2247 + 2000);
  });
  test("keep the imported price on a catalogue match", () => {
    const p = rowToPayload(row, { action: "catalogue", keepPrice: true, candidate: { catalogue_item_id: "m-1", name: "LVT 1", score: 1, uom: "SY", material_unit_cost: 18, labour_unit_cost: null, reason: "" } }, ctx(csv.options));
    const m = p.components!.find((c) => c.kind === "material")!;
    expect(m.catalogue_material_id).toBe("m-1");
    expect(m.cost_overridden).toBe(true);
    expect(payloadPrice(p, { pstPct: 0 }).costCents).toBe(5250 + 2000); // 10 × 1.05 × $5 + 10 × $2
  });
  test("an assembly brings its material and labour rate", () => {
    const p = rowToPayload(row, { action: "catalogue", candidate: { assembly_id: "a-1", name: "LVT supply & install", score: 1, uom: "SF", material_unit_cost: 2, labour_unit_cost: 1.5, reason: "" } }, ctx(csv.options));
    expect(p.components!.map((c) => c.source)).toEqual(["catalogue", "labour_rate"]);
    expect(p.components![1]!.labour_rate_id).toBe("l-1");
    expect(p.line.driver_uom).toBe("SF");
  });
  test("units that do not convert are refused", () => {
    const lf: ParsedRow = { ...row, parsed: { ...row.parsed!, uom: "LF" } };
    expect(() => rowToPayload(lf, { action: "catalogue", candidate: { catalogue_item_id: "m-1", name: "LVT 1", score: 1, uom: "SY", material_unit_cost: 18, labour_unit_cost: null, reason: "" } }, ctx(csv.options))).toThrow(/convert/);
  });
});

describe("rules", () => {
  test("group strategies", () => {
    expect(categoryFor("Floor", {}, "groups")).toBe("Floor");
    expect(categoryFor("Floor", { Floor: "Vinyl" }, "map")).toBe("Vinyl");
    expect(categoryFor("Floor", {}, "single")).toBe("Imported");
    expect(categoryFor(null, {}, "groups")).toBe("General");
  });
  test("a difference above $1 needs acknowledging", () => {
    expect(reconciliation(101.01, 100, false).allowed).toBe(false);
    expect(reconciliation(101.01, 100, true).allowed).toBe(true);
    expect(reconciliation(101, 100, false).allowed).toBe(true);
    expect(reconciliation(5, null, false).allowed).toBe(true);
  });
  test("no quantity or unit is refused", () => {
    expect(() => rowToPayload({ ...row, parsed: { ...row.parsed!, qty: null } }, { action: "keep_imported" }, ctx())).toThrow(/quantity/);
    expect(() => rowToPayload({ ...row, parsed: { ...row.parsed!, uom: "BUNDLE" } }, { action: "keep_imported" }, ctx())).toThrow(/unit/);
  });
});

describe("fixture end to end: parse → keep imported → commit payload → versionSummary", () => {
  test("XLSX with no PST gross-up gives material 18,426.11 / labour 9,727.30 / cost 28,153.41 / sell 38,007.10", async () => {
    const { versionSummary } = await import("@/lib/estimating/worksheet");
    const built = buildImport(parseWorkbook(fixtureXlsx(), "xlsx"), { options: { gross_up_pst_pct: null } });
    expect(built.options.gross_up_pst_pct).toBeNull();
    const items = built.rows.filter((r) => r.kind === "item").map((r) => rowToPayload(r, { action: "keep_imported" }, ctx(built.options)));
    const lines = items.map((it, i) => ({
      ...(it.line as object), id: `l${i}`, section: String(it.line.section), cost_code: null, description: String(it.line.description),
      selection: "required" as const, selection_group: null, components: it.components ?? [],
    })) as unknown as Parameters<typeof versionSummary>[0];
    const s = versionSummary(lines, { pstPct: 7, gstPct: 5, hstPct: 0 });
    let material = 0, labour = 0;
    lines.forEach((l) => s.priced[l.id]!.components.forEach((c, j) => { if (l.components[j]!.kind === "labour") labour += c.costCents; else material += c.costCents; }));
    expect(material).toBe(1842611);
    expect(labour).toBe(972730);
    expect(s.costCents).toBe(2815341);
    expect(s.sellCents).toBe(3800710);
  });
});

describe("catalogue item at the imported price", () => {
  test("costs and sells exactly what the file says, even when the catalogue unit differs and labour carries waste", () => {
    const carpet: CatalogueView = { materials: { c: { id: "c", name: "Carpet", cost_uom: "SF", unit_cost_cents: null, purchase_uom: "SF", coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: true, default_waste_pct: 5 } }, labour: {} };
    const r = csv.rows.find((x) => x.parsed?.description === "CARPET TO REC ROOM")!;
    const c = { options: csv.options, category: "Floor", catalogue: carpet, templates: [] };
    const kept = payloadPrice(rowToPayload(r, { action: "keep_imported" }, c), PST);
    const linked = payloadPrice(rowToPayload(r, { action: "catalogue", keepPrice: true, candidate: { catalogue_item_id: "c", name: "Carpet", score: 1, uom: "SF", material_unit_cost: null, labour_unit_cost: null, reason: "" } }, c), PST);
    expect(linked.costCents).toBe(kept.costCents);
    expect(linked.sellCents).toBe(kept.sellCents);
  });
});
