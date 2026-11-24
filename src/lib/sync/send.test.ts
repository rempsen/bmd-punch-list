import { describe, expect, test } from "bun:test";
import { planSend, sendSummary, type SendInput } from "./send";

const base: SendInput = {
  outbox: { id: "o1", kind: "material", bmd_id: "m1", label: "Dante Pro 2.0", op: "update", changes: { unit_cost_cents: { from: 129, to: 135 } } },
  record: { id: "m1", name: "Dante Pro 2.0", unit_cost_cents: 135, active: true, supplier_id: "s1", supplier_name: "Gerflor" },
  link: { external_id: "77" },
  supplierLink: { external_id: "900" },
  current: { Id: "77", SyncToken: "3" },
  reference: null,
};

describe("planning a QuickBooks send", () => {
  test("a linked material becomes a sparse Item update with cost in dollars, active flag and preferred vendor", () => {
    const p = planSend(base);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.send).toMatchObject({ outboxId: "o1", kind: "material", target: "Item", qboId: "77", op: "update" });
    expect(p.send.body).toEqual({ Id: "77", SyncToken: "3", sparse: true, Name: "Dante Pro 2.0", PurchaseCost: 1.35, Active: true, PrefVendorRef: { value: "900" } });
    expect(p.send.summary).toEqual(["cost 1.29 → 1.35"]);
  });
  test("a blank cost is never sent as 0, and a selling price is never sent", () => {
    const p = planSend({ ...base, record: { ...base.record, unit_cost_cents: null }, outbox: { ...base.outbox, changes: { unit_cost_cents: { from: 129, to: null } } } });
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).not.toHaveProperty("PurchaseCost");
    expect(p.send.body).not.toHaveProperty("UnitPrice");
    expect(p.send.summary).toEqual(["cost 1.29 → unknown (not sent)"]);
  });
  test("a labour rate is an Item too, without a vendor", () => {
    const p = planSend({ ...base, outbox: { ...base.outbox, kind: "labour", changes: { name: { from: "Install LVP", to: "Install LVP/LVT" } } }, record: { id: "l1", name: "Install LVP/LVT", unit_cost_cents: 125, active: true }, supplierLink: null });
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).toEqual({ Id: "77", SyncToken: "3", sparse: true, Name: "Install LVP/LVT", PurchaseCost: 1.25, Active: true });
    expect(p.send.summary).toEqual(['name "Install LVP" → "Install LVP/LVT"']);
  });
  test("a delete in BMD deactivates in QuickBooks and never deletes", () => {
    const p = planSend({ ...base, outbox: { ...base.outbox, op: "delete", changes: {} } });
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.op).toBe("deactivate");
    expect(p.send.body).toMatchObject({ Id: "77", SyncToken: "3", sparse: true, Active: false });
    expect(p.send.summary).toEqual(["made inactive in QuickBooks (removed in BMD)"]);
  });
  test("a linked supplier is a sparse Vendor update with blanks left out", () => {
    const p = planSend({
      outbox: { id: "o2", kind: "supplier", bmd_id: "s1", label: "Gerflor", op: "update", changes: { email: { from: null, to: "orders@gerflor.test" } } },
      record: { id: "s1", name: "Gerflor", active: true, email: "orders@gerflor.test", phone: null, account_number: "" },
      link: { external_id: "900" },
      supplierLink: null,
      current: { Id: "900", SyncToken: "8" },
      reference: null,
    });
    if (!p.ok) throw new Error(p.reason);
    expect(p.send).toMatchObject({ target: "Vendor", qboId: "900", op: "update" });
    expect(p.send.body).toEqual({ Id: "900", SyncToken: "8", sparse: true, DisplayName: "Gerflor", Active: true, PrimaryEmailAddr: { Address: "orders@gerflor.test" } });
    expect(p.send.summary).toEqual(["email → orders@gerflor.test"]);
  });
  test("an unlinked supplier is created", () => {
    const p = planSend({ outbox: { id: "o3", kind: "supplier", bmd_id: "s2", label: "New Co", op: "create", changes: {} }, record: { id: "s2", name: "New Co", active: true }, link: null, supplierLink: null, current: null, reference: null });
    if (!p.ok) throw new Error(p.reason);
    expect(p.send).toMatchObject({ target: "Vendor", qboId: null, op: "create", body: { DisplayName: "New Co", Active: true } });
    expect(p.send.summary).toEqual(["new vendor in QuickBooks"]);
  });
  test("an unlinked material is created only when a reference item lends its accounts", () => {
    const input: SendInput = { ...base, link: null, current: null, outbox: { ...base.outbox, op: "create", changes: {} }, reference: { Type: "NonInventory", IncomeAccountRef: { value: "1" }, ExpenseAccountRef: { value: "2" } } };
    const p = planSend(input);
    if (!p.ok) throw new Error(p.reason);
    expect(p.send).toMatchObject({ target: "Item", qboId: null, op: "create" });
    expect(p.send.body).toEqual({ Name: "Dante Pro 2.0", Type: "NonInventory", IncomeAccountRef: { value: "1" }, ExpenseAccountRef: { value: "2" }, PurchaseCost: 1.35, Active: true, PrefVendorRef: { value: "900" } });
    const no = planSend({ ...input, reference: null });
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.reason).toMatch(/no reference item/);
  });
  test("a linked record whose QuickBooks copy cannot be read is not sent", () => {
    const p = planSend({ ...base, current: null });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/could not be read/);
  });
  test("a deleted record that was never linked has nothing to send", () => {
    const p = planSend({ ...base, link: null, current: null, outbox: { ...base.outbox, op: "delete", changes: {} } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/never in QuickBooks/);
  });
  test("summaries read as sentences", () => {
    expect(sendSummary({ unit_cost_cents: { from: 129, to: 135 }, supplier_id: { from: null, to: "s1" }, active: { from: true, to: false } }, { supplierName: "Gerflor" })).toEqual(["cost 1.29 → 1.35", "supplier → Gerflor", "made inactive"]);
  });
});
