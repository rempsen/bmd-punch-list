import { billTotals, type BillKind } from "./calc";

export type BillLine = { description: string; quantity: number; unit: string; unitPriceCents: number; amountCents: number };
export type BillType = "materials" | "progress" | "holdback" | "final";
export const BILL_TYPES: Record<BillType, string> = { materials: "Materials", progress: "Progress", holdback: "Holdback", final: "Final" };
export function shapeBillLine(l: { description: string; amountCents: number; quantity?: number; unit?: string; unitPriceCents?: number }): BillLine {
  return { description: l.description, quantity: l.quantity ?? 1, unit: l.unit ?? "EA", unitPriceCents: l.unitPriceCents ?? l.amountCents, amountCents: l.amountCents };
}
export function lineAmount(l: Pick<BillLine, "quantity" | "unitPriceCents">) { return Math.round(l.quantity * l.unitPriceCents); }
export function setLineAmount(line: BillLine, amountCents: number): BillLine {
  const quantity = line.quantity > 0 ? line.quantity : 1;
  const unitPriceCents = Math.round(amountCents / quantity);
  // If a cents-only unit price cannot express the typed amount, use a one-unit lump sum.
  return quantity * unitPriceCents === amountCents ? { ...line, unitPriceCents, amountCents } : { ...line, quantity: 1, unit: "LS", unitPriceCents: amountCents, amountCents };
}
export function editorTotals(lines: BillLine[], kind: BillKind, holdbackPct: number, gstPct: number) {
  return billTotals(lines.reduce((sum, l) => sum + lineAmount(l), 0), kind === "holdback_release" ? 0 : holdbackPct, gstPct);
}
/** Used by the PDF as well as the editor; legacy invoices retain their original stored totals. */
export function invoiceTotals(b: { lines: { description: string; amountCents: number; quantity?: number; unit?: string; unitPriceCents?: number }[]; kind: BillKind; holdback_pct: number; gst_pct?: number | null; gross_cents: number; holdback_cents: number; net_cents: number; gst_cents: number; total_cents: number }) {
  return b.gst_pct != null ? editorTotals(b.lines.map(shapeBillLine), b.kind, b.holdback_pct, b.gst_pct) : { grossCents: b.gross_cents, holdbackCents: b.holdback_cents, netCents: b.net_cents, gstCents: b.gst_cents, totalCents: b.total_cents };
}
export function validateBill(lines: BillLine[], billDate: string, dueDate: string, holdbackPct: number): string | null {
  if (!billDate || (dueDate && dueDate < billDate)) return "Due date must be on or after bill date.";
  if (!Number.isFinite(holdbackPct) || holdbackPct < 0 || holdbackPct > 50) return "Holdback must be between 0 and 50 percent.";
  if (!lines.length || lines.some(l => !l.description.trim() || !l.unit.trim() || !Number.isFinite(l.quantity) || l.quantity <= 0 || !Number.isFinite(l.unitPriceCents) || l.unitPriceCents <= 0 || lineAmount(l) <= 0)) return "Each line needs a description, unit, quantity and amount above zero.";
  return null;
}
export function requiresOverbillConfirmation(netCents: number, remainingCents: number, kind: BillKind, openBook: boolean) {
  return !openBook && kind !== "holdback_release" && netCents > Math.max(remainingCents, 0);
}
export function progressHelper(contractCents: number, pct: number): BillLine {
  const amountCents = Math.round(contractCents * pct / 100);
  return { description: `Progress — ${pct}% complete this bill`, quantity: 1, unit: "EA", unitPriceCents: amountCents, amountCents };
}
export function mayEditBill(manageProjects: boolean, viewPricing: boolean) { return manageProjects && viewPricing; }