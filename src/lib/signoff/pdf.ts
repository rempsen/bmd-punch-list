import { jsPDF } from "jspdf";
import { BMD } from "@/lib/quotes/logic";
import { KIND_LABEL, METHOD_LABEL, OUTCOME_LABEL, type InspectionKind, type Outcome, type SignMethod } from "./logic";

export type SignoffPdfInput = {
  job: { name: string; number: string | null; address: string | null };
  client: string | null;
  inspection: { kind: InspectionKind; held_at: string | null; attendees: string | null; outcome: Outcome; ok: number; deficient: number; notInspected: number; notes: string | null } | null;
  signoff: { name: string; email: string | null; signed_at: string | null; method: SignMethod; signature: string | null; notes: string | null };
  logoDataUrl?: string | null;
};

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : "—");

/** One-page sign-off certificate. */
export function renderSignoffPdf(p: SignoffPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48;
  let y = M;
  const t = (s: string, o: { size?: number; bold?: boolean; colour?: number; x?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 10);
    doc.setTextColor(o.colour ?? 20);
    const lines = doc.splitTextToSize(s, 612 - M * 2 - (o.x ?? 0));
    doc.text(lines, M + (o.x ?? 0), y);
    y += (o.size ?? 10) * 1.35 * lines.length;
  };
  if (p.logoDataUrl) {
    try { doc.addImage(p.logoDataUrl, "PNG", M, y - 6, 110, 40); y += 44; } catch { t(BMD.name, { size: 18, bold: true }); }
  } else t(BMD.name, { size: 18, bold: true });
  y += 10;
  t("Installation sign-off", { size: 20, bold: true });
  y += 6;
  t(`${p.job.number ? `${p.job.number} · ` : ""}${p.job.name}`, { size: 12, bold: true });
  if (p.job.address) t(p.job.address, { colour: 90 });
  if (p.client) t(`Client: ${p.client}`, { colour: 90 });
  y += 12;
  doc.setDrawColor(210); doc.line(M, y, 612 - M, y); y += 20;
  t("Inspection", { size: 12, bold: true });
  if (p.inspection) {
    t(`${KIND_LABEL[p.inspection.kind]} held ${d(p.inspection.held_at)}`);
    t(`Outcome: ${OUTCOME_LABEL[p.inspection.outcome]}`, { bold: true });
    t(`Checklist: ${p.inspection.ok} OK · ${p.inspection.deficient} deficient (recorded as deficiencies) · ${p.inspection.notInspected} not inspected`);
    if (p.inspection.attendees) t(`Attendees: ${p.inspection.attendees}`);
    if (p.inspection.notes) t(`Notes: ${p.inspection.notes}`);
  } else t("No inspection linked.");
  y += 16;
  t("Sign-off", { size: 12, bold: true });
  t(`The client confirms the installation is complete and accepted${p.inspection?.outcome === "passed_with_items" ? ", subject to the recorded deficiencies being fixed" : ""}.`);
  y += 8;
  if (p.signoff.signature) {
    try { doc.addImage(p.signoff.signature, "PNG", M, y, 220, 70); y += 78; } catch { /* signature image unreadable */ }
  }
  doc.line(M, y, M + 260, y); y += 14;
  t(`${p.signoff.name}${p.signoff.email ? ` · ${p.signoff.email}` : ""}`, { bold: true });
  t(`${METHOD_LABEL[p.signoff.method]} · ${d(p.signoff.signed_at)}`, { colour: 90 });
  if (p.signoff.notes) t(`Notes: ${p.signoff.notes}`);
  y = 760;
  t(`${BMD.name} · ${BMD.email}`, { size: 8, colour: 120 });
  return doc;
}
