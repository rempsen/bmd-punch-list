import { describe, expect, test } from "bun:test";
import { CATEGORIES, normaliseUom, parseMaterialRows, parseMoneyCents, planMaterialImport, type MaterialInput } from "./logic";

describe("parseMoneyCents", () => {
  test("reads plain, dollar-signed and comma-grouped amounts", () => {
    expect(parseMoneyCents("2.50")).toBe(250);
    expect(parseMoneyCents("$1,234.5")).toBe(123450);
    expect(parseMoneyCents(32)).toBe(3200);
    expect(parseMoneyCents(" $ 0.899 ")).toBe(90);
  });
  test("blank or unreadable is unknown, never zero", () => {
    expect(parseMoneyCents("")).toBeNull();
    expect(parseMoneyCents("call for price")).toBeNull();
    expect(parseMoneyCents(null)).toBeNull();
  });
  test("an explicit zero stays zero", () => expect(parseMoneyCents("0")).toBe(0));
  test("negative prices are rejected", () => expect(parseMoneyCents("-4")).toBeNull());
});

describe("normaliseUom", () => {
  test("maps the ways suppliers write units", () => {
    expect(["sq ft", "SQFT", "sf", "Sq. Ft."].map(normaliseUom)).toEqual(["SF", "SF", "SF", "SF"]);
    expect(["sy", "sq yd", "SQ YD"].map(normaliseUom)).toEqual(["SY", "SY", "SY"]);
    expect(["lf", "lin ft", "ft"].map(normaliseUom)).toEqual(["LF", "LF", "LF"]);
    expect(["ea", "each", "pc", "piece"].map(normaliseUom)).toEqual(["EA", "EA", "EA", "EA"]);
    expect(["ctn", "carton", "box", "bx"].map(normaliseUom)).toEqual(["carton", "carton", "carton", "carton"]);
    expect(["roll", "pail"].map(normaliseUom)).toEqual(["roll", "pail"]);
  });
  test("an unknown unit is null", () => expect(normaliseUom("fortnight")).toBeNull());
});

describe("parseMaterialRows", () => {
  test("reads a supplier price list with its own header wording", () => {
    const out = parseMaterialRows([
      { "Product Name": "Free Flow FMT118", Mfr: "Milliken", Color: "Daybreak", "Item #": "FMT118", Type: "Carpet Tile", UOM: "SY", Price: "$32.00", "SF/Ctn": "" },
      { "Product Name": "Dante Pro 2.0", Mfr: "Fuzion", Color: "Acacia Sereno", "Item #": "DP-AS", Type: "LVP", UOM: "sq ft", Price: "2.50", "SF/Ctn": "23.6" },
    ]);
    expect(out.problems).toEqual([]);
    expect(out.rows[0]).toMatchObject({ name: "Free Flow FMT118", manufacturer: "Milliken", colour: "Daybreak", sku: "FMT118", category: "carpet_tile", cost_uom: "SY", purchase_uom: "SY", unit_cost_cents: 3200, coverage_per_purchase_unit: null });
    expect(out.rows[1]).toMatchObject({ name: "Dante Pro 2.0", category: "lvp", cost_uom: "SF", purchase_uom: "carton", unit_cost_cents: 250, coverage_per_purchase_unit: 23.6 });
  });
  test("a missing price is kept as unknown and reported, not zero", () => {
    const out = parseMaterialRows([{ Name: "Mystery Tile", Category: "Floor tile", Unit: "SF", Cost: "" }]);
    expect(out.rows[0]!.unit_cost_cents).toBeNull();
    expect(out.problems).toEqual(["Row 2: Mystery Tile has no price; it will be saved as unknown."]);
  });
  test("rows with no name are skipped and an unreadable unit is reported", () => {
    const out = parseMaterialRows([{ Name: "", Cost: "5" }, { Name: "Odd", Unit: "fortnight", Cost: "5" }]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.cost_uom).toBe("EA");
    expect(out.problems).toEqual(['Row 3: Odd has unit "fortnight" which was not recognised; set to each.']);
  });
  test("with no name column the file is refused", () => {
    expect(() => parseMaterialRows([{ Foo: "x" }])).toThrow("Could not find a product name column");
  });
  test("categories cover the design's list", () => {
    expect(CATEGORIES.map((c) => c.value)).toEqual([
      "carpet_broadloom", "carpet_tile", "lvp", "lvt", "sheet_vinyl", "rubber", "floor_tile", "wall_tile", "wall_base",
      "transitions", "adhesive", "underlay", "prep", "window_coverings", "other",
    ]);
  });
});

describe("planMaterialImport", () => {
  const m = (o: Partial<MaterialInput>): MaterialInput => ({
    name: "X", category: "other", manufacturer: null, product_line: null, colour: null, sku: null, cost_uom: "EA", purchase_uom: "EA",
    coverage_per_purchase_unit: null, unit_cost_cents: 100, ...o,
  });
  const existing = [
    { id: "a", name: "Dante Pro 2.0", sku: "DP-AS", colour: "Acacia Sereno", unit_cost_cents: 250 },
    { id: "b", name: "Rubber Base 4in", sku: null, colour: "Black", unit_cost_cents: 120 },
  ];
  test("matches by SKU first, then by name and colour; reports price changes without applying them silently", () => {
    const plan = planMaterialImport(
      [m({ name: "Dante Pro (renamed)", sku: "dp-as", unit_cost_cents: 265 }), m({ name: "rubber base 4in", colour: "black", unit_cost_cents: 120 }), m({ name: "New Thing" })],
      existing,
    );
    expect(plan.inserts.map((r) => r.name)).toEqual(["New Thing"]);
    expect(plan.priceChanges).toEqual([{ id: "a", name: "Dante Pro 2.0", fromCents: 250, toCents: 265 }]);
    expect(plan.unchanged).toBe(1);
  });
  test("an unknown incoming price never overwrites a known one", () => {
    const plan = planMaterialImport([m({ name: "Dante Pro 2.0", sku: "DP-AS", unit_cost_cents: null })], existing);
    expect(plan.priceChanges).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });
});
