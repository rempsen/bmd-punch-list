import { describe, expect, it } from "bun:test";
import { convert, priceLine, totals, type Component, type Line } from "./calc";

const rates = { pstPct: 7 };
const mat = (o: Partial<Component>): Component => ({ kind: "material", unitCostCents: 0, costUom: "SF", purchaseUom: "SF", qtyPerDriver: 1, wastePct: 0, roundUp: false, pstApplies: true, ...o });
const lab = (o: Partial<Component>): Component => ({ kind: "labour", unitCostCents: 0, costUom: "SF", purchaseUom: "SF", qtyPerDriver: 1, wastePct: 0, roundUp: false, pstApplies: false, ...o });

describe("convert", () => {
  it("square feet to square yards", () => expect(convert(4500, "SF", "SY")).toBe(500));
  it("refuses unrelated units", () => expect(() => convert(1, "SF", "LF")).toThrow());
});

describe("priceLine", () => {
  const lvp: Line = { driverQty: 1000, driverUom: "SF", markupPct: 30, taxCode: "GST", components: [
    mat({ unitCostCents: 250, costUom: "SF", purchaseUom: "carton", coveragePerPurchaseUnit: 23.6, wastePct: 10, roundUp: true }),
    lab({ unitCostCents: 175 }),
  ] };
  it("LVP supply and install: carton rounding, PST in cost, labour on net", () => {
    const r = priceLine(lvp, rates);
    expect(r.components[0]).toEqual({ purchaseQty: 47, costCents: 296711 });
    expect(r.components[1].costCents).toBe(175000);
    expect(r.costCents).toBe(471711);
    expect(r.sellCents).toBe(613224);
  });
  it("broadloom by the square yard with waste, no roll rounding", () => {
    const r = priceLine({ driverQty: 4500, driverUom: "SF", markupPct: 0, taxCode: "GST", components: [
      mat({ unitCostCents: 3200, costUom: "SY", purchaseUom: "SY", wastePct: 8 }) ] }, rates);
    expect(r.components[0].purchaseQty).toBe(540);
    expect(r.components[0].costCents).toBe(Math.round(540 * 3200 * 1.07));
  });
  it("window coverings per piece: vendor + install + misc, PST on vendor only", () => {
    const r = priceLine({ driverQty: 40, driverUom: "EA", markupPct: 35, taxCode: "GST", components: [
      mat({ unitCostCents: 31000, costUom: "EA", purchaseUom: "EA" }),
      lab({ unitCostCents: 4500, costUom: "EA", purchaseUom: "EA" }),
      lab({ unitCostCents: 1200, costUom: "EA", purchaseUom: "EA" }),
    ] }, rates);
    expect(r.costCents).toBe(1554800);
    expect(r.sellCents).toBe(2098980);
  });
  it("labour on gross uses the wasted quantity", () => {
    const r = priceLine({ driverQty: 1000, driverUom: "SF", markupPct: 0, taxCode: "GST", components: [lab({ unitCostCents: 175, wastePct: 10, onGross: true })] }, rates);
    expect(r.costCents).toBe(192500);
  });
  it("adhesive by the pail rounds up to whole pails", () => {
    const r = priceLine({ driverQty: 1000, driverUom: "SF", markupPct: 0, taxCode: "GST", components: [
      mat({ unitCostCents: 8900, costUom: "pail", purchaseUom: "pail", coveragePerPurchaseUnit: 250, wastePct: 5, roundUp: true }) ] }, rates);
    expect(r.components[0].purchaseQty).toBe(5);
    expect(r.costCents).toBe(Math.round(5 * 8900 * 1.07));
  });
  it("zero quantity prices to zero; negative is refused", () => {
    expect(priceLine({ ...lvp, driverQty: 0 }, rates).sellCents).toBe(0);
    expect(() => priceLine({ ...lvp, driverQty: -1 }, rates)).toThrow();
  });
});

describe("totals", () => {
  it("GST on summed amounts", () => {
    const t = totals([
      { sellCents: 613224, taxCode: "GST", costCode: "01-05", section: "Level 2" },
      { sellCents: 2098980, taxCode: "GST", costCode: "02-100", section: "Windows" },
    ], { gstPct: 5, hstPct: 13 });
    expect(t.subtotalCents).toBe(2712204);
    expect(t.taxCents).toBe(135610);
    expect(t.totalCents).toBe(2847814);
    expect(t.byCostCode["02-100"]).toBe(2098980);
  });
  it("exempt lines carry no tax", () => {
    const t = totals([{ sellCents: 100000, taxCode: "EXEMPT", costCode: "01", section: "A" }], { gstPct: 5, hstPct: 13 });
    expect(t.taxCents).toBe(0);
  });
});
