import { describe, expect, test } from "bun:test";
import { categoryMarkup, describeValue, marginToMarkup, markupFromSell, markupToMargin, parseMargin, priceOrderPart, revertPatch, rollFactorSY, sellFromCost } from "./overrides";
import { priceEstimateLine, simpleComponent, type LineInput, type SnapComponent } from "./assemble";

describe("markup and margin", () => {
  test("35% markup is a 25.93% margin", () => expect(markupToMargin(35)).toBe(25.93));
  test("25.93% margin is about 35% markup", () => expect(marginToMarkup(25.93)).toBeCloseTo(35, 1));
  test("round trip from markup", () => expect(marginToMarkup(markupToMargin(40))).toBeCloseTo(40, 1));
  test("cost 8,177.56 at 40% markup sells for 11,448.58", () => expect(sellFromCost(817756, 40)).toBe(1144858));
  test("markup implied by a typed sell", () => expect(markupFromSell(817756, 1144858)).toBe(40));
  test("no markup from a zero cost", () => expect(markupFromSell(0, 100)).toBeNull());
  test("margin of 100% or more is rejected", () => {
    expect(() => marginToMarkup(100)).toThrow();
    expect(parseMargin("100").ok).toBe(false);
    expect(parseMargin("120").ok).toBe(false);
    expect(parseMargin("99.5")).toEqual({ ok: true, value: 99.5 });
  });
});

describe("order units", () => {
  test("2,500 SF in 24 SF cartons orders 105 cartons", () => {
    const r = priceOrderPart(2500, { unitCostCents: 300, factor: 24, pricePer: "cost_unit" });
    expect(r.orderQty).toBe(105);
    expect(r.costUnitQty).toBe(2520);
    expect(r.costCents).toBe(2520 * 300);
  });
  test("priced per order unit", () => expect(priceOrderPart(2500, { unitCostCents: 7000, factor: 24, pricePer: "order_unit" }).costCents).toBe(105 * 7000));
  test("12 ft × 100 ft roll holds 133.33 SY", () => expect(rollFactorSY(12, 100)).toBe(133.33));
  test("line qty with waste, ceil to cartons", () => {
    const c: SnapComponent = { ...simpleComponent("LVT", 300, "SF"), kind: "material", order_uom: "carton", order_uom_factor: 24, price_per: "cost_unit", waste_pct: 10 };
    const line: LineInput = { driver_qty: 2356, driver_uom: "SF", markup_pct: 0, price_basis: "markup", margin_pct: null, fixed_sell_cents: null, tax_code: "GST" };
    const p = priceEstimateLine(line, [c], { pstPct: 0 });
    // 2356 × 1.10 = 2591.6 SF → 108 cartons = 2,592 SF
    expect(p.orders[0]).toEqual({ orderQty: 108, costUnitQty: 2592 });
    expect(p.costCents).toBe(2592 * 300);
  });
});

describe("line overrides", () => {
  const base: LineInput = { driver_qty: 100, driver_uom: "SF", markup_pct: 40, price_basis: "markup", margin_pct: null, fixed_sell_cents: null, tax_code: "GST" };
  const parts = [simpleComponent("A", 500, "SF"), simpleComponent("B", null, "SF")];
  test("a typed line unit cost replaces the parts", () => {
    const p = priceEstimateLine({ ...base, unit_cost_override_cents: 800 }, parts, { pstPct: 0 });
    expect(p.costCents).toBe(80000);
    expect(p.partsCostCents).toBe(50000);
    expect(p.unknown).toBe(false);
  });
  test("a typed sell is kept when cost changes", () => {
    const p = priceEstimateLine({ ...base, sell_override_cents: 99900 }, [simpleComponent("A", 700, "SF")], { pstPct: 0 });
    expect(p.sellCents).toBe(99900);
    expect(p.sellOverridden).toBe(true);
  });
});

describe("category markup", () => {
  test("own value wins", () => expect(categoryMarkup("Flooring", { Flooring: 30 }, [], 35)).toBe(30));
  test("shared line markup, ignoring overridden lines", () =>
    expect(categoryMarkup("Flooring", {}, [{ section: "Flooring", markup_pct: 25 }, { section: "Flooring", markup_pct: 60, markup_overridden: true }], 35)).toBe(25));
  test("falls back to default", () => expect(categoryMarkup("Prep", {}, [], 35)).toBe(35));
});

describe("change history", () => {
  test("revert a line change applies the from values", () => expect(revertPatch({ line_id: "l", component_index: null, from_value: { markup_pct: 35 } }, [])).toEqual({ line: { markup_pct: 35 } }));
  test("revert a part change patches that part only", () => {
    const r = revertPatch({ line_id: "l", component_index: 1, from_value: { unit_cost_cents: 100 } }, [{ unit_cost_cents: 1 }, { unit_cost_cents: 2 }]);
    expect(r?.components).toEqual([{ unit_cost_cents: 1 }, { unit_cost_cents: 100 }]);
  });
  test("describe values", () => expect(describeValue({ sell_override_cents: 1144858 })).toContain("11,448.58"));
});
