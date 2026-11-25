import { describe, expect, it } from "vitest";
import { canMove, groupBySupplier, poBlock, purchaseOrderBody, seedRows, STATUS_LABEL, transitionPatch, undoOrderBlock } from "./logic";

const comp = (o: Partial<Parameters<typeof seedRows>[0][number]["components"][number]> = {}) => ({
  kind: "material", catalogue_material_id: "m1", label: "LVT Oak", qty_per_driver: 1, waste_pct: 10, coverage_per_purchase_unit: 20, round_up: true, purchase_uom: "BOX", cost_uom: "BOX", unit_cost_cents: 5000, ...o,
});

describe("status transitions", () => {
  it("moves one step either way only", () => {
    expect(canMove("on_order", "received")).toBe(true);
    expect(canMove("received", "on_site")).toBe(true);
    expect(canMove("on_site", "received")).toBe(true);
    expect(canMove("on_order", "on_site")).toBe(false);
    expect(canMove("on_order", "on_order")).toBe(false);
    expect(canMove("to_order", "on_order")).toBe(true);
    expect(canMove("to_order", "received")).toBe(false);
  });
  it("names each tab for the work done there", () => {
    expect(STATUS_LABEL).toEqual({ to_order: "Ordering", on_order: "Receiving", received: "To site", on_site: "On site" });
  });
  it("records the order date and reference when marked ordered, and clears them on undo", () => {
    expect(transitionPatch("to_order", "on_order", { at: "2026-11-24", po: " 4512 " })).toEqual({ status: "on_order", ordered_at: "2026-11-24", po_number: "4512" });
    expect(transitionPatch("to_order", "on_order", { at: "2026-11-24" })).toEqual({ status: "on_order", ordered_at: "2026-11-24" });
    expect(transitionPatch("on_order", "to_order")).toEqual({ status: "to_order", ordered_at: null, po_number: null });
  });
  it("won't undo an order already sent to QuickBooks", () => {
    expect(undoOrderBlock([{ qbo_po_id: null }])).toBeNull();
    expect(undoOrderBlock([{ qbo_po_id: "9" }])).toMatch(/QuickBooks/);
  });
  it("records receipt and clears it on undo", () => {
    expect(transitionPatch("on_order", "received", { at: "2026-11-24", by: "u1", qty: 5, note: " ok " })).toEqual({ status: "received", received_at: "2026-11-24", received_by: "u1", received_qty: 5, received_note: "ok" });
    expect(transitionPatch("received", "on_order")).toMatchObject({ status: "on_order", received_at: null, received_qty: null });
    expect(transitionPatch("on_site", "received")).toEqual({ status: "received", on_site_at: null, on_site_by: null });
    expect(() => transitionPatch("on_order", "on_site")).toThrow();
  });
});

describe("grouping by supplier", () => {
  it("groups lines and blocks mixed suppliers", () => {
    const rows = [{ supplier_id: "a", status: "to_order", qbo_po_id: null }, { supplier_id: "b", status: "to_order", qbo_po_id: null }, { supplier_id: "a", status: "to_order", qbo_po_id: null }];
    expect(groupBySupplier(rows).get("a")).toHaveLength(2);
    expect(poBlock(rows)).toMatch(/one supplier/);
    expect(poBlock([rows[0]!, rows[2]!])).toBeNull();
    expect(poBlock([{ supplier_id: null, status: "to_order", qbo_po_id: null }])).toMatch(/supplier/);
    expect(poBlock([{ supplier_id: "a", status: "to_order", qbo_po_id: "9" }])).toMatch(/already/);
    expect(poBlock([{ supplier_id: "a", status: "on_order", qbo_po_id: null }])).toMatch(/to order/);
  });
});

describe("seeding from an estimate version", () => {
  it("takes only material components of required lines, sized in purchase units", () => {
    const rows = seedRows([
      { id: "l1", description: "Corridor LVT", driver_qty: 1000, driver_uom: "SF", components: [comp(), comp({ kind: "labour", catalogue_material_id: null })] },
      { id: "l2", description: "Option", driver_qty: 100, driver_uom: "SF", selection: "optional", components: [comp()] },
      { id: "l3", description: "Prep", driver_qty: 100, driver_uom: "SF", components: [comp({ kind: "labour" })] },
      { id: "l4", description: "N/A", driver_qty: 100, driver_uom: "SF", components: [comp({ not_applicable: true })] },
    ]);
    // 1000 SF × 1.10 waste ÷ 20 SF/box = 55 boxes
    expect(rows).toEqual([{ estimate_line_id: "l1", catalogue_item_id: "m1", description: "LVT Oak", quantity: 55, unit: "BOX", unit_cost_cents: 5000 }]);
  });
  it("converts SF to SY when there is no coverage", () => {
    const [r] = seedRows([{ id: "l", description: "Carpet", driver_qty: 90, driver_uom: "SF", components: [comp({ coverage_per_purchase_unit: null, waste_pct: 0, round_up: false, purchase_uom: "SY", cost_uom: "SY" })] }]);
    expect(r?.quantity).toBe(10);
  });
});

describe("purchase order body", () => {
  it("uses linked items, else the fallback account", () => {
    const b = purchaseOrderBody("v1", [{ description: "Grout", quantity: 3, unit: "BAG", unit_cost_cents: 1250, qboItemId: "77" }, { description: "Trim", quantity: 2, unit: "EA", unit_cost_cents: null, qboItemId: null }], { accountId: "40" });
    expect(b.Line[0]).toMatchObject({ DetailType: "ItemBasedExpenseLineDetail", Amount: 37.5, ItemBasedExpenseLineDetail: { ItemRef: { value: "77" }, Qty: 3 } });
    expect(b.Line[1]).toMatchObject({ DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "40" } } });
    expect(() => purchaseOrderBody("v1", [{ description: "Trim", quantity: 1, unit: "", unit_cost_cents: 0, qboItemId: null }], { accountId: null })).toThrow();
  });
});

describe("a part with its own quantity (a Schluter edge on wall tile) is ordered by its own length", () => {
  const edge = { kind: "material", source: "catalogue", catalogue_material_id: "jolly", label: "Schluter Jolly", qty_per_driver: 22, waste_pct: 10, coverage_per_purchase_unit: null, round_up: false, purchase_uom: "LF", cost_uom: "LF", unit_cost_cents: 500 };
  const wall = (c: Partial<typeof edge>) => ({ id: "L1", description: "WT-1 walls", driver_qty: 600, driver_uom: "SF", components: [{ ...edge, ...c }] });
  it("22 LF with 10% waste is 24.2 LF to order, whatever the wall's SF", () => {
    expect(seedRows([wall({})])).toEqual([{ estimate_line_id: "L1", catalogue_item_id: "jolly", description: "Schluter Jolly", quantity: 24.2, unit: "LF", unit_cost_cents: 500 }]);
  });
  it("the finish's own material in another unit is not guessed at as its own quantity", () => {
    expect(seedRows([wall({ source: "finish_material", qty_per_driver: 1 })])[0]?.quantity).not.toBe(1.1);
  });
  it("not answered yet, or answered No: nothing to order", () => {
    expect(seedRows([wall({ qty_per_driver: 0 })])).toEqual([]);
    expect(seedRows([{ ...wall({}), components: [{ ...edge, not_applicable: true }] }])).toEqual([]);
  });
});
