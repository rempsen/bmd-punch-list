/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "bun:test";
import { buildQboInvoice, customerChanges, parseAddress, type BillForQbo } from "./invoice";

const refs = { lineItemId: "99", holdbackItemId: "171", gstCodeId: "3" };
const bill: BillForQbo = {
  id: "b1", number: "26-002-B03", kind: "progress", status: "issued", lines: [{ description: "Progress to date", amountCents: 11217525 }],
  gross_cents: 11217525, holdback_cents: 841314, net_cents: 10376211, gst_cents: 518811, total_cents: 10895022, bill_date: "2026-11-24", due_date: "2026-12-24", client_notes: "Progress invoice number 8", period_note: null, qbo_invoice_id: null,
};

describe("a bill as a QuickBooks invoice", () => {
  test("progress: the work on the flooring item, the holdback as a minus line, GST on both, tax added on top", () => {
    const r = buildQboInvoice({ bill, customerId: "694", refs });
    if (!r.ok) throw new Error(r.message);
    const b = r.body as any;
    expect(b.CustomerRef).toEqual({ value: "694" });
    expect(b.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(b.TxnDate).toBe("2026-11-24");
    expect(b.DueDate).toBe("2026-12-24");
    expect(b.Line.map((l: any) => [l.SalesItemLineDetail.ItemRef.value, l.Amount, l.SalesItemLineDetail.TaxCodeRef.value])).toEqual([["99", 112175.25, "3"], ["171", -8413.14, "3"]]);
    expect(b.CustomerMemo.value).toBe("Progress invoice number 8");
    expect(b.PrivateNote).toContain("26-002-B03");
    expect(b.DocNumber).toBeUndefined();
    expect(b.EmailStatus).toBe("NotSet");
    expect(r.expected).toEqual({ subtotalCents: 10376211, taxCents: 518811, totalCents: 10895022 });
  });
  test("holdback release goes on the holdback item, positive", () => {
    const r = buildQboInvoice({ bill: { ...bill, kind: "holdback_release", lines: [{ description: "Release of holdback", amountCents: 841314 }], gross_cents: 841314, holdback_cents: 0, net_cents: 841314, gst_cents: 42066, total_cents: 883380 }, customerId: "694", refs });
    if (!r.ok) throw new Error(r.message);
    expect((r.body as any).Line.map((l: any) => [l.SalesItemLineDetail.ItemRef.value, l.Amount])).toEqual([["171", 8413.14]]);
  });
  test("refused: a draft, a void bill, one already in QuickBooks, no customer, lines that do not add up", () => {
    expect(buildQboInvoice({ bill: { ...bill, status: "draft" }, customerId: "694", refs }).ok).toBe(false);
    expect(buildQboInvoice({ bill: { ...bill, status: "void" }, customerId: "694", refs }).ok).toBe(false);
    expect(buildQboInvoice({ bill: { ...bill, qbo_invoice_id: "22200" }, customerId: "694", refs }).ok).toBe(false);
    expect(buildQboInvoice({ bill, customerId: null, refs }).ok).toBe(false);
    expect(buildQboInvoice({ bill: { ...bill, gross_cents: 1 }, customerId: "694", refs }).ok).toBe(false);
  });
  test("a bill with no GST is not sent as if it had some", () => {
    const r = buildQboInvoice({ bill: { ...bill, gst_cents: 0, total_cents: bill.net_cents }, customerId: "694", refs });
    expect(r.ok).toBe(false);
  });
  test("several lines keep their quantity and unit price when they have them", () => {
    const r = buildQboInvoice({ bill: { ...bill, lines: [{ description: "Labour", amountCents: 50000, quantity: 10, unitPriceCents: 5000 }, { description: "Material", amountCents: 11167525 }] }, customerId: "694", refs });
    if (!r.ok) throw new Error(r.message);
    const l = (r.body as any).Line[0].SalesItemLineDetail;
    expect([l.Qty, l.UnitPrice]).toEqual([10, 50]);
  });
});

describe("client record over QuickBooks customer", () => {
  const qbo = { Id: "694", SyncToken: "4", DisplayName: "Hyatt Centric", PrimaryEmailAddr: { Address: "old@x.com" }, PrimaryPhone: { FreeFormNumber: "204-555-0100" }, BillAddr: { Line1: "141 Brunel Road", City: "Mississauga", CountrySubDivisionCode: "ON", PostalCode: "L4Z 1X3" } };
  test("only what differs is sent, as a sparse update with the sync token", () => {
    const c = customerChanges({ name: "Hyatt Centric", email: "new@x.com", phone: "204-555-0100", billing_address: "141 Brunel Road, Mississauga ON, L4Z 1X3" }, qbo);
    expect(c.changes.map((x) => x.field)).toEqual(["Email"]);
    expect(c.body).toEqual({ Id: "694", SyncToken: "4", sparse: true, PrimaryEmailAddr: { Address: "new@x.com" } });
  });
  test("a blank on the client never wipes QuickBooks", () => {
    expect(customerChanges({ name: "Hyatt Centric", email: null, phone: "", billing_address: null }, qbo).body).toBeNull();
  });
  test("name, phone and address", () => {
    const c = customerChanges({ name: "Hyatt Centric Winnipeg", email: "old@x.com", phone: "204 555 0199", billing_address: "200 Main St, Unit 4, Winnipeg MB, R3C 1A1" }, qbo);
    expect(c.changes.map((x) => x.field)).toEqual(["Name", "Phone", "Billing address"]);
    expect((c.body as any).DisplayName).toBe("Hyatt Centric Winnipeg");
    expect((c.body as any).BillAddr).toEqual({ Line1: "200 Main St", Line2: "Unit 4", City: "Winnipeg", CountrySubDivisionCode: "MB", PostalCode: "R3C 1A1" });
  });
  test("phone and address compare without punctuation or spacing", () => {
    expect(customerChanges({ name: "hyatt centric", email: "OLD@x.com", phone: "(204) 555-0100", billing_address: "141 Brunel Road,  Mississauga ON, L4Z1X3" }, qbo).body).toBeNull();
  });
  test("an address that is not in the usual shape goes on the first line", () => {
    expect(parseAddress("Somewhere rural")).toEqual({ Line1: "Somewhere rural" });
  });
});
