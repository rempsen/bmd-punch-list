import { describe, expect, test } from "bun:test";
import { buildImport, detectHeader, fileTarget, importTotals, parseCsv, parseWorkbook } from "./parse";
import { convertQty, normaliseUom } from "./uom";
import { nameUnknownColumns, splitDescription } from "./ai";
import { pdfTables } from "./pdf-tables";
import { FIXTURE_CSV, fixtureXlsx } from "./__fixtures__/build-xlsx";
import type { ImportResult } from "./types";

const csv = () => buildImport(parseWorkbook(new TextEncoder().encode(FIXTURE_CSV), "csv"));
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.005);
const items = (r: ImportResult) => r.rows.filter((x) => x.kind === "item");

function expectFixture(r: ImportResult) {
  expect(r.summary.groups).toBe(5);
  expect(r.summary.items).toBe(21);
  expect(r.rows.filter((x) => x.kind === "total").length).toBe(1);
  const t = importTotals(r.rows, { gross_up_pst_pct: null });
  close(t.material_cost, 18426.11); close(t.labour_cost, 9727.30); close(t.total_cost, 28153.41); close(t.sell, 38007.10);
  for (const i of items(r)) { expect(i.parsed!.markup_pct).toBe(35); expect(i.parsed!.margin_pct!).toBeCloseTo(25.926, 3); }
  expect(new Set(items(r).map((i) => i.parsed!.uom))).toEqual(new Set(["SF", "SY", "LF", "EA"]));
  const k = items(r).find((i) => i.parsed!.description === "Kitchen Plank Flooring")!.parsed!;
  expect([k.waste_pct, k.material_unit_cost, k.labour_unit_cost, k.sell_unit]).toEqual([5, 5, 2.5, 7.0875]);
  expect(items(r).find((i) => i.parsed!.description === "Kitchen Plank Flooring")!.group_name).toBe("PLANK -UPPER LEVEL,ENTRY,STAIRS");
  expect(items(r).find((i) => i.parsed!.description.startsWith("Millwork Base-LVP"))!.group_name).toBe("MILLWORK BASE");
}

describe("estimate-4811643 fixture", () => {
  test("CSV → 5 groups, 21 items, matching totals", () => {
    const r = csv();
    expectFixture(r);
    expect(r.options.gross_up_pst_pct).toBeNull();
    expect(r.summary.materials_tax_detected).toBeNull();
    close(fileTarget(r.summary, r.options)!, 38007.10);
  });
  test("XLSX → identical result; duplicate sheet once; materials tax gross-up", () => {
    const tables = parseWorkbook(fixtureXlsx(), "xlsx");
    const r = buildImport(tables);
    expectFixture(r);
    expect(r.summary.duplicate_sheets).toEqual(["Full Estimate"]);
    expect(r.options.gross_up_pst_pct).toBe(7);
    close(r.summary.totals.material_cost, 19715.94);
    close(r.summary.totals.materials_tax, 1741.27);
    close(r.summary.totals.sell_with_tax, 39748.37);
    close(fileTarget(r.summary, r.options)!, 39748.37);
    expect(r.rows.map((x) => x.parsed)).toEqual(csv().rows.map((x) => x.parsed));
  });
  test("parsing again with the mapping it found gives the same rows and totals", () => {
    const first = buildImport(parseWorkbook(fixtureXlsx(), "xlsx"));
    const again = buildImport(parseWorkbook(fixtureXlsx(), "xlsx"), { mapping: first.mapping, options: first.options });
    expect(again.rows).toEqual(first.rows);
    expect(again.summary.totals).toEqual(first.summary.totals);
  });
});

describe("parsing rules", () => {
  test("header below a title row", () => {
    const rows = parseCsv("Smith Residence estimate,,,\n,,,\nItem,Quantity,UoM,Unit cost,Markup\nTile,10,sq ft,4,35\n");
    expect(detectHeader(rows)!.index).toBe(2);
    const r = buildImport([{ name: "x", rows }]);
    expect(r.summary.header_row).toBe(3);
    expect(items(r)[0]!.parsed!).toMatchObject({ description: "Tile", qty: 10, uom: "SF", material_unit_cost: 4 });
  });
  test("quoted commas and doubled quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi""",d\n')).toEqual([["a", "b, c", 'say "hi"', "d"]]);
  });
  test("a file with no labour column", () => {
    const r = buildImport([{ name: "x", rows: parseCsv("Description,Qty,Unit,Unit cost,Markup\nCarpet,20,sq yd,30,35\n") }]);
    expect(items(r)[0]!.parsed!.labour_unit_cost).toBeNull();
    expect(r.summary.totals.labour_cost).toBe(0);
    close(r.summary.totals.material_cost, 600);
  });
  test("Margin only: markup derived", () => {
    const r = buildImport([{ name: "x", rows: parseCsv("Description,Qty,Unit,Unit cost,Margin\nBase,100,lin ft,3.5,25.925925925925924\n") }]);
    expect(items(r)[0]!.parsed!.markup_pct).toBe(35);
    expect(items(r)[0]!.parsed!.uom).toBe("LF");
  });
  test("units", () => {
    expect(["sq ft", "sq yd", "ft", "lin ft", "ea", "box", "carton", "roll", "bag"].map(normaliseUom)).toEqual(["SF", "SY", "LF", "LF", "EA", "carton", "carton", "roll", "bag"]);
    expect(convertQty(18, "SF", "SY")).toBe(2);
    expect(convertQty(2, "SY", "SF")).toBe(18);
    expect(convertQty(5, "LF", "ft")).toBe(5);
  });
});

describe("templates", () => {
  test("a saved mapping for the signature is used instead of heuristics", () => {
    const first = csv();
    const swapped = { ...first.mapping, detail: first.mapping.description!, description: first.mapping.detail! };
    const r = buildImport(parseWorkbook(new TextEncoder().encode(FIXTURE_CSV), "csv"), { template: { id: "t", name: "x", header_signature: first.signature, mapping: swapped, options: {}, uses: 1 } });
    expect(r.summary.mapping_source).toBe("template");
    expect(r.mapping).toEqual(swapped);
    expect(items(r)[0]!.parsed!.description).toBe("Incl incl mat,prep, adh,delivery,misc");
  });
});

describe("AI helpers (stubbed)", () => {
  test("only fills unmapped fields with unused columns", async () => {
    const delta = await nameUnknownColumns(["Item", "Qty", "Finish"], [["a", "1", "Oak"]], { description: 0, qty: 1 }, async () => '{"colour": 2, "qty": 2, "markup_pct": 9}');
    expect(delta).toEqual({ colour: 2 });
  });
  test("failures never block", async () => {
    expect(await nameUnknownColumns(["A", "B"], [], {}, async () => { throw new Error("down"); })).toEqual({});
    expect(await splitDescription("Carpet- Basement", async () => '{"finish_hint":"Carpet","area_hint":"Basement"}')).toEqual({ finish_hint: "Carpet", area_hint: "Basement" });
  });
});

describe("PDF tables", () => {
  test("rebuilds rows from page text and keeps the page", () => {
    const tables = pdfTables([{ page: 2, text: "Cost item Description Quantity UoM Unit cost Markup\nKitchen plank 222.5 sq ft 5 35\nCarpet basement 35 sq yd 35 35" }]);
    const r = buildImport(tables);
    expect(items(r).map((i) => [i.parsed!.description, i.parsed!.qty, i.parsed!.uom, i.raw.page])).toEqual([["Kitchen plank", 222.5, "SF", 2], ["Carpet basement", 35, "SY", 2]]);
  });
});
