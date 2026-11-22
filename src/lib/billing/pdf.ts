import { jsPDF } from "jspdf";
import { BMD, money } from "@/lib/quotes/logic";
import type { BillKind } from "./calc";

export type BillForPdf = { number: string; kind: BillKind; period_note: string | null; lines: { description: string; amountCents: number }[]; gross_cents: number; holdback_pct: number; holdback_cents: number; net_cents: number; gst_cents: number; total_cents: number; issued_at: string | null };
type Head = { project: { name: string; number: string | null; address: string | null }; client: { name: string; address: string | null }; gstPct: number; position: { contractCents: number; billedCents: number } };

/** The invoice for one progress bill or holdback release. */
export function renderBillPdf(bill: BillForPdf, head: Head, opts: { compress?: boolean; logoDataUrl?: string | null } = {}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: opts.compress ?? true });
  const M = 48;
  const W = 612;
  let y = M;
  const text = (s: string, x: number, o: { size?: number; bold?: boolean; right?: boolean; colour?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 10);
    doc.setTextColor(o.colour ?? 20);
    doc.text(s, x, y, { align: o.right ? "right" : "left" });
  };
  const row = (label: string, amount: string, o: { bold?: boolean; size?: number } = {}) => {
    text(label, M, o);
    text(amount, W - M, { ...o, right: true });
    y += (o.size ?? 10) + 6;
  };
  const rule = () => {
    doc.setDrawColor(210);
    doc.line(M, y, W - M, y);
    y += 12;
  };

  if (opts.logoDataUrl) {
    try {
      doc.addImage(opts.logoDataUrl, "PNG", M, y - 6, 110, 40);
    } catch {
      /* the invoice still stands without the logo */
    }
  } else text(BMD.name, M, { size: 18, bold: true });
  text(bill.kind === "holdback_release" ? "HOLDBACK RELEASE" : "INVOICE", W - M, { size: 16, bold: true, right: true });
  y += 18;
  text(bill.number, W - M, { bold: true, right: true });
  y += 13;
  text(new Date(bill.issued_at ?? Date.now()).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Winnipeg" }), W - M, { right: true, colour: 90 });
  y += 22;
  text(BMD.mailing, M, { size: 9, colour: 90 });
  y += 12;
  text(BMD.email, M, { size: 9, colour: 90 });
  y += 16;
  rule();
  text("Bill to", M, { size: 8, colour: 110 });
  text("Project", W / 2 + 10, { size: 8, colour: 110 });
  y += 12;
  text(head.client.name, M, { bold: true });
  text(`${head.project.number ? `${head.project.number} · ` : ""}${head.project.name}`, W / 2 + 10, { bold: true });
  y += 13;
  if (head.client.address) text(head.client.address, M, { size: 9, colour: 70 });
  if (head.project.address) text(head.project.address, W / 2 + 10, { size: 9, colour: 70 });
  y += 18;
  if (bill.period_note) {
    text(bill.period_note, M, { size: 9, colour: 70 });
    y += 14;
  }
  rule();
  for (const l of bill.lines) row(l.description, `$${money(l.amountCents)}`);
  y += 4;
  rule();
  if (bill.kind === "progress") {
    row("This bill", `$${money(bill.gross_cents)}`, { bold: true });
    if (bill.holdback_cents > 0) row(`Less ${bill.holdback_pct}% holdback`, `($${money(bill.holdback_cents)})`);
  }
  row("Subtotal", `$${money(bill.net_cents)}`, { bold: true });
  row(`GST ${head.gstPct}%`, `$${money(bill.gst_cents)}`);
  row("Amount due", `$${money(bill.total_cents)}`, { bold: true, size: 13 });
  y += 10;
  rule();
  text("Contract to date", M, { size: 9, colour: 70 });
  text(`$${money(head.position.contractCents)}`, W - M, { size: 9, colour: 70, right: true });
  y += 13;
  text("Billed to date, including this bill (before holdback and GST)", M, { size: 9, colour: 70 });
  text(`$${money(head.position.billedCents)}`, W - M, { size: 9, colour: 70, right: true });
  y += 24;
  text("Overdue accounts are charged interest at 2% per month.", M, { size: 9, colour: 70 });
  return doc;
}
