import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { billTotals, billingPosition, checkNewBill, releaseTotals } from "./calc";
import { renderBillPdf } from "./pdf";

/** Fixed-price jobs as they billed before open-book jobs were added. These figures must never move. */
describe("fixed-price billing is unchanged", () => {
  test("bill totals at 7.5% holdback and 5% GST", () => {
    expect(billTotals(6000000, 7.5, 5)).toEqual({ grossCents: 6000000, holdbackCents: 450000, netCents: 5550000, gstCents: 277500, totalCents: 5827500 });
    expect(billTotals(1234567, 7.5, 5)).toEqual({ grossCents: 1234567, holdbackCents: 92593, netCents: 1141974, gstCents: 57099, totalCents: 1199073 });
    expect(billTotals(99, 7.5, 5)).toEqual({ grossCents: 99, holdbackCents: 7, netCents: 92, gstCents: 5, totalCents: 97 });
    expect(billTotals(250000, 0, 5)).toEqual({ grossCents: 250000, holdbackCents: 0, netCents: 250000, gstCents: 12500, totalCents: 262500 });
    expect(releaseTotals(92593, 5)).toEqual({ grossCents: 92593, holdbackCents: 0, netCents: 92593, gstCents: 4630, totalCents: 97223 });
  });
  test("position against the contract, and the over-billing guard", () => {
    const bills = [
      { kind: "progress" as const, status: "issued" as const, gross_cents: 6000000, holdback_cents: 450000 },
      { kind: "progress" as const, status: "draft" as const, gross_cents: 1234567, holdback_cents: 92593 },
      { kind: "holdback_release" as const, status: "issued" as const, gross_cents: 200000, holdback_cents: 0 },
    ];
    const pos = billingPosition(10000000, bills);
    expect(pos).toEqual({ contractCents: 10000000, billedCents: 7234567, remainingCents: 2765433, heldCents: 450000, releasedCents: 200000, holdbackOwingCents: 250000 });
    expect(checkNewBill(pos, "progress", 2765433)).toBeNull();
    expect(checkNewBill(pos, "progress", 2765434)).toContain("against a contract of $100,000.00");
    expect(checkNewBill(pos, "holdback_release", 250001)).toBe("Only $2,500.00 of holdback is being held.");
  });
  test("the invoice keeps its one page and its contract lines", () => {
    const doc = renderBillPdf(
      { number: "26-041-B02", kind: "progress", period_note: null, lines: [{ description: "Progress to date", amountCents: 1234567 }], gross_cents: 1234567, holdback_pct: 7.5, holdback_cents: 92593, net_cents: 1141974, gst_cents: 57099, total_cents: 1199073, issued_at: "2026-11-30T18:00:00Z", status: "issued" },
      { project: { name: "Hyatt Centric", number: "26-041", address: null }, client: { name: "Kothari Group", address: null }, gstPct: 5, position: { contractCents: 10000000, billedCents: 7234567 } },
      { compress: false },
    );
    const text = doc.output();
    expect(doc.getNumberOfPages()).toBe(1);
    for (const s of ["INVOICE", "Progress to date", "12,345.67", "This bill", "Less 7.5% holdback", "925.93", "Subtotal", "11,419.74", "GST 5%", "570.99", "Amount due", "11,990.73", "Contract to date", "100,000.00", "72,345.67"]) expect(text).toContain(s);
    for (const s of ["Labour", "Markup", "Backup", "Open book"]) expect(text).not.toContain(s);
    // The drawing instructions of the page, byte for byte (the file's date and id are outside this part).
    const page = text.slice(text.indexOf("stream\n"), text.indexOf("endstream"));
    expect(createHash("sha256").update(page).digest("hex")).toBe("b9bba195aace79ca1e6633988bee09ec9e8dd220988290760c42bd080dca4d98");
  });
});
