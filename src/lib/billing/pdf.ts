import { jsPDF } from "jspdf";
import { BMD, money } from "@/lib/quotes/logic";
import type { BillKind } from "./calc";
import type { OpenBookSnapshot } from "./openBook";
import { invoiceTotals, type BillType } from "./editor";

export type BillForPdf = { number: string; kind: BillKind; period_note: string | null; lines: { description: string; amountCents: number; quantity?: number; unit?: string; unitPriceCents?: number }[]; gross_cents: number; holdback_pct: number; holdback_cents: number; net_cents: number; gst_cents: number; total_cents: number; issued_at: string | null; status?: "draft" | "issued" | "void"; bill_date?: string | null; due_date?: string | null; terms?: string | null; client_notes?: string | null; internal_notes?: string | null; bill_type?: BillType; gst_pct?: number | null; /** Set on a bill for an open-book job: its labour lines and supplier invoices. */ open_book?: OpenBookSnapshot | null };
type Head = { project: { name: string; number: string | null; address: string | null }; client: { name: string; address: string | null }; gstPct: number; position: { contractCents: number; billedCents: number } };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-02" as "Nov 2, 2026"; a range within one year as "Nov 2 to Nov 6, 2026". */
export function billDate(from: string, to?: string | null): string {
  const part = (d: string, year: boolean) => `${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""} ${Number(d.slice(8, 10))}${year ? `, ${d.slice(0, 4)}` : ""}`;
  return to && to !== from ? `${part(from, from.slice(0, 4) !== to.slice(0, 4))} to ${part(to, true)}` : part(from, true);
}
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/** The invoice for one progress bill or holdback release. An open-book bill lists its labour and supplier invoices, with a backup page. */
export function renderBillPdf(bill: BillForPdf, head: Head, opts: { compress?: boolean; logoDataUrl?: string | null } = {}): jsPDF {
  const totals = invoiceTotals(bill);
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

  const watermark = () => {
    if (bill.status !== "draft" && bill.status !== "void") return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(54);
    doc.setTextColor(225);
    doc.text(bill.status === "draft" ? "DRAFT - NOT ISSUED" : "VOID", 306, 420, { align: "center", angle: 30 });
  };
  const newPage = () => {
    doc.addPage();
    y = M;
    watermark();
  };
  /** Starts a new page when the next block would run off the bottom. */
  const room = (h: number) => {
    if (y + h > 744) newPage();
  };
  watermark();
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
  text(bill.bill_date ? billDate(bill.bill_date) : new Date(bill.issued_at ?? Date.now()).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Winnipeg" }), W - M, { right: true, colour: 90 });
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
  const ob = bill.kind === "progress" ? (bill.open_book ?? null) : null;
  if (bill.due_date || bill.terms) { text([bill.due_date ? `Due ${billDate(bill.due_date)}` : "", bill.terms ?? ""].filter(Boolean).join(" · "), M, { size: 9 }); y += 18; }
  if (ob && bill.gst_pct == null) {
    const detail = (s: string) => {
      text(s, M + 10, { size: 8, colour: 100 });
      y += 13;
    };
    if (ob.labour.length > 0) {
      row("Labour", "", { bold: true });
      for (const l of ob.labour) {
        room(34);
        row(doc.splitTextToSize(l.description, 400)[0] as string, `$${money(l.amountCents)}`);
        y -= 3;
        detail(`${billDate(l.dateFrom, l.dateTo)} · ${l.hours} h × $${money(l.rateCents)} an hour`);
      }
      y += 3;
      room(20);
      row("Labour total", `$${money(ob.labourCents)}`, { bold: true });
      y += 6;
    }
    if (ob.materials.length > 0) {
      room(60);
      row("Materials", "", { bold: true });
      for (const m of ob.materials) {
        room(34);
        row(`${m.supplier} · invoice ${m.invoiceNumber} · ${billDate(m.invoiceDate)}`, `$${money(m.totalCents)}`);
        y -= 3;
        detail(`Supplier invoice $${money(m.invoiceCents)} + ${pct(m.markupPct)} markup $${money(m.markupCents)}`);
      }
      y += 3;
      room(20);
      row("Materials total, with markup", `$${money(ob.materialsCents + ob.markupCents)}`, { bold: true });
    }
    room(150);
  } else for (const l of bill.lines) { room(36); for (const part of doc.splitTextToSize(l.description, 400) as string[]) { room(20); row(part, part === (doc.splitTextToSize(l.description, 400) as string[])[0] ? `$${money(l.amountCents)}` : ""); } }
  y += 4;
  rule();
  if (bill.kind === "progress") {
    row("This bill", `$${money(totals.grossCents)}`, { bold: true });
    if (totals.holdbackCents > 0) row(`Less ${bill.holdback_pct}% holdback`, `($${money(totals.holdbackCents)})`);
  }
  row("Subtotal", `$${money(totals.netCents)}`, { bold: true });
  row(`GST ${bill.gst_pct ?? head.gstPct}%`, `$${money(totals.gstCents)}`);
  row("Amount due", `$${money(totals.totalCents)}`, { bold: true, size: 13 });
  if (bill.client_notes) { for (const part of doc.splitTextToSize(bill.client_notes, 510) as string[]) { room(18); y += 14; text(part, M, { size: 9 }); } }
  y += 10;
  rule();
  if (ob) text("Open-book job: labour at the agreed rates, materials at supplier invoice plus markup.", M, { size: 9, colour: 70 });
  else {
    text("Contract to date", M, { size: 9, colour: 70 });
    text(`$${money(head.position.contractCents)}`, W - M, { size: 9, colour: 70, right: true });
  }
  y += 13;
  text("Billed to date, including this bill (before holdback and GST)", M, { size: 9, colour: 70 });
  text(`$${money(head.position.billedCents)}`, W - M, { size: 9, colour: 70, right: true });
  y += 24;
  text("Overdue accounts are charged interest at 2% per month.", M, { size: 9, colour: 70 });
  if (ob && ob.materials.length > 0) {
    // Backup: the supplier invoices behind the materials on this bill. Open book means the client sees these amounts.
    newPage();
    text("Backup", M, { size: 16, bold: true });
    text(bill.number, W - M, { bold: true, right: true });
    y += 16;
    text(`Supplier invoices billed on this invoice · ${head.project.number ? `${head.project.number} · ` : ""}${head.project.name}`, M, { size: 9, colour: 90 });
    y += 16;
    rule();
    const cols = [M, 190, 290, 400, 440, 500, W - M]; // three left edges, then four right edges
    const cells = (c: string[], o: { bold?: boolean; size?: number; colour?: number } = {}) => {
      text(doc.splitTextToSize(c[0]!, 136)[0] as string, cols[0]!, o);
      text(doc.splitTextToSize(c[1]!, 94)[0] as string, cols[1]!, o);
      text(c[2]!, cols[2]!, o);
      for (let i = 3; i < 7; i++) text(c[i]!, cols[i]!, { ...o, right: true });
      y += 15;
    };
    cells(["Supplier", "Invoice", "Date", "Amount", "Markup", "Markup $", "Total"], { size: 8, colour: 110 });
    for (const m of ob.materials) {
      room(18);
      cells([m.supplier, m.invoiceNumber, billDate(m.invoiceDate), `$${money(m.invoiceCents)}`, pct(m.markupPct), `$${money(m.markupCents)}`, `$${money(m.totalCents)}`], { size: 9 });
    }
    rule();
    cells(["Total", "", "", `$${money(ob.materialsCents)}`, "", `$${money(ob.markupCents)}`, `$${money(ob.materialsCents + ob.markupCents)}`], { size: 9, bold: true });
    y += 14;
    room(40);
    text("Copies of supplier invoices", M, { bold: true });
    y += 15;
    const copies = ob.materials.filter((m) => m.attachmentName);
    if (copies.length === 0) text("No copies of supplier invoices are filed with this bill.", M, { size: 9, colour: 70 });
    for (const m of copies) {
      room(16);
      text(`${m.supplier} ${m.invoiceNumber}: ${m.attachmentName}`, M, { size: 9, colour: 40 });
      y += 13;
    }
  }
  return doc;
}
