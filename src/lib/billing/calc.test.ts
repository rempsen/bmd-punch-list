import { describe, expect, test } from "bun:test";
import { billNumber, billTotals, billingPosition, checkNewBill, releaseTotals } from "./calc";

describe("progress billing", () => {
  test("a $100,000 bill with 7.5% holdback and 5% GST", () => {
    expect(billTotals(10000000, 7.5, 5)).toEqual({ grossCents: 10000000, holdbackCents: 750000, netCents: 9250000, gstCents: 462500, totalCents: 9712500 });
  });
  test("releasing a $7,500 holdback bills it in full, plus GST", () => {
    expect(releaseTotals(750000, 5)).toEqual({ grossCents: 750000, holdbackCents: 0, netCents: 750000, gstCents: 37500, totalCents: 787500 });
  });
  test("odd amounts round to the cent and still add up", () => {
    const t = billTotals(3333333, 7.5, 5);
    expect(t.holdbackCents + t.netCents).toBe(3333333);
    expect(t.totalCents).toBe(t.netCents + t.gstCents);
  });
  const bills = [
    { kind: "progress" as const, status: "issued" as const, gross_cents: 4000000, holdback_cents: 300000 },
    { kind: "progress" as const, status: "issued" as const, gross_cents: 2000000, holdback_cents: 150000 },
    { kind: "progress" as const, status: "draft" as const, gross_cents: 1000000, holdback_cents: 75000 },
    { kind: "progress" as const, status: "void" as const, gross_cents: 9000000, holdback_cents: 675000 },
    { kind: "holdback_release" as const, status: "issued" as const, gross_cents: 100000, holdback_cents: 0 },
  ];
  test("where the job stands: billed, held back, released and left to bill; void bills do not count", () => {
    // Holdback is only held once its bill is issued: the draft's 750.00 is not there to release yet.
    expect(billingPosition(10000000, bills)).toEqual({ contractCents: 10000000, billedCents: 7000000, remainingCents: 3000000, heldCents: 450000, releasedCents: 100000, holdbackOwingCents: 350000 });
  });
  test("billed to date can never exceed the current contract", () => {
    const pos = billingPosition(10000000, bills);
    expect(checkNewBill(pos, "progress", 3000000)).toBeNull();
    expect(checkNewBill(pos, "progress", 3000001)).toBe("That would bill $100,000.01 against a contract of $100,000.00. Add a change order first, or bill $30,000.00 or less.");
    expect(checkNewBill(pos, "progress", 0)).toBe("Enter an amount to bill.");
    expect(checkNewBill(billingPosition(0, []), "progress", 100)).toBe("There is no accepted quote yet, so there is nothing to bill against.");
  });
  test("a holdback release cannot be more than is being held", () => {
    const pos = billingPosition(10000000, bills);
    expect(checkNewBill(pos, "holdback_release", 350000)).toBeNull();
    expect(checkNewBill(pos, "holdback_release", 350001)).toBe("Only $3,500.00 of holdback is being held.");
  });
  test("bills are numbered per project", () => {
    expect(billNumber("26-041", 1)).toBe("26-041-B01");
    expect(billNumber(null, 12)).toBe("B12");
  });
});

import { renderBillPdf } from "./pdf";
describe("invoice PDF", () => {
  const bill = { number: "26-041-B01", kind: "progress" as const, period_note: "Work to November 30", lines: [{ description: "Materials delivered to site", amountCents: 6000000 }, { description: "Progress to date", amountCents: 4000000 }], gross_cents: 10000000, holdback_pct: 7.5, holdback_cents: 750000, net_cents: 9250000, gst_cents: 462500, total_cents: 9712500, issued_at: "2026-11-30T18:00:00Z" };
  const head = { project: { name: "Hyatt Centric", number: "26-041", address: "325 Broadway" }, client: { name: "Kothari Group", address: "141 Brunel Road" }, gstPct: 5, position: { contractCents: 20000000, billedCents: 10000000 } };
  test("shows each line, the holdback, GST and the amount due", () => {
    const text = renderBillPdf(bill, head, { compress: false }).output();
    for (const s of ["INVOICE", "26-041-B01", "Kothari Group", "Hyatt Centric", "Materials delivered to site", "60,000.00", "100,000.00", "Less 7.5% holdback", "7,500.00", "92,500.00", "GST 5%", "4,625.00", "97,125.00", "Work to November 30", "Contract to date", "200,000.00", "2% per month"]) expect(text).toContain(s);
  });
  test("a holdback release says so and holds nothing back", () => {
    const text = renderBillPdf({ ...bill, number: "26-041-B05", kind: "holdback_release", lines: [{ description: "Release of holdback", amountCents: 750000 }], gross_cents: 750000, holdback_pct: 0, holdback_cents: 0, net_cents: 750000, gst_cents: 37500, total_cents: 787500 }, head, { compress: false }).output();
    expect(text).toContain("HOLDBACK RELEASE");
    expect(text).toContain("7,875.00");
    expect(text).not.toContain("Less ");
  });
});

describe("polish: invoice status", () => {
  const bill = { number: "26-041-B01", kind: "progress" as const, period_note: null, lines: [{ description: "Progress", amountCents: 100000 }], gross_cents: 100000, holdback_pct: 7.5, holdback_cents: 7500, net_cents: 92500, gst_cents: 4625, total_cents: 97125, issued_at: null };
  const head = { project: { name: "Job", number: null, address: null }, client: { name: "Client", address: null }, gstPct: 5, position: { contractCents: 100000, billedCents: 100000 } };
  test("a draft or void bill says so across the page, so it cannot pass for an invoice", () => {
    expect(renderBillPdf({ ...bill, status: "draft" }, head, { compress: false }).output()).toContain("DRAFT - NOT ISSUED");
    expect(renderBillPdf({ ...bill, status: "void" }, head, { compress: false }).output()).toContain("VOID");
    const issued = renderBillPdf({ ...bill, status: "issued" }, head, { compress: false }).output();
    expect(issued).not.toContain("DRAFT");
    expect(issued).not.toContain("VOID");
  });
});
