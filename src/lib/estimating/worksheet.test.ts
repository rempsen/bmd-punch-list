import { describe, expect, test } from "bun:test";
import { simpleComponent, priceEstimateLine, type LineInput, type SnapComponent } from "./assemble";
import { totals } from "./calc";
import { parsePastedQuantities, versionSummary, type WsLine } from "./worksheet";

const rates = { pstPct: 7, gstPct: 5, hstPct: 13 };
const mk = (o: Partial<WsLine> & { components: SnapComponent[] }): WsLine => ({
  id: "x", section: "General", cost_code: "01-05", description: "", driver_qty: 1, driver_uom: "LS", markup_pct: 30, price_basis: "markup", margin_pct: null,
  fixed_sell_cents: null, tax_code: "GST", selection: "required", selection_group: null, ...o,
});

describe("versionSummary", () => {
  const lines = [
    mk({ id: "a", section: "Level 2", cost_code: "01-05", driver_qty: 1000, driver_uom: "SF", components: [simpleComponent("LVP supply and install", 472, "SF")] }),
    mk({ id: "b", section: "Level 2", cost_code: "02-100", driver_qty: 40, driver_uom: "EA", markup_pct: 35, components: [simpleComponent("Shade", 38870, "EA")] }),
    mk({ id: "c", section: "Corridors", cost_code: "01-18", tax_code: "EXEMPT", components: [simpleComponent("Prep", 50000, "LS")] }),
  ];
  test("totals equal the calculation module's totals for the same lines", () => {
    const s = versionSummary(lines, rates);
    const priced = lines.map((l) => ({ sellCents: priceEstimateLine(l as LineInput, l.components, rates).sellCents, taxCode: l.tax_code, costCode: l.cost_code ?? "", section: l.section }));
    expect(s.totals).toEqual(totals(priced, rates));
    expect(s.sellCents).toBe(s.totals.subtotalCents);
  });
  test("reports cost, blended margin and section subtotals in first-seen order", () => {
    const s = versionSummary(lines, rates);
    expect(s.costCents).toBe(472000 + 1554800 + 50000);
    expect(s.marginPct).toBeCloseTo(((s.sellCents - s.costCents) / s.sellCents) * 100, 1);
    expect(s.sections.map((x) => x.section)).toEqual(["Level 2", "Corridors"]);
    expect(s.sections[0]!.sellCents + s.sections[1]!.sellCents).toBe(s.sellCents);
  });
  test("counts lines whose cost is not fully known", () => {
    const s = versionSummary([...lines, mk({ id: "d", components: [simpleComponent("Delivery", null, "LS")] })], rates);
    expect(s.unknownLines).toBe(1);
  });
  test("optional lines the client has not said yes to stay out of the committed total; one member of a choose-one group counts", () => {
    const withOptions = [
      ...lines,
      mk({ id: "o1", selection: "optional", components: [simpleComponent("Upgrade", 100000, "LS")] }),
      mk({ id: "g1", selection: "choose_one", selection_group: "base", components: [simpleComponent("Rubber base", 10000, "LS")] }),
      mk({ id: "g2", selection: "choose_one", selection_group: "base", components: [simpleComponent("Millwork base", 30000, "LS")] }),
    ];
    const base = versionSummary(lines, rates).sellCents;
    // Default: optional not included; the first member of each choose-one group is the default pick.
    expect(versionSummary(withOptions, rates).sellCents).toBe(base + 13000);
    expect(versionSummary(withOptions, rates, { o1: "yes", g2: "yes" }).sellCents).toBe(base + 130000 + 39000);
    expect(versionSummary(withOptions, rates, { o1: "maybe" }).sellCents).toBe(base + 13000);
    expect(versionSummary(withOptions, rates, { o1: "maybe" }).maybeCents).toBe(130000);
  });
});

describe("parsePastedQuantities", () => {
  test("reads tab-separated rows pasted from Excel, with thousands separators and units", () => {
    const out = parsePastedQuantities("CPT-1\t4,500\tSF\tLevel 2\nLVP-1\t1200.5\tsq ft\nRB-1\t860\tLF\tCorridors\n");
    expect(out.problems).toEqual([]);
    expect(out.rows).toEqual([
      { tag: "CPT-1", qty: 4500, uom: "SF", section: "Level 2" },
      { tag: "LVP-1", qty: 1200.5, uom: "SF", section: null },
      { tag: "RB-1", qty: 860, uom: "LF", section: "Corridors" },
    ]);
  });
  test("skips a header row and reads comma-separated text", () => {
    const out = parsePastedQuantities("Tag,Qty,Unit\nCPT-1,300,SY\n");
    expect(out.rows).toEqual([{ tag: "CPT-1", qty: 300, uom: "SY", section: null }]);
  });
  test("a row without a usable quantity is reported, not guessed", () => {
    const out = parsePastedQuantities("CPT-1\tTBD\tSF\nLVT-2\t-5\tSF\nLVP-1\t100");
    expect(out.rows).toEqual([{ tag: "LVP-1", qty: 100, uom: null, section: null }]);
    expect(out.problems).toEqual(['Row 1: "TBD" is not a quantity.', 'Row 2: "-5" is not a quantity.']);
  });
});
