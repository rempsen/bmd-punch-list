/**
 * A BMD bill as a QuickBooks Online invoice, the way BMD's own invoices are set up: the work on the flooring item, the
 * holdback as a minus line on the Holdback item, GST on every line and added on top. Created unsent: QuickBooks has no
 * draft status, so "draft" means it is in QuickBooks and nobody has emailed it. Pure, so it runs under test.
 *
 * Also: what to change on a QuickBooks customer so it matches the BMD client. Dan (26 Nov): when they differ, the client
 * record wins, as it is the most up to date. A blank on the client never wipes QuickBooks.
 */
import { money } from "@/lib/quotes/logic";

export type BillLineForQbo = { description: string; amountCents: number; quantity?: number; unitPriceCents?: number };
export type BillForQbo = {
  id: string;
  number: string;
  kind: "progress" | "holdback_release";
  status: "draft" | "issued" | "void";
  lines: BillLineForQbo[];
  gross_cents: number;
  holdback_cents: number;
  net_cents: number;
  gst_cents: number;
  total_cents: number;
  bill_date: string | null;
  due_date: string | null;
  client_notes: string | null;
  period_note: string | null;
  qbo_invoice_id: string | null;
};
export type InvoiceRefs = { lineItemId: string; holdbackItemId: string; gstCodeId: string };
export type InvoiceExpected = { subtotalCents: number; taxCents: number; totalCents: number };
export type InvoicePlan = { ok: true; body: Record<string, unknown>; expected: InvoiceExpected; summary: string[] } | { ok: false; message: string };

const dollars = (cents: number) => Math.round(cents) / 100;

export function buildQboInvoice(a: { bill: BillForQbo; customerId: string | null; refs: InvoiceRefs }): InvoicePlan {
  const b = a.bill;
  if (b.qbo_invoice_id) return { ok: false, message: `${b.number} is already in QuickBooks (invoice id ${b.qbo_invoice_id}).` };
  if (b.status === "void") return { ok: false, message: `${b.number} is void.` };
  if (b.status !== "issued") return { ok: false, message: `Issue ${b.number} first: a draft can still change, and QuickBooks would not follow.` };
  if (!a.customerId) return { ok: false, message: "This job's client is not linked to a QuickBooks customer." };
  if (!b.lines.length) return { ok: false, message: `${b.number} has no lines.` };
  const sum = b.lines.reduce((s, l) => s + l.amountCents, 0);
  if (sum !== b.gross_cents) return { ok: false, message: `The lines of ${b.number} add up to $${money(sum)}, not $${money(b.gross_cents)}. Nothing was created.` };
  if (b.gross_cents - b.holdback_cents !== b.net_cents) return { ok: false, message: `${b.number}: amount less holdback does not equal the amount due. Nothing was created.` };
  if (b.gst_cents <= 0) return { ok: false, message: `${b.number} carries no GST. Enter it in QuickBooks by hand so the right tax code is chosen.` };

  const tax = { TaxCodeRef: { value: a.refs.gstCodeId } };
  const itemFor = b.kind === "holdback_release" ? a.refs.holdbackItemId : a.refs.lineItemId;
  const line = (description: string, cents: number, itemId: string, qty?: number, unitCents?: number) => {
    const exact = qty != null && unitCents != null && Math.round(qty * unitCents) === cents;
    return {
      DetailType: "SalesItemLineDetail",
      Description: description.slice(0, 4000),
      Amount: dollars(cents),
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: exact ? qty : 1, UnitPrice: exact ? dollars(unitCents!) : dollars(cents), ...tax, ...(b.bill_date ? { ServiceDate: b.bill_date } : {}) },
    };
  };
  const lines = b.lines.map((l) => line(l.description, l.amountCents, itemFor, l.quantity, l.unitPriceCents));
  if (b.kind === "progress" && b.holdback_cents > 0) lines.push(line("Holdback", -b.holdback_cents, a.refs.holdbackItemId));

  const memo = (b.client_notes ?? b.period_note ?? "").trim();
  const body: Record<string, unknown> = {
    CustomerRef: { value: a.customerId },
    Line: lines,
    GlobalTaxCalculation: "TaxExcluded",
    EmailStatus: "NotSet",
    PrivateNote: `From BMD Projects bill ${b.number}. Created unsent; check and send from QuickBooks.`,
    ...(b.bill_date ? { TxnDate: b.bill_date } : {}),
    ...(b.due_date ? { DueDate: b.due_date } : {}),
    ...(memo ? { CustomerMemo: { value: memo.slice(0, 1000) } } : {}),
  };
  return {
    ok: true,
    body,
    expected: { subtotalCents: b.net_cents, taxCents: b.gst_cents, totalCents: b.total_cents },
    summary: [
      ...b.lines.map((l) => `${l.description}: $${money(l.amountCents)}`),
      ...(b.kind === "progress" && b.holdback_cents > 0 ? [`Holdback: −$${money(b.holdback_cents)}`] : []),
      `GST: $${money(b.gst_cents)}`,
      `Total: $${money(b.total_cents)}`,
    ],
  };
}

/** QuickBooks works the tax out itself; a total more than a cent off ours is reported so someone checks the invoice. */
export function totalCheck(expected: InvoiceExpected, qboTotal: number | null | undefined): string | null {
  if (qboTotal == null) return null;
  const diff = Math.round(qboTotal * 100) - expected.totalCents;
  return Math.abs(diff) <= 1 ? null : `QuickBooks totals it at $${money(Math.round(qboTotal * 100))}, BMD at $${money(expected.totalCents)}. Check the tax before sending.`;
}

// ---------- the client record wins ----------

type QboAddr = { Line1?: string; Line2?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };
export type QboCustomerRecord = { Id?: string; SyncToken?: string; DisplayName?: string; PrimaryEmailAddr?: { Address?: string }; PrimaryPhone?: { FreeFormNumber?: string }; BillAddr?: QboAddr };
export type ClientRecord = { name: string; email: string | null; phone: string | null; billing_address: string | null };
export type CustomerChange = { field: "Name" | "Email" | "Phone" | "Billing address"; from: string | null; to: string };

const PROV = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/i;
const POSTAL = /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i;

/** "200 Main St, Unit 4, Winnipeg MB, R3C 1A1" → QuickBooks' address parts. Anything not in that shape goes on Line1. */
export function parseAddress(text: string): QboAddr {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const out: QboAddr = {};
  if (parts.length >= 2 && POSTAL.test(parts[parts.length - 1]!)) out.PostalCode = parts.pop()!.toUpperCase().replace(/^(\w{3})\s?(\w{3})$/, "$1 $2");
  const last = parts[parts.length - 1];
  const m = last?.match(/^(.*\S)\s+([A-Za-z]{2})$/);
  if (parts.length >= 2 && m && PROV.test(m[2]!)) {
    parts.pop();
    out.City = m[1]!;
    out.CountrySubDivisionCode = m[2]!.toUpperCase();
  }
  if (!parts.length && !out.City) return { Line1: text.trim() };
  if (parts.length > 2) return { ...out, Line1: parts[0]!, Line2: parts.slice(1).join(", ") };
  return { ...out, ...(parts[0] ? { Line1: parts[0] } : {}), ...(parts[1] ? { Line2: parts[1] } : {}) };
}

const addrText = (a?: QboAddr) => (a ? [a.Line1, a.Line2, [a.City, a.CountrySubDivisionCode].filter(Boolean).join(" "), a.PostalCode].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") : "");
const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9@.]/g, "");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function customerChanges(client: ClientRecord, qbo: QboCustomerRecord): { changes: CustomerChange[]; body: Record<string, unknown> | null } {
  const changes: CustomerChange[] = [];
  const body: Record<string, unknown> = {};
  const name = client.name.trim();
  if (name && squash(name) !== squash(qbo.DisplayName)) {
    changes.push({ field: "Name", from: qbo.DisplayName ?? null, to: name });
    body["DisplayName"] = name.slice(0, 500);
  }
  const email = (client.email ?? "").trim();
  if (email && email.toLowerCase() !== (qbo.PrimaryEmailAddr?.Address ?? "").trim().toLowerCase()) {
    changes.push({ field: "Email", from: qbo.PrimaryEmailAddr?.Address ?? null, to: email });
    body["PrimaryEmailAddr"] = { Address: email };
  }
  const phone = (client.phone ?? "").trim();
  if (phone && digits(phone) !== digits(qbo.PrimaryPhone?.FreeFormNumber)) {
    changes.push({ field: "Phone", from: qbo.PrimaryPhone?.FreeFormNumber ?? null, to: phone });
    body["PrimaryPhone"] = { FreeFormNumber: phone };
  }
  const addr = (client.billing_address ?? "").trim();
  if (addr && squash(addrText(parseAddress(addr))) !== squash(addrText(qbo.BillAddr))) {
    changes.push({ field: "Billing address", from: addrText(qbo.BillAddr) || null, to: addr });
    body["BillAddr"] = parseAddress(addr);
  }
  if (!changes.length) return { changes, body: null };
  return { changes, body: { Id: qbo.Id, SyncToken: qbo.SyncToken, sparse: true, ...body } };
}
