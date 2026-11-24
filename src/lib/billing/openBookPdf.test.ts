import { describe, expect, test } from "bun:test";
import { buildOpenBookBill, type LabourEntry, type MaterialEntry, type Terms } from "./openBook";
import { renderBillPdf, type BillForPdf } from "./pdf";

const terms: Terms = { markupPct: 15, labourRateCents: 8500, namedRates: [], holdbackApplies: true };
const labour: LabourEntry[] = [
  { id: "l1", description: "Remove carpet, level 2 corridor", workDate: "2026-11-02", workDateEnd: "2026-11-06", hours: 32, rateCents: 8500, billId: null },
  { id: "l2", description: "Helper", workDate: "2026-11-04", workDateEnd: null, hours: 7.25, rateCents: 5500, billId: null },
];
const materials: MaterialEntry[] = [
  { id: "m1", supplierName: "Prosol", invoiceNumber: "INV-1001", invoiceDate: "2026-11-03", amountCents: 240000, markupPct: null, markupNote: null, attachmentName: "Prosol INV-1001.pdf", billId: null },
  { id: "m2", supplierName: "Shnier", invoiceNumber: "88123", invoiceDate: "2026-11-04", amountCents: 3330, markupPct: 10, markupNote: "Dan agreed 10% by phone", attachmentName: null, billId: null },
];
const head = { project: { name: "Hyatt Centric", number: "26-041", address: "325 Broadway" }, client: { name: "Kothari Group", address: "141 Brunel Road" }, gstPct: 5, position: { contractCents: 0, billedCents: 591538 } };
function bill(l = labour, m = materials, status: BillForPdf["status"] = "issued"): BillForPdf {
  const b = buildOpenBookBill(l, m, terms, { holdbackPct: 7.5, gstPct: 5 });
  if ("problem" in b) throw new Error(b.problem);
  return { number: "26-041-B01", kind: "progress", period_note: "Work to November 6", lines: b.lines, gross_cents: b.totals.grossCents, holdback_pct: b.holdbackPct, holdback_cents: b.totals.holdbackCents, net_cents: b.totals.netCents, gst_cents: b.totals.gstCents, total_cents: b.totals.totalCents, issued_at: "2026-11-30T18:00:00Z", status, open_book: b.snapshot };
}
const pages = (text: string) => text.split("endstream").filter((p) => p.includes("stream\n")).map((p) => p.slice(p.indexOf("stream\n")));

describe("open-book invoice PDF", () => {
  const doc = renderBillPdf(bill(), head, { compress: false });
  const text = doc.output();
  const [first, second] = pages(text);
  test("page one: labour lines, material invoices with markup, then holdback, GST and the amount due", () => {
    expect(doc.getNumberOfPages()).toBe(2);
    for (const s of ["INVOICE", "26-041-B01", "Kothari Group", "Hyatt Centric", "Work to November 6", "Labour", "Remove carpet, level 2 corridor", "Nov 2 to Nov 6, 2026", "32 h", "$85.00", "2,720.00", "Helper", "7.25 h", "398.75", "3,118.75",
      "Materials", "Prosol", "INV-1001", "Nov 3, 2026", "2,400.00", "15%", "360.00", "2,760.00", "Shnier", "88123", "33.30", "10%", "3.33", "36.63", "2,796.63",
      "This bill", "5,915.38", "Less 7.5% holdback", "443.65", "Subtotal", "5,471.73", "GST 5%", "273.59", "Amount due", "5,745.32", "Billed to date, including this bill", "2% per month"]) expect(first).toContain(s);
  });
  test("an open-book job has no contract amount to print", () => {
    expect(text).not.toContain("Contract to date");
    expect(first).toContain("Open-book job");
  });
  test("page two is the backup: every supplier invoice, and the copies by name", () => {
    for (const s of ["Backup", "26-041-B01", "Supplier", "Invoice", "Amount", "Markup", "Total", "Prosol", "INV-1001", "2,400.00", "360.00", "2,760.00", "Shnier", "88123", "2,433.30", "363.33", "2,796.63", "Copies of supplier invoices", "Prosol INV-1001.pdf"]) expect(second).toContain(s);
  });
  test("office notes about a markup never reach the client", () => {
    expect(text).not.toContain("by phone");
    expect(text).not.toContain("Dan agreed");
  });
  test("a labour-only bill has no materials section and no backup page", () => {
    const d = renderBillPdf(bill(labour, []), head, { compress: false });
    expect(d.getNumberOfPages()).toBe(1);
    const t = d.output();
    expect(t).toContain("Labour");
    expect(t).not.toContain("Materials total");
    expect(t).not.toContain("Backup");
  });
  test("with no copies on file, the backup says so", () => {
    expect(renderBillPdf(bill([], [materials[1]!]), head, { compress: false }).output()).toContain("No copies of supplier invoices are filed with this bill.");
  });
  test("a draft is marked on every page", () => {
    const t = renderBillPdf(bill(labour, materials, "draft"), head, { compress: false }).output();
    expect(pages(t).filter((p) => p.includes("DRAFT - NOT ISSUED")).length).toBe(2);
  });
  test("a long bill runs onto more pages instead of off the bottom", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...labour[1]!, id: `x${i}`, description: `Day ${i + 1} install` }));
    const d = renderBillPdf(bill(many, materials), head, { compress: false });
    expect(d.getNumberOfPages()).toBeGreaterThan(2);
    expect(d.output()).toContain("Day 60 install");
  });
});
