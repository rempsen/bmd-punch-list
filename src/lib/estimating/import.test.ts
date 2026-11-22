import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { priceEstimateLine, sellFromMargin, sellFromMarkup } from "./assemble";
import { importRowToSaveItem, parseGraberQuote, parseProcoreEstimate, reconcile } from "./import";

const rates = { pstPct: 7 };
const HEAD = ["Cost item", "Description", "Colour", "Budget code", "Quantity", "UoM (quantity)", "Total quantity", "Group multiplier", "Material waste", "Unit cost", "Waste", "Subtotal item cost", "Margin", "Markup", "Unit sales", "Subtotal item sales", "Profit", "Unit labour cost", "UoM (labour time)", "Labour cost", "Labour margin", "Labour markup", "Total labour sales", "Total sales", "Notes", "Taxable"];
const item = (name: string, qty: number, uom: string, matCost: number | string, matSell: number, labCost: number | string, labSell: number) => [name, "incl mat", "#fff", "?.*", qty, uom, qty * 1.05, 1, 5, 5, 5, matCost, 25.9259, 35, 6.75, matSell, 0, 2.5, "$", labCost, 25.9259, 35, labSell, matSell + labSell, "", "Yes"];
const group = (name: string, matSell: number, labSell: number) => [name, "", "", "?.?", "--", "Mixed", "--", 1, "--", "--", "--", 0, "--", "--", "--", matSell, 0, "--", "--", 0, "--", "--", labSell, matSell + labSell, "", "Yes"];
const sheet = [
  HEAD,
  group("PLANK", 2061.361895, 991.24376),
  item("Kitchen Plank Flooring", 222.573195, "sq ft", 1226.9347, 1656.361895, 584.2546, 788.74376),
  item("Laminate Stair", 3, "ft", 300, 405, 150, 202.5),
  group("CARPET", 1794.61597, 488.330876),
  item("Carpet Main Floor", 34.45015, "sq yd", 1329.345163, 1794.61597, "--", 488.330876),
  ["", "", "", "", "--", "", "--", "--", "--", "--", "--", 2856.28, "--", "--", "--", 3855.977865, 0, "--", "", 734.25, "--", "--", 1479.574636, 5335.552501, "", ""],
];
const workbook = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Estimate");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Full Estimate");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Summary"], ["Materials tax", "", "", "", "", "", 7, 269.92]]), "Summary");
  return wb;
};

describe("parseProcoreEstimate", () => {
  test("imports the duplicated sheet once and leaves out group subtotals and the grand total", () => {
    const r = parseProcoreEstimate(workbook(), XLSX.utils);
    expect(r.rows.map((x) => [x.section, x.description, x.qty, x.uom, x.sourceRef])).toEqual([
      ["PLANK", "Kitchen Plank Flooring", 222.573195, "SF", "Estimate row 3"],
      ["PLANK", "Laminate Stair", 3, "LF", "Estimate row 4"],
      ["CARPET", "Carpet Main Floor", 34.45015, "SY", "Estimate row 6"],
    ]);
    expect(r.skipped).toContain("Full Estimate: same rows as Estimate, not imported twice");
    expect(r.sourceTotals).toMatchObject({ materialSalesCents: 385598, labourSalesCents: 147957, preTaxCents: 533555 });
  });
  test("the lines add up to the workbook's own total, and a missing cost is unknown, not zero", () => {
    const r = parseProcoreEstimate(workbook(), XLSX.utils);
    expect(reconcile(r.rows, r.sourceTotals.preTaxCents)).toEqual({ linesCents: 533556, sourceCents: 533555, differenceCents: 1 });
    expect(r.rows[2]).toMatchObject({ materialCostCents: 132935, labourCostCents: null, issue: "Labour cost is missing" });
    expect(r.rows[0]!.issue).toBeNull();
  });
  test("imported lines keep their selling price: no second markup, waste or tax, and re-pricing leaves the sell alone", () => {
    const r = parseProcoreEstimate(workbook(), XLSX.utils);
    const it = importRowToSaveItem(r.rows[0]!, "v1", "estimate.xlsx", 1);
    expect(it.line).toMatchObject({ price_basis: "fixed_sell", fixed_sell_cents: 244511, driver_qty: 222.573195, driver_uom: "SF", waste_pct: 0, section: "PLANK", tax_code: "GST" });
    expect(it.line.notes).toContain("estimate.xlsx, Estimate row 3");
    const line = { driver_qty: 222.573195, driver_uom: "SF" as const, markup_pct: 35, price_basis: "fixed_sell" as const, margin_pct: null, fixed_sell_cents: 244511, tax_code: "GST" as const };
    const p = priceEstimateLine(line, it.components!, rates);
    expect([p.costCents, p.sellCents, p.unknown]).toEqual([122693 + 58425, 244511, false]);
    expect(priceEstimateLine({ ...line, markup_pct: 80 }, it.components!, rates).sellCents).toBe(244511);
  });
  test("a line with an unknown install cost is flagged until the cost is entered or marked not needed", () => {
    const it = importRowToSaveItem(parseProcoreEstimate(workbook(), XLSX.utils).rows[2]!, "v1", "e.xlsx", 3);
    const line = { driver_qty: 34.45015, driver_uom: "SY" as const, markup_pct: 0, price_basis: "fixed_sell" as const, margin_pct: null, fixed_sell_cents: it.line.fixed_sell_cents!, tax_code: "GST" as const };
    expect(priceEstimateLine(line, it.components!, rates)).toMatchObject({ unknown: true, unknownLabels: ["Labour (imported)"] });
    expect(priceEstimateLine(line, it.components!.map((c) => (c.unit_cost_cents == null ? { ...c, not_applicable: true } : c)), rates).unknown).toBe(false);
  });
  test("35% markup is a 25.9259% margin, not a 35% margin", () => {
    expect(Math.abs(sellFromMargin(100000, 25.9259) - sellFromMarkup(100000, 35))).toBeLessThanOrEqual(1);
    expect(sellFromMargin(100000, 35)).toBe(153846);
  });
  const real = "/home/claude/work/untrusted/quotes-pkg/estimate-4811643_uQCYZ5.xlsx";
  test.skipIf(!existsSync(real))("the supplied Procore workbook reconciles to 38,007.10 before tax", () => {
    const r = parseProcoreEstimate(XLSX.read(readFileSync(real)), XLSX.utils);
    expect(r.rows.length).toBe(21);
    expect(r.sourceTotals).toMatchObject({ materialSalesCents: 2487525, labourSalesCents: 1313185, preTaxCents: 3800710, sourceTaxCents: 174127 });
    expect(Math.abs(reconcile(r.rows, r.sourceTotals.preTaxCents).differenceCents)).toBeLessThanOrEqual(10);
  });
});

describe("parseGraberQuote", () => {
  const prices = [658.8, 616.8, 658.8, 658.8, 398.4, 616.8, 616.8, 483, 398.4];
  const text = [
    "Quotation", "Quote Number: -1234567 Home Phone:", "RESIDENTIAL SOLAR SHADES", "Line Item Qty Description Price Per Extended Price",
    ...prices.flatMap((p, i) => [
      `${i + 1}.0 1 Tag Window ${i + 1} $${p.toFixed(2)} $${p.toFixed(2)}`, "Product Single Solar Roller Residential GRABER", "Color 48201-Standard Weave 3% Calcite Hem Bar Type: FABW", "Control UltraLite Cordless Lift Ctrl Loc: NA",
      "Pricing Details", "Cassette $145.80 $145.80", "Cordless Lift $100.80 $100.80", "Cordless Lift Promotion ($100.80) ($100.80)",
    ]),
    "SOFT DRAPERIES", "10.0 2 Tag LivingRoom $5,624.40 $11,248.80", "Product Drapery GRABER", "Total Qty 11", "Subtotal $16,355.40", "Tax (5.000%) $817.77", "Total Price $17,173.17",
  ];
  test("ten product lines, eleven units, and the option detail amounts are not charged again", () => {
    const r = parseGraberQuote(text);
    expect(r.rows.length).toBe(10);
    expect(r.rows.reduce((n, x) => n + x.qty, 0)).toBe(11);
    expect(r.sourceTotals).toEqual({ units: 11, subtotalCents: 1635540, taxCents: 81777, totalCents: 1717317 });
    expect(reconcile(r.rows, r.sourceTotals.subtotalCents)).toEqual({ linesCents: 1635540, sourceCents: 1635540, differenceCents: 0 });
    expect(r.rows[0]).toMatchObject({ section: "RESIDENTIAL SOLAR SHADES", description: "Window 1 – Single Solar Roller Residential GRABER", qty: 1, uom: "EA", sellCents: 65880, materialCostCents: null, labourCostCents: null });
    expect(r.rows[0]!.attributes).toMatchObject({ Color: "48201-Standard Weave 3% Calcite Hem Bar Type: FABW", Options: "Cassette; Cordless Lift; Cordless Lift Promotion" });
    expect(r.rows[9]).toMatchObject({ section: "SOFT DRAPERIES", qty: 2, sellCents: 1124880 });
  });
  test("product cost and install are unknown until staff decide: the selling price is never read as a cost", () => {
    const it = importRowToSaveItem(parseGraberQuote(text).rows[9]!, "v1", "graber.pdf", 10);
    expect(it.line).toMatchObject({ price_basis: "fixed_sell", fixed_sell_cents: 1124880, driver_qty: 2, driver_uom: "EA" });
    expect(it.components!.map((c) => [c.label, c.unit_cost_cents])).toEqual([["Product cost", null], ["Install", null]]);
  });
  test("a line whose amounts do not multiply out is flagged for review", () => {
    expect(parseGraberQuote(["1.0 2 Tag Odd $100.00 $150.00", "Subtotal $150.00"]).rows[0]!.issue).toBe("Quantity × price does not equal the extended price");
  });
});
