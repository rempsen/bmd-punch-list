import { jsPDF } from "jspdf";
import { companyLines, DEFAULT_COMPANY, fitLogo, isHeadingLine, type Logo } from "./branding";
import { displayFor, layoutVersion, money, snapshotTotals, type QuoteSnapshot, type SnapVersion } from "./logic";

const M = 48; // page margin, points
const W = 612;
const H = 792;

/**
 * The branded quotation. It reads only the client-safe snapshot, so nothing internal can reach the page.
 * One price: scope and price as chosen (lump sum, by section, itemised). Several prices: one side-by-side options table.
 */
export type AcceptanceRecord = { name: string; email: string; at: string; versionId: string; choices: Record<string, string>; totalCents: number };

export function renderQuotePdf(snap: QuoteSnapshot, opts: { compress?: boolean; logo?: Logo | null; acceptance?: AcceptanceRecord; drawings?: { dataUrl: string; width: number; height: number; title: string }[] } = {}): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: opts.compress ?? true });
  let y = M;
  // Quotes sent before company details were saved with them fall back to the defaults.
  const company = snap.company ?? DEFAULT_COMPANY;

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

  // Header: logo (or the company name) on the left with the addresses under it, the document title on the right.
  const headTop = y;
  let logoHeight = 22;
  let drawn = false;
  if (opts.logo) {
    const size = fitLogo(opts.logo.width, opts.logo.height, 170, 54);
    try {
      doc.addImage(opts.logo.dataUrl, opts.logo.dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG", M, y - 8, size.width, size.height);
      logoHeight = size.height;
      drawn = true;
    } catch {
      /* a logo that cannot be drawn must not stop the quote */
    }
  }
  if (!drawn) text(company.name, M, { size: 18, bold: true, maxWidth: 300 });
  text(snap.presentation && snap.number.startsWith("CO-") ? "CHANGE ORDER" : "QUOTATION", W - M, { size: 16, bold: true, align: "right" });
  y += 18;
  text(snap.number, W - M, { align: "right", bold: true });
  y += 13;
  text(new Date(`${snap.date}T12:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }), W - M, { align: "right", colour: 90 });
  y = Math.max(y + 22, headTop + logoHeight + 6);
  for (const line of companyLines(company)) y += text(line, M, { size: 9, colour: 90, maxWidth: W - 2 * M });
  y += 4;
  rule();

  // Client and project
  const top = y;
  text("Prepared for", M, { size: 8, colour: 110 });
  y += 12;
  text(snap.client.name, M, { bold: true });
  y += 13;
  if (snap.client.address) y += text(snap.client.address, M, { size: 9, colour: 70, maxWidth: 240 });
  if (snap.attention) y += text(`Attention: ${snap.attention}`, M, { size: 9, colour: 70, maxWidth: 240 });
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
  // On an acceptance record the figures are those for what the client chose.
  const acc0 = opts.acceptance;
  const figures = (v: SnapVersion) => (acc0 && acc0.versionId === v.id ? snapshotTotals(v, acc0.choices as never, { gstPct: snap.gstPct, hstPct: snap.hstPct }) : v);
  const priceBlock = (v0: SnapVersion) => {
    const v = figures(v0);
    row("Subtotal", `$${money(v.subtotalCents)}`, { bold: true });
    for (const [code, cents] of Object.entries(v.taxByCode)) {
      if (cents > 0) row(`${code} ${code === "GST" ? snap.gstPct : snap.hstPct}%`, `$${money(cents)}`);
    }
    row("Total", `$${money(v.totalCents)}`, { bold: true, size: 12 });
  };
  const scope = (v: SnapVersion) => {
    for (const g of layoutVersion(v, snap.display ?? displayFor(snap.presentation))) {
      if (g.lines.length === 0 && g.subtotalCents == null) continue;
      need(30);
      row(`${g.name}${g.quantity ? `  (${g.quantity})` : ""}`, g.subtotalCents != null ? `$${money(g.subtotalCents)}` : "", { bold: true });
      for (const l of g.lines) {
        row(`${l.text}${l.note ? `  (${l.note})` : ""}`, l.amountCents != null ? `$${money(l.amountCents)}` : "", { indent: 12, size: 9 });
        if (l.areas) row(l.areas, "", { indent: 24, size: 8 });
      }
      y += 4;
    }
  };

  if (!many) {
    const v = snap.versions[0]!;
    heading("Scope of work");
    scope(v);
    rule();
    priceBlock(v);
  } else {
    heading("Options");
    para("Each option below is a complete price for the work. Please choose one.", { size: 9, colour: 70 });
    y += 4;
    for (const v of snap.versions) {
      need(40);
      const f = figures(v);
      row(v.name, `$${money(f.totalCents)}`, { bold: true, size: 11 });
      if (v.description) para(v.description, { size: 9, colour: 70 });
      row("Subtotal", `$${money(f.subtotalCents)}`, { indent: 12, size: 9 });
      row("Tax", `$${money(f.taxCents)}`, { indent: 12, size: 9 });
      y += 6;
    }
    for (const v of snap.versions) {
      heading(`${v.name}: scope of work`);
      scope(v);
    }
  }

  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    heading(title);
    for (const item of items) para(`•  ${item}`, { size: 9 });
  };
  if (snap.remarks) {
    heading("Notes");
    for (const line of snap.remarks.split("\n")) {
      if (line.trim()) para(line.trim(), { size: 9 });
      else y += 5;
    }
  }
  list("Inclusions", snap.inclusions);
  list("Exclusions", snap.exclusions);
  list("Clarifications", snap.clarifications);
  if ((snap.drawings ?? []).length > 0) {
    need(30);
    y += 6;
    para(`Colour-coded drawings attached: ${snap.drawings.join(", ")}`, { size: 9 });
  }
  list("Terms", snap.terms);

  // Acceptance
  need(110);
  heading("Acceptance");
  const acc = opts.acceptance;
  if (acc) {
    const v = snap.versions.find((x) => x.id === acc.versionId);
    para(`Accepted electronically by ${acc.name} (${acc.email}) on ${new Date(acc.at).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Winnipeg" })}.`, { bold: true });
    para(`${many && v ? `Option accepted: ${v.name}. ` : ""}Total accepted, including GST: $${money(acc.totalCents)}.`);
    for (const l of (v?.sections ?? []).flatMap((s) => s.lines)) {
      const c = acc.choices[l.id];
      if (l.selection !== "required" && c) para(`${l.description}: ${c === "yes" ? "Yes" : c === "no" ? "No" : "Maybe"}`, { size: 9 });
    }
  } else {
    para(`${many ? "Accepted option: ______________________________   " : ""}The above price, scope and ${snap.conditions ? `terms, and the attached ${snap.conditions.title},` : "terms"} are accepted.`, { size: 9 });
    y += 26;
    doc.setDrawColor(120);
    doc.line(M, y, M + 220, y);
    doc.line(W / 2 + 10, y, W - M, y);
    y += 12;
    text("Signature", M, { size: 8, colour: 110 });
    text("Name and date", W / 2 + 10, { size: 8, colour: 110 });
  }

  // The standard terms and conditions start on a fresh page straight after the quote.
  if (snap.conditions) {
    doc.addPage();
    y = M;
    text(snap.conditions.title, M, { size: 13, bold: true, maxWidth: W - 2 * M });
    y += 18;
    text(`${snap.number} · ${snap.client.name}`, M, { size: 8, colour: 110 });
    y += 16;
    for (const line of snap.conditions.text.split("\n")) {
      if (!line.trim()) y += 5;
      else if (isHeadingLine(line)) {
        need(24);
        y += 3;
        para(line.trim(), { size: 8.5, bold: true });
      } else para(line.trim(), { size: 8.5 });
    }
  }

  const textPages = doc.getNumberOfPages();
  // Each colour-coded drawing on its own page, turned to suit the sheet and fitted inside the margins.
  for (const d of opts.drawings ?? []) {
    const wide = d.width >= d.height;
    doc.addPage("letter", wide ? "landscape" : "portrait");
    const pw = wide ? H : W;
    const ph = wide ? W : H;
    const k = Math.min((pw - 2 * 30) / d.width, (ph - 30 - 50) / d.height);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(20);
    doc.text(d.title, 30, 28);
    try {
      doc.addImage(d.dataUrl, "JPEG", (pw - d.width * k) / 2, 38, d.width * k, d.height * k);
    } catch {
      doc.text("This drawing could not be added.", 30, 60);
    }
  }
  const pages = textPages;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130);
    const footer = snap.footer ? (doc.splitTextToSize(snap.footer.replace(/\s*\n\s*/g, " · "), W - 2 * M) as string[]).slice(0, 2) : [];
    for (const [n, line] of footer.entries()) doc.text(line, W / 2, H - 48 + n * 10, { align: "center" });
    doc.text(`${snap.number} · ${company.name}`, M, H - 24);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: "right" });
  }
  return doc;
}
