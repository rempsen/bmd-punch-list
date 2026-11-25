import { describe, expect, test } from "bun:test";
import type { LabourRate } from "@/lib/subcontract/logic";
import {
  estimateLabourCostCents,
  estimateLabourTotalCents,
  estimateLabourUnitCents,
  installerPay,
  labourBudgetLine,
  lineValueCents,
  uncostedText,
  valuationFor,
  valueLines,
  type EstimateLabour,
  type LabourComponent,
} from "./valuation";

const labour = (o: Partial<LabourComponent>): LabourComponent => ({ unit_cost_cents: 115, cost_uom: "SF", purchase_uom: "SF", qty_per_driver: 1, waste_pct: 0, round_up: false, on_gross: false, labour_rate_id: "rate-lvt", ...o });

// LVT 2,500 SF at $1.15/SF; carpet 100 SY at $5.50/SY; base 300 LF with labour quoted in SY of a different unit; prep with no labour.
const items: EstimateLabour[] = [
  { estimate_line_id: "lvt", quantity: 2500, uom: "SF", cost_code: "01-26", labour_components: [labour({})], labour_rate_id: "rate-lvt" },
  { estimate_line_id: "cpt", quantity: 100, uom: "SY", cost_code: "01-10", labour_components: [labour({ unit_cost_cents: 550, cost_uom: "SY", purchase_uom: "SY", labour_rate_id: "rate-cpt" })], labour_rate_id: "rate-cpt" },
  { estimate_line_id: "cpt-sf", quantity: "900", uom: "SF", cost_code: "01-10", labour_components: [labour({ unit_cost_cents: 550, cost_uom: "SY", purchase_uom: "SY", labour_rate_id: "rate-cpt" })], labour_rate_id: "rate-cpt" },
  { estimate_line_id: "base", quantity: 300, uom: "LF", cost_code: "01-30", labour_components: [], labour_rate_id: null },
  { estimate_line_id: "prep", quantity: 1, uom: "LS", cost_code: null, labour_components: [labour({ unit_cost_cents: null })], labour_rate_id: null },
  { estimate_line_id: "hidden", quantity: 10, uom: "EA", cost_code: "01-30", labour_components: null, labour_rate_id: null },
];
const rates: LabourRate[] = [
  { id: "cat-base", name: "Base", uom: "LF", unit_cost_cents: 175, cost_code: "01-30", active: true },
  { id: "cat-lvt", name: "LVT (catalogue)", uom: "SF", unit_cost_cents: 999, cost_code: "01-26", active: true },
  { id: "cat-cpt-sy", name: "Carpet", uom: "SY", unit_cost_cents: 900, cost_code: "01-10", active: true },
  { id: "cat-old", name: "Old", uom: "LF", unit_cost_cents: 50, cost_code: "01-40", active: false },
];

describe("the estimate's labour per driver unit", () => {
  test("is the labour component's rate when units match", () => {
    expect(estimateLabourUnitCents(items[0]!)).toBe(115);
    expect(estimateLabourUnitCents(items[1]!)).toBe(550);
  });
  test("converts SY labour onto an SF line with the estimate's arithmetic, and the whole-line cost agrees", () => {
    expect(estimateLabourCostCents(items[2]!)).toBe(55000); // 900 SF = 100 SY × $5.50
    expect(estimateLabourUnitCents(items[2]!)).toBe(61); // $0.611/SF to whole cents
  });
  test("waste paid on gross and quantity per driver are spread over the unit", () => {
    const i: EstimateLabour = { estimate_line_id: "x", quantity: 100, uom: "SF", labour_components: [labour({ waste_pct: 10, on_gross: true }), labour({ unit_cost_cents: 200, qty_per_driver: 0.5, labour_rate_id: null })] };
    expect(estimateLabourCostCents(i)).toBe(12650 + 10000);
    expect(estimateLabourUnitCents(i)).toBe(227);
  });
  test("is null with no labour, with labour that has no cost, without pricing access, or when the units cannot be converted", () => {
    expect(estimateLabourUnitCents(items[3]!)).toBeNull();
    expect(estimateLabourUnitCents(items[4]!)).toBeNull();
    expect(estimateLabourUnitCents(items[5]!)).toBeNull();
    expect(estimateLabourUnitCents({ estimate_line_id: "bad", quantity: 10, uom: "LF", labour_components: [labour({ cost_uom: "SY", purchase_uom: "SY" })] })).toBeNull();
  });
  test("a line with no quantity is still priced per unit", () => {
    expect(estimateLabourUnitCents({ ...items[0]!, quantity: 0 })).toBe(115);
  });
  test("the approved estimate's labour adds up over the priced lines only", () => {
    expect(estimateLabourTotalCents(items)).toBe(287500 + 55000 + 55000);
    expect(estimateLabourTotalCents([items[3]!, items[5]!])).toBeNull();
  });
});

describe("valuationFor", () => {
  test("the estimate's rate wins over the catalogue", () => {
    expect(valuationFor({ estimate_line_id: "lvt", cost_code: "01-26", uom: "SF" }, items, rates)).toEqual({ unit_labour_cost_cents: 115, labour_rate_source: "estimate", labour_rate_id: "rate-lvt" });
  });
  test("falls back to the catalogue rate by cost code when the estimate line has no labour", () => {
    expect(valuationFor({ estimate_line_id: "base", cost_code: "01-30", uom: "LF" }, items, rates)).toEqual({ unit_labour_cost_cents: 175, labour_rate_source: "catalogue", labour_rate_id: "cat-base" });
    // A line typed by hand (no estimate line) still gets the catalogue's rate for its cost code.
    expect(valuationFor({ estimate_line_id: null, cost_code: "01-30", uom: "LF" }, items, rates).labour_rate_source).toBe("catalogue");
  });
  test("converts a catalogue SY rate onto an SF line, and gives up across other units", () => {
    expect(valuationFor({ estimate_line_id: null, cost_code: "01-10", uom: "SF" }, items, rates)).toEqual({ unit_labour_cost_cents: 100, labour_rate_source: "catalogue", labour_rate_id: "cat-cpt-sy" });
    expect(valuationFor({ estimate_line_id: null, cost_code: "01-10", uom: "LF" }, items, rates).unit_labour_cost_cents).toBeNull();
  });
  test("null stays null: no labour on the estimate and nothing in the catalogue is no rate, never 0", () => {
    expect(valuationFor({ estimate_line_id: "prep", cost_code: null, uom: "LS" }, items, rates)).toEqual({ unit_labour_cost_cents: null, labour_rate_source: null, labour_rate_id: null });
    expect(valuationFor({ estimate_line_id: "hidden", cost_code: "01-40", uom: "EA" }, items, rates).unit_labour_cost_cents).toBeNull();
  });
});

describe("valueLines", () => {
  const ctx = { saved: [], items, rates, canPrice: false };
  test("new lines are valued from the estimate, then the catalogue, else left without a rate", () => {
    const out = valueLines(
      [
        { estimate_line_id: "lvt", description: "LVT", quantity: 500, uom: "SF", cost_code: "01-26" },
        { estimate_line_id: "base", description: "Base", quantity: 10, uom: "LF", cost_code: "01-30" },
        { estimate_line_id: "prep", description: "Prep", quantity: 1, uom: "LS", cost_code: null },
      ],
      ctx,
    );
    expect(out.map((l) => [l.unit_labour_cost_cents, l.labour_rate_source])).toEqual([
      [115, "estimate"],
      [175, "catalogue"],
      [null, null],
    ]);
  });
  test("a saved line keeps its snapshot when the estimate's rate has since changed", () => {
    const dearer = items.map((i) => (i.estimate_line_id === "lvt" ? { ...i, labour_components: [labour({ unit_cost_cents: 150 })] } : i));
    const out = valueLines(
      [
        { id: "saved-1", estimate_line_id: "lvt", description: "LVT", quantity: 500, uom: "SF", cost_code: "01-26" },
        { estimate_line_id: "lvt", description: "LVT (more)", quantity: 200, uom: "SF", cost_code: "01-26" },
      ],
      { ...ctx, items: dearer, saved: [{ id: "saved-1", unit_labour_cost_cents: 115, labour_rate_source: "estimate", labour_rate_id: "rate-lvt" }] },
    );
    expect(out[0]).toMatchObject({ unit_labour_cost_cents: 115, labour_rate_source: "estimate", labour_rate_id: "rate-lvt" });
    expect(out[1]).toMatchObject({ unit_labour_cost_cents: 150, labour_rate_source: "estimate" });
  });
  test("a saved line with no rate is valued again; a quantity change alone keeps the rate", () => {
    const out = valueLines(
      [{ id: "saved-2", estimate_line_id: "base", description: "Base", quantity: 40, uom: "LF", cost_code: "01-30" }],
      { ...ctx, saved: [{ id: "saved-2", unit_labour_cost_cents: null, labour_rate_source: null, labour_rate_id: null }] },
    );
    expect(out[0]).toMatchObject({ unit_labour_cost_cents: 175, labour_rate_source: "catalogue", quantity: 40 });
  });
  test("a rate entered by pricing staff is kept as manual; typed without view_pricing it is ignored", () => {
    const line = { id: "saved-1", estimate_line_id: "lvt", description: "LVT", quantity: 500, uom: "SF", cost_code: "01-26", unit_labour_cost_cents: 130, labour_rate_source: "manual" as const };
    const saved = [{ id: "saved-1", unit_labour_cost_cents: 115, labour_rate_source: "estimate" as const, labour_rate_id: "rate-lvt" }];
    expect(valueLines([line], { ...ctx, saved, canPrice: true })[0]).toMatchObject({ unit_labour_cost_cents: 130, labour_rate_source: "manual", labour_rate_id: null });
    expect(valueLines([line], { ...ctx, saved, canPrice: false })[0]).toMatchObject({ unit_labour_cost_cents: 115, labour_rate_source: "estimate" });
    // A rate claimed as "from estimate" by the browser is not trusted either: the estimate is read again.
    expect(valueLines([{ ...line, labour_rate_source: "estimate", id: undefined }], { ...ctx, canPrice: true })[0]!.unit_labour_cost_cents).toBe(115);
  });
});

describe("totals", () => {
  test("line value is quantity × rate in whole cents, null without a rate", () => {
    expect(lineValueCents({ quantity: 500, unit_labour_cost_cents: 115 })).toBe(57500);
    expect(lineValueCents({ quantity: "100", unit_labour_cost_cents: 550 })).toBe(55000);
    expect(lineValueCents({ quantity: 33, unit_labour_cost_cents: 61 })).toBe(2013);
    expect(lineValueCents({ quantity: 500, unit_labour_cost_cents: null })).toBeNull();
  });
  test("installer pay adds the costed lines and counts the uncosted ones", () => {
    expect(installerPay([{ quantity: 500, unit_labour_cost_cents: 115 }, { quantity: 100, unit_labour_cost_cents: 550 }, { quantity: 10, unit_labour_cost_cents: null }, { quantity: 1 }])).toEqual({ total_cents: 112500, uncosted: 2 });
    expect(installerPay([])).toEqual({ total_cents: 0, uncosted: 0 });
  });
  test("uncosted text and the budget line", () => {
    expect(uncostedText(0)).toBe("");
    expect(uncostedText(1)).toBe("1 line uncosted");
    expect(uncostedText(3)).toBe("3 lines uncosted");
    expect(labourBudgetLine(57500, 0, 287500)).toBe("Installer pay to date: $575.00 of $2,875.00 estimated labour (20%)");
    expect(labourBudgetLine(57500, 2, null)).toBe("Installer pay to date: $575.00 · estimate has no priced labour · 2 lines uncosted");
    expect(labourBudgetLine(0, 0, 0)).toBe("Installer pay to date: $0.00");
  });
});
