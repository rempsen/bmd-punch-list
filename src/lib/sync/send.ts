/**
 * What one waiting change becomes when it is sent to QuickBooks. Pure: the server reads the records and the current
 * QuickBooks copy, this works out the request, the server posts it. Dan's rules: BMD's value always wins, a blank cost
 * is never sent as 0, nothing is ever deleted in QuickBooks (only made inactive), and a selling price is never written.
 */
export type Change = { from: unknown; to: unknown };
export type OutboxLite = { id: string; kind: string; bmd_id: string; label: string | null; op: "create" | "update" | "delete"; changes: Record<string, Change> };
export type BmdRecord = { id: string; name: string; active: boolean; unit_cost_cents?: number | null; supplier_id?: string | null; supplier_name?: string | null; email?: string | null; phone?: string | null; account_number?: string | null };
/** The QuickBooks copy as it is right now (for SyncToken), or null when it could not be read. */
export type QboCurrent = { Id: string; SyncToken: string } | null;
/** A linked item of the same kind, used to copy accounts when creating. */
export type QboReference = { Type?: string; IncomeAccountRef?: { value: string }; ExpenseAccountRef?: { value: string } } | null;
export type SendInput = { outbox: OutboxLite; record: BmdRecord | null; link: { external_id: string } | null; supplierLink: { external_id: string } | null; current: QboCurrent; reference: QboReference };

export type PlannedSend = { outboxId: string; kind: string; bmdId: string; label: string; target: "Item" | "Vendor"; qboId: string | null; op: "update" | "create" | "deactivate"; body: Record<string, unknown>; summary: string[] };
export type Plan = { ok: true; send: PlannedSend } | { ok: false; reason: string };

const dollars = (cents: number | null | undefined): number | undefined => (typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) / 100 : undefined);
const money = (v: unknown) => (typeof v === "number" ? (Math.round(v) / 100).toFixed(2) : "unknown");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The change list in words, for the preview and the log. */
export function sendSummary(changes: Record<string, Change>, ctx: { supplierName?: string | null | undefined } = {}): string[] {
  const out: string[] = [];
  for (const [field, c] of Object.entries(changes)) {
    if (field === "unit_cost_cents") out.push(`cost ${money(c.from)} → ${c.to == null ? "unknown (not sent)" : money(c.to)}`);
    else if (field === "name") out.push(`name "${String(c.from ?? "")}" → "${String(c.to ?? "")}"`);
    else if (field === "supplier_id") out.push(c.to == null ? "supplier removed" : `supplier → ${ctx.supplierName ?? "linked supplier"}`);
    else if (field === "active") out.push(c.to === false ? "made inactive" : "made active again");
    else if (field === "email" || field === "phone" || field === "account_number") out.push(`${field.replace("_", " ")} → ${c.to == null || c.to === "" ? "cleared" : String(c.to)}`);
  }
  return out;
}

export function planSend(i: SendInput): Plan {
  const { outbox: o, record: r, link } = i;
  const label = r?.name ?? o.label ?? "(no name)";
  const isVendor = o.kind === "supplier";
  const target = isVendor ? "Vendor" : "Item";
  if (o.kind !== "material" && o.kind !== "labour" && o.kind !== "supplier") return { ok: false, reason: `${o.kind} records are not sent to QuickBooks.` };

  // Removed in BMD: make it inactive in QuickBooks, never delete.
  if (o.op === "delete" || !r) {
    if (!link) return { ok: false, reason: "Removed in BMD and never in QuickBooks: nothing to send." };
    if (!i.current) return { ok: false, reason: "Its QuickBooks copy could not be read, so it was not changed." };
    return { ok: true, send: { outboxId: o.id, kind: o.kind, bmdId: o.bmd_id, label, target, qboId: link.external_id, op: "deactivate", body: { Id: i.current.Id, SyncToken: i.current.SyncToken, sparse: true, Active: false }, summary: ["made inactive in QuickBooks (removed in BMD)"] } };
  }

  const summary = sendSummary(o.changes, { supplierName: r.supplier_name });
  if (isVendor) {
    const fields: Record<string, unknown> = { DisplayName: r.name, Active: r.active };
    if (text(r.email)) fields["PrimaryEmailAddr"] = { Address: text(r.email) };
    if (text(r.phone)) fields["PrimaryPhone"] = { FreeFormNumber: text(r.phone) };
    if (text(r.account_number)) fields["AcctNum"] = text(r.account_number);
    if (link) {
      if (!i.current) return { ok: false, reason: "Its QuickBooks copy could not be read, so it was not changed." };
      return { ok: true, send: { outboxId: o.id, kind: o.kind, bmdId: o.bmd_id, label, target, qboId: link.external_id, op: "update", body: { Id: i.current.Id, SyncToken: i.current.SyncToken, sparse: true, ...fields }, summary } };
    }
    return { ok: true, send: { outboxId: o.id, kind: o.kind, bmdId: o.bmd_id, label, target, qboId: null, op: "create", body: fields, summary: ["new vendor in QuickBooks"] } };
  }

  const fields: Record<string, unknown> = { Name: r.name };
  const cost = dollars(r.unit_cost_cents);
  if (cost !== undefined) fields["PurchaseCost"] = cost;
  fields["Active"] = r.active;
  if (o.kind === "material" && i.supplierLink) fields["PrefVendorRef"] = { value: i.supplierLink.external_id };
  if (link) {
    if (!i.current) return { ok: false, reason: "Its QuickBooks copy could not be read, so it was not changed." };
    return { ok: true, send: { outboxId: o.id, kind: o.kind, bmdId: o.bmd_id, label, target, qboId: link.external_id, op: "update", body: { Id: i.current.Id, SyncToken: i.current.SyncToken, sparse: true, ...fields }, summary } };
  }
  const ref = i.reference;
  if (!ref?.IncomeAccountRef || !ref.ExpenseAccountRef) return { ok: false, reason: "Not linked to QuickBooks and no reference item to copy accounts from — link it on the import screen or create it in QuickBooks first." };
  const { Name, ...rest } = fields;
  return { ok: true, send: { outboxId: o.id, kind: o.kind, bmdId: o.bmd_id, label, target, qboId: null, op: "create", body: { Name, Type: o.kind === "labour" ? "Service" : "NonInventory", IncomeAccountRef: ref.IncomeAccountRef, ExpenseAccountRef: ref.ExpenseAccountRef, ...rest }, summary: [`new ${o.kind === "labour" ? "service" : "product"} in QuickBooks`] } };
}
