import { jsPDF } from "jspdf";
import { BMD, money, type QuoteSnapshot, type SnapVersion } from "./logic";

const M = 48; // page margin, points
const W = 612;
const H = 792;

/**
 * The branded quotation. It reads only the client-safe snapshot, so nothing internal can reach the page.
 * One price: scope and price as chosen (lump sum, by section, itemised). Several prices: one side-by-side options table.
 */
export function renderQuotePdf(snap: QuoteSnapshot, opts: { compress?: boolean; logoDataUrl?: string | null } = {}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: opts.compress ?? true });
  let y = M;

  const need = (h: number) => {
    if (y + h > H - M - 20) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, x: number, o: { size?: number; bold?: boolean; align?: "left" | "right"; colour?: number; maxWidth?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 10);
    doc.setTextColor(o.colour ?? 20);
    const lines = o.maxWidth ? (doc.splitTextToSize(s, o.maxWidth) as string[]) : [s];
    for (const [i, line] of lines.entries()) doc.text(line, x, y + i * ((o.size ?? 10) + 3), { align: o.align ?? "left" });
    return lines.length * ((o.size ?? 10) + 3);
  };
  const para = (s: string, o: Parameters<typeof text>[2] = {}) => {
    const width = W - 2 * M;
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 10);
    const lines = doc.splitTextToSize(s, width) as string[];
    for (const line of lines) {
      need((o.size ?? 10) + 3);
      text(line, M, o);
      y += (o.size ?? 10) + 3;
    }
  };
  const rule = () => {
    doc.setDrawColor(210);
    doc.line(M, y, W - M, y);
    y += 10;
  };
  const heading = (s: string) => {
    need(34);
    y += 8;
    text(s, M, { size: 12, bold: true });
    y += 18;
  };
  const row = (left: string, right: string, o: { bold?: boolean; indent?: number; size?: number } = {}) => {
    const size = o.size ?? 10;
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(left, W - 2 * M - 110 - (o.indent ?? 0)) as string[];
    need(lines.length * (size + 3) + 2);
    text(right, W - M, { align: "right", bold: !!o.bold, size });
    for (const line of lines) {
      text(line, M + (o.indent ?? 0), { bold: !!o.bold, size });
      y += size + 3;
    }
    y += 2;
  };

  // Header
  if (opts.logoDataUrl) {
    try {
      doc.addImage(opts.logoDataUrl, "PNG", M, y - 6, 110, 40);
    } catch {
      /* a logo that cannot be drawn must not stop the quote */
    }
  } else text(BMD.name, M, { size: 18, bold: true });
  text(snap.presentation && snap.number.startsWith("CO-") ? "CHANGE ORDER" : "QUOTATION", W - M, { size: 16, bold: true, align: "right" });
  y += 18;
  text(snap.number, W - M, { align: "right", bold: true });
  y += 13;
  text(new Date(`${snap.date}T12:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }), W - M, { align: "right", colour: 90 });
  y += 22;
  text(BMD.mailing, M, { size: 9, colour: 90 });
  y += 12;
  text(BMD.email, M, { size: 9, colour: 90 });
  y += 16;
  rule();

  // Client and project
  const top = y;
  text("Prepared for", M, { size: 8, colour: 110 });
  y += 12;
  text(snap.client.name, M, { bold: true });
  y += 13;
  if (snap.client.address) y += text(snap.client.address, M, { size: 9, colour: 70, maxWidth: 240 });
  const leftEnd = y;
  y = top;
  text("Project", W / 2 + 10, { size: 8, colour: 110 });
  y += 12;
  text(`${snap.project.number ? `${snap.project.number} · ` : ""}${snap.project.name}`, W / 2 + 10, { bold: true, maxWidth: 250 });
  y += 13;
  if (snap.project.address) y += text(snap.project.address, W / 2 + 10, { size: 9, colour: 70, maxWidth: 250 });
  y = Math.max(leftEnd, y) + 6;
  text(`Prepared by ${snap.preparedBy.name}`, M, { size: 9, colour: 70 });
  y += 14;
  rule();

  const many = snap.versions.length > 1;
  const priceBlock = (v: SnapVersion) => {
    row("Subtotal", `$${money(v.subtotalCents)}`, { bold: true });
    for (const [code, cents] of Object.entries(v.taxByCode)) {
      if (cents > 0) row(`${code} ${code === "GST" ? snap.gstPct : snap.hstPct}%`, `$${money(cents)}`);
    }
    row("Total", `$${money(v.totalCents)}`, { bold: true, size: 12 });
  };
  const scope = (v: SnapVersion, showPrices: boolean) => {
    for (const s of v.sections) {
      need(30);
      row(s.name, showPrices && snap.presentation !== "lump_sum" ? `$${money(s.subtotalCents)}` : "", { bold: true });
      for (const l of s.lines) {
        const qty = `${l.qty.toLocaleString("en-CA")} ${l.uom}`;
        const flags = [l.selection === "optional" ? "optional, not in the total" : null, l.selection === "choose_one" ? `choose one${l.group ? ` (${l.group})` : ""}` : null, l.allowance ? "allowance" : null, l.subjectToMeasure ? "subject to final measure" : null].filter(Boolean).join("; ");
        const label = `${l.description}${l.uom === "LS" ? "" : `  —  ${qty}`}${flags ? `  (${flags})` : ""}`;
        const itemised = showPrices && snap.presentation === "itemised";
        row(itemised && l.uom !== "LS" ? `${label}  @ $${money(l.unitPriceCents)}` : label, itemised || (showPrices && l.selection !== "required") ? `$${money(l.sellCents)}` : "", { indent: 12, size: 9 });
      }
      y += 4;
    }
  };

  if (!many) {
    const v = snap.versions[0]!;
    heading("Scope of work");
    scope(v, true);
    rule();
    priceBlock(v);
  } else {
    heading("Options");
    para("Each option below is a complete price for the work. Please choose one.", { size: 9, colour: 70 });
    y += 4;
    for (const v of snap.versions) {
      need(40);
      row(v.name, `$${money(v.totalCents)}`, { bold: true, size: 11 });
      if (v.description) para(v.description, { size: 9, colour: 70 });
      row("Subtotal", `$${money(v.subtotalCents)}`, { indent: 12, size: 9 });
      row("Tax", `$${money(v.taxCents)}`, { indent: 12, size: 9 });
      y += 6;
    }
    for (const v of snap.versions) {
      heading(`${v.name}: scope of work`);
      scope(v, true);
    }
  }

  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    heading(title);
    for (const item of items) para(`•  ${item}`, { size: 9 });
  };
  list("Inclusions", snap.inclusions);
  list("Exclusions", snap.exclusions);
  list("Clarifications", snap.clarifications);
  list("Terms", snap.terms);

  // Acceptance
  need(110);
  heading("Acceptance");
  para(many ? "Accepted option: ______________________________" : "The above price, scope and terms are accepted.", { size: 9 });
  y += 26;
  doc.setDrawColor(120);
  doc.line(M, y, M + 220, y);
  doc.line(W / 2 + 10, y, W - M, y);
  y += 12;
  text("Signature", M, { size: 8, colour: 110 });
  text("Name and date", W / 2 + 10, { size: 8, colour: 110 });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`${snap.number} · ${BMD.name}`, M, H - 28);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 28, { align: "right" });
  }
  return doc;
}
