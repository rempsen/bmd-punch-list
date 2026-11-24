/**
 * Open-book jobs (time and materials, cost plus). The client is billed the hours worked at an agreed rate, and each
 * supplier invoice at what it cost plus the job's markup. Holdback and GST then work as on any other bill.
 * The same sums are worked out again in the database (create_open_book_bill); this file is what the screen previews.
 */
import { billTotals, billingPosition, type BillKind, type BillTotals } from "./calc";

export type ContractType = "fixed" | "open_book";
export const CONTRACT_TYPES: { value: ContractType; label: string; hint: string }[] = [
  { value: "fixed", label: "Fixed price", hint: "Billed against an accepted quote." },
  { value: "open_book", label: "Open book", hint: "Time and materials: hours at a rate, and supplier invoices plus a markup." },
];

export type NamedRate = { name: string; rateCents: number };
export type Terms = { markupPct: number | null; labourRateCents: number | null; namedRates: NamedRate[]; holdbackApplies: boolean };
export const NO_TERMS: Terms = { markupPct: null, labourRateCents: null, namedRates: [], holdbackApplies: true };

export type LabourEntry = { id: string; description: string; workDate: string; workDateEnd: string | null; hours: number; rateCents: number; billId: string | null };
export type MaterialEntry = { id: string; supplierName: string; invoiceNumber: string; invoiceDate: string; amountCents: number; /** Set only when this invoice does not follow the job's markup. */ markupPct: number | null; markupNote: string | null; attachmentName: string | null; billId: string | null };

/** Hours × rate in cents. Hours are kept to two decimals, so this is whole-number arithmetic; an exact half cent rounds up. */
export function labourAmountCents(hours: number, rateCents: number): number {
  return Math.floor((Math.round(hours * 100) * rateCents + 50) / 100);
}

/** Markup on a supplier invoice. The percentage is kept to two decimals; an exact half cent rounds up. */
export function markupCents(amountCents: number, pct: number): number {
  return Math.floor((amountCents * Math.round(pct * 100) + 5000) / 10000);
}

export const toCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);

export function parseHours(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 10000 ? n : null;
}

export type LabourInput = { description: string; workDate: string; workDateEnd: string; hours: string; rate: string };
export function checkLabourEntry(i: LabourInput): string | null {
  if (!i.description.trim()) return "Describe the work.";
  if (!i.workDate) return "Enter the date of the work.";
  if (i.workDateEnd && i.workDateEnd < i.workDate) return "The last day cannot be before the first day.";
  if (parseHours(i.hours) == null) return "Enter the hours, for example 7.5.";
  if (!(toCents(i.rate) > 0) || !i.rate.trim()) return "Enter the hourly rate.";
  return null;
}

export type MaterialInput = { supplierName: string; invoiceNumber: string; invoiceDate: string; amount: string; markupPct: string };
export function checkMaterialEntry(i: MaterialInput): string | null {
  if (!i.supplierName.trim()) return "Choose or type the supplier.";
  if (!i.invoiceNumber.trim()) return "Enter the supplier's invoice number.";
  if (!i.invoiceDate) return "Enter the invoice date.";
  if (!i.amount.trim() || !(toCents(i.amount) > 0)) return "Enter the invoice amount before GST.";
  if (i.markupPct.trim() !== "") {
    const p = Number(i.markupPct);
    if (!Number.isFinite(p) || p < 0 || p > 100) return "Markup must be between 0 and 100 percent.";
  }
  return null;
}

export type BillLabourLine = { description: string; dateFrom: string; dateTo: string | null; hours: number; rateCents: number; amountCents: number };
export type BillMaterialLine = { supplier: string; invoiceNumber: string; invoiceDate: string; invoiceCents: number; markupPct: number; markupCents: number; totalCents: number; attachmentName: string | null };
/** What is kept on an open-book bill and printed for the client. Nothing else about an entry travels with the bill. */
export type OpenBookSnapshot = { labour: BillLabourLine[]; materials: BillMaterialLine[]; labourCents: number; materialsCents: number; markupCents: number };
export const SNAPSHOT_FIELDS = {
  bill: ["labour", "materials", "labourCents", "materialsCents", "markupCents"],
  labour: ["description", "dateFrom", "dateTo", "hours", "rateCents", "amountCents"],
  material: ["supplier", "invoiceNumber", "invoiceDate", "invoiceCents", "markupPct", "markupCents", "totalCents", "attachmentName"],
} as const;

/** One invoice as billed, or null when neither the invoice nor the job says what the markup is. */
export function materialLine(m: MaterialEntry, terms: Terms): BillMaterialLine | null {
  const pct = m.markupPct ?? terms.markupPct;
  if (pct == null) return null;
  const mk = markupCents(m.amountCents, pct);
  return { supplier: m.supplierName, invoiceNumber: m.invoiceNumber, invoiceDate: m.invoiceDate, invoiceCents: m.amountCents, markupPct: pct, markupCents: mk, totalCents: m.amountCents + mk, attachmentName: m.attachmentName };
}

const labourLine = (l: LabourEntry): BillLabourLine => ({ description: l.description, dateFrom: l.workDate, dateTo: l.workDateEnd, hours: l.hours, rateCents: l.rateCents, amountCents: labourAmountCents(l.hours, l.rateCents) });

/** The three figures a person types into QuickBooks for this bill. */
export function quickBooksLines(s: Pick<OpenBookSnapshot, "labourCents" | "materialsCents" | "markupCents">): { description: string; amountCents: number }[] {
  return [
    { description: "Labour", amountCents: s.labourCents },
    { description: "Materials", amountCents: s.materialsCents },
    { description: "Markup on materials", amountCents: s.markupCents },
  ].filter((l) => l.amountCents > 0);
}

export type OpenBookBill = { snapshot: OpenBookSnapshot; lines: { description: string; amountCents: number }[]; holdbackPct: number; totals: BillTotals };

/** The draft bill for the ticked entries, or the reason there is none. */
export function buildOpenBookBill(labour: LabourEntry[], materials: MaterialEntry[], terms: Terms, rates: { holdbackPct: number; gstPct: number }): OpenBookBill | { problem: string } {
  if (labour.length + materials.length === 0) return { problem: "Tick the labour and material invoices to put on this bill." };
  const ids = [...labour, ...materials].map((e) => e.id);
  const billedLabour = labour.find((l) => l.billId);
  if (billedLabour) return { problem: `"${billedLabour.description}" is already on a bill.` };
  const billedMaterial = materials.find((m) => m.billId);
  if (billedMaterial) return { problem: `${billedMaterial.supplierName} invoice ${billedMaterial.invoiceNumber} is already on a bill.` };
  if (new Set(ids).size !== ids.length) return { problem: "The same entry was picked twice." };
  const mats: BillMaterialLine[] = [];
  for (const m of materials) {
    const line = materialLine(m, terms);
    if (!line) return { problem: "Set the materials markup for this job before billing materials." };
    mats.push(line);
  }
  const labs = labour.map(labourLine);
  const snapshot: OpenBookSnapshot = {
    labour: labs,
    materials: mats,
    labourCents: labs.reduce((s, l) => s + l.amountCents, 0),
    materialsCents: mats.reduce((s, m) => s + m.invoiceCents, 0),
    markupCents: mats.reduce((s, m) => s + m.markupCents, 0),
  };
  const holdbackPct = terms.holdbackApplies ? rates.holdbackPct : 0;
  return { snapshot, lines: quickBooksLines(snapshot), holdbackPct, totals: billTotals(snapshot.labourCents + snapshot.materialsCents + snapshot.markupCents, holdbackPct, rates.gstPct) };
}

type BillLike = { kind: BillKind; status: "draft" | "issued" | "void"; gross_cents: number; holdback_cents: number };
export type OpenBookPosition = { billedCents: number; unbilledLabourCents: number; unbilledMaterialsCents: number; markupUnknown: boolean; heldCents: number; releasedCents: number; holdbackOwingCents: number };

/** Billed to date and what is still waiting to be billed. Holdback is counted exactly as on a fixed-price job. */
export function openBookPosition(bills: BillLike[], labour: LabourEntry[], materials: MaterialEntry[], terms: Terms): OpenBookPosition {
  const pos = billingPosition(0, bills);
  const open = materials.filter((m) => !m.billId);
  const lines = open.map((m) => materialLine(m, terms));
  return {
    billedCents: pos.billedCents,
    unbilledLabourCents: labour.filter((l) => !l.billId).reduce((s, l) => s + labourAmountCents(l.hours, l.rateCents), 0),
    // An invoice whose markup is not known yet is counted at its invoice amount, and the screen says the markup is missing.
    unbilledMaterialsCents: open.reduce((s, m, i) => s + (lines[i]?.totalCents ?? m.amountCents), 0),
    markupUnknown: lines.some((l) => l == null),
    heldCents: pos.heldCents,
    releasedCents: pos.releasedCents,
    holdbackOwingCents: pos.holdbackOwingCents,
  };
}

/** Why this job's contract type can no longer be changed, or null when it still can. */
export function contractTypeLock(bills: { status: string }[]): string | null {
  if (bills.some((b) => b.status !== "draft")) return "This job has issued bills, so its contract type can no longer be changed.";
  if (bills.length > 0) return "Delete the draft bills on this job before changing its contract type.";
  return null;
}
