import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildQboInvoice, customerChanges, totalCheck, type BillForQbo, type ClientRecord, type CustomerChange, type InvoiceRefs, type QboCustomerRecord } from "./invoice";

/** progress_bills has no browser write access: the service-role client records the QuickBooks id after the caller is checked. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as any;
type Auth = { accessToken: string; realmId: string };

/** The QuickBooks names BMD's own invoices use. Looked up by name each time, so a renamed item is reported, not guessed. */
export const INVOICE_NAMES = { lineItem: "01 - Flooring", holdbackItem: "Holdback", gst: "GST" } as const;

async function qboClient() {
  const { qbo, qboEnv, qboConnection } = await import("./qbo.server");
  if (!qboEnv()) throw new Error("QuickBooks is not set up yet.");
  if (!(await qboConnection())) throw new Error("Connect QuickBooks first (Company settings → Integrations).");
  const q = qbo();
  return { q, auth: (await q.getAccessToken()) as Auth };
}

const esc = (s: string) => s.replace(/'/g, "\\'");
async function refsFor(q: Awaited<ReturnType<typeof qboClient>>["q"], auth: Auth): Promise<InvoiceRefs> {
  const one = async (entity: string, name: string) => {
    const rows = await q.queryAll(entity, auth, `Name = '${esc(name)}'`);
    const id = (rows[0] as { Id?: string } | undefined)?.Id;
    if (!id) throw new Error(`QuickBooks has no ${entity === "TaxCode" ? "tax code" : "item"} called "${name}".`);
    return String(id);
  };
  const [lineItemId, holdbackItemId, gstCodeId] = await Promise.all([one("Item", INVOICE_NAMES.lineItem), one("Item", INVOICE_NAMES.holdbackItem), one("TaxCode", INVOICE_NAMES.gst)]);
  return { lineItemId, holdbackItemId, gstCodeId };
}

type Loaded = { bill: BillForQbo; project: { id: string; name: string; project_number: string | null }; client: (ClientRecord & { id: string; qbo_customer_id: string | null }) | null; customerId: string | null };
async function load(billId: string): Promise<Loaded> {
  const { data: bill, error } = await admin.from("progress_bills").select("id,project_id,number,kind,status,lines,gross_cents,holdback_cents,net_cents,gst_cents,total_cents,bill_date,due_date,client_notes,period_note,qbo_invoice_id").eq("id", billId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!bill) throw new Error("Bill not found.");
  const { data: project, error: pe } = await admin.from("projects").select("id,name,project_number,client:clients(id,name,email,phone,billing_address,qbo_customer_id)").eq("id", bill.project_id).maybeSingle();
  if (pe) throw new Error(pe.message);
  const { data: link } = await admin.from("sync_links").select("external_id").eq("system", "quickbooks").eq("kind", "project").eq("bmd_id", bill.project_id).maybeSingle();
  const client = project?.client ?? null;
  const num = (v: unknown) => Number(v ?? 0);
  return {
    bill: { ...bill, gross_cents: num(bill.gross_cents), holdback_cents: num(bill.holdback_cents), net_cents: num(bill.net_cents), gst_cents: num(bill.gst_cents), total_cents: num(bill.total_cents), lines: (bill.lines ?? []) as BillForQbo["lines"] },
    project: { id: project?.id ?? bill.project_id, name: project?.name ?? "Job", project_number: project?.project_number ?? null },
    client,
    // A job linked to its own QuickBooks project (a sub-customer) is invoiced there; otherwise under the client.
    customerId: link?.external_id ?? client?.qbo_customer_id ?? null,
  };
}

async function readCustomer(q: Awaited<ReturnType<typeof qboClient>>["q"], auth: Auth, id: string): Promise<QboCustomerRecord> {
  const body = await q.get(`customer/${encodeURIComponent(id)}`, auth);
  return (body["Customer"] ?? {}) as QboCustomerRecord;
}

export type InvoicePreview =
  | { ok: true; number: string; customerName: string | null; summary: string[]; customerChanges: CustomerChange[]; names: typeof INVOICE_NAMES }
  | { ok: false; message: string };

/** What would be created, and what would change on the customer first. Reads only. */
export async function previewBillInvoice(billId: string): Promise<InvoicePreview> {
  const l = await load(billId);
  const plan = buildQboInvoice({ bill: l.bill, customerId: l.customerId, refs: { lineItemId: "-", holdbackItemId: "-", gstCodeId: "-" } });
  if (!plan.ok) return plan;
  const { q, auth } = await qboClient();
  await refsFor(q, auth);
  let changes: CustomerChange[] = [];
  let customerName: string | null = null;
  if (l.client?.qbo_customer_id) {
    const c = await readCustomer(q, auth, l.client.qbo_customer_id);
    customerName = c.DisplayName ?? null;
    changes = customerChanges(l.client, c).changes;
  }
  return { ok: true, number: l.bill.number, customerName, summary: plan.summary, customerChanges: changes, names: INVOICE_NAMES };
}

/** Brings the client's QuickBooks customer up to the client record. Returns what changed. */
async function applyClient(q: Awaited<ReturnType<typeof qboClient>>["q"], auth: Auth, client: ClientRecord & { id: string; qbo_customer_id: string | null }, by: string): Promise<CustomerChange[]> {
  if (!client.qbo_customer_id) return [];
  const current = await readCustomer(q, auth, client.qbo_customer_id);
  const { changes, body } = customerChanges(client, current);
  if (!body) return [];
  await q.post("customer", body, auth);
  await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "customer", bmd_id: client.id, external_id: client.qbo_customer_id, label: client.name, outcome: "sent", detail: { changes, by } });
  return changes;
}

export type InvoiceResult = { ok: true; invoiceId: string; docNumber: string | null; customerChanges: CustomerChange[]; warning: string | null } | { ok: false; message: string };

/** Creates the unsent QuickBooks invoice for an issued bill. Never emails it. Creating twice never makes two. */
export async function createBillInvoice(billId: string, by: string): Promise<InvoiceResult> {
  const { data: token, error: lockError } = await admin.rpc("sync_send_lock");
  if (lockError) throw new Error(lockError.message);
  if (typeof token !== "string") return { ok: false, message: "Another send to QuickBooks is running. Try again in a minute." };
  try {
    const l = await load(billId);
    const { q, auth } = await qboClient();
    const refs = await refsFor(q, auth);
    const plan = buildQboInvoice({ bill: l.bill, customerId: l.customerId, refs });
    if (!plan.ok) return plan;
    const changes = l.client ? await applyClient(q, auth, l.client, by) : [];
    // A refused attempt moves the request id on; an unanswered one keeps it, so QuickBooks returns the same invoice.
    const { count } = await admin.from("sync_log").select("id", { count: "exact", head: true }).eq("kind", "invoice").eq("bmd_id", billId).eq("outcome", "failed");
    const requestId = `${billId.replace(/-/g, "")}-${count ?? 0}`;
    let inv: { Id?: string; DocNumber?: string; TotalAmt?: number };
    try {
      inv = ((await q.post(`invoice?requestid=${requestId}`, plan.body, auth))["Invoice"] ?? {}) as typeof inv;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "invoice", bmd_id: billId, external_id: null, label: l.bill.number, outcome: "failed", detail: { error: message.slice(0, 500), by } });
      return { ok: false, message };
    }
    if (!inv.Id) return { ok: false, message: "QuickBooks answered without an invoice id. Check QuickBooks before trying again." };
    const { error: saveError } = await admin.from("progress_bills").update({ qbo_invoice_id: String(inv.Id) }).eq("id", billId).is("qbo_invoice_id", null);
    if (saveError) throw new Error(`Created in QuickBooks as invoice ${inv.Id}, but that could not be saved here: ${saveError.message}`);
    const warning = totalCheck(plan.expected, inv.TotalAmt);
    await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "invoice", bmd_id: billId, external_id: String(inv.Id), label: l.bill.number, outcome: "sent", detail: { summary: plan.summary, doc_number: inv.DocNumber ?? null, qbo_total: inv.TotalAmt ?? null, warning, by } });
    return { ok: true, invoiceId: String(inv.Id), docNumber: inv.DocNumber ?? null, customerChanges: changes, warning };
  } finally {
    const { error } = await admin.rpc("sync_send_unlock", { _token: token });
    if (error) console.error(`[invoice] could not release the send lock: ${error.message}`);
  }
}

export type ClientDiff = { clientId: string; name: string; customerId: string; changes: CustomerChange[] };

/** Every linked client whose QuickBooks customer differs from it. Reads only. */
export async function clientCustomerDiffs(): Promise<ClientDiff[]> {
  const { data, error } = await admin.from("clients").select("id,name,email,phone,billing_address,qbo_customer_id").not("qbo_customer_id", "is", null);
  if (error) throw new Error(error.message);
  const { q, auth } = await qboClient();
  const customers = (await q.queryAll("Customer", auth)) as QboCustomerRecord[];
  const byId = new Map(customers.map((c) => [String(c.Id), c]));
  const out: ClientDiff[] = [];
  for (const c of (data ?? []) as (ClientRecord & { id: string; qbo_customer_id: string })[]) {
    const qc = byId.get(c.qbo_customer_id);
    if (!qc) continue;
    const { changes } = customerChanges(c, qc);
    if (changes.length) out.push({ clientId: c.id, name: c.name, customerId: c.qbo_customer_id, changes });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Updates the chosen clients' QuickBooks customers from the client records. */
export async function pushClientsToQbo(ids: string[], by: string): Promise<{ updated: number; failed: { name: string; message: string }[] }> {
  const { data, error } = await admin.from("clients").select("id,name,email,phone,billing_address,qbo_customer_id").in("id", ids.slice(0, 200));
  if (error) throw new Error(error.message);
  const { q, auth } = await qboClient();
  let updated = 0;
  const failed: { name: string; message: string }[] = [];
  for (const c of (data ?? []) as (ClientRecord & { id: string; qbo_customer_id: string | null })[]) {
    try {
      if ((await applyClient(q, auth, c, by)).length) updated++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push({ name: c.name, message });
      await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "customer", bmd_id: c.id, external_id: c.qbo_customer_id, label: c.name, outcome: "failed", detail: { error: message.slice(0, 500), by } });
    }
  }
  return { updated, failed };
}
