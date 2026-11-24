import { describe, expect, it } from "vitest";
import { canMove, groupBySupplier, poBlock, purchaseOrderBody, seedRows, transitionPatch } from "./logic";

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
    const rows = [{ supplier_id: "a", status: "on_order", qbo_po_id: null }, { supplier_id: "b", status: "on_order", qbo_po_id: null }, { supplier_id: "a", status: "on_order", qbo_po_id: null }];
    expect(groupBySupplier(rows).get("a")).toHaveLength(2);
    expect(poBlock(rows)).toMatch(/one supplier/);
    expect(poBlock([rows[0]!, rows[2]!])).toBeNull();
    expect(poBlock([{ supplier_id: null, status: "on_order", qbo_po_id: null }])).toMatch(/supplier/);
    expect(poBlock([{ supplier_id: "a", status: "on_order", qbo_po_id: "9" }])).toMatch(/already/);
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
