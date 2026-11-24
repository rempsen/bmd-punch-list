import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OrderLine, SubcontractOrder, SubcontractStatus } from "./logic";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }>; from: (t: string) => any };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const asSb = (ctx: { supabase: unknown }) => ctx.supabase as never as Sb;
const canManage = async (sb: Sb) => (await sb.rpc("has_capability", { _capability: "manage_projects" })).data === true;
const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`${what} is not valid.`);
  return v;
};

/** Starts a draft purchase order from a work order: its lines, costed from the catalogue's labour rates. */
export const createSubcontractOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { visitId: string }) => ({ visitId: uuid(d?.visitId, "The work order") }))
  .handler(async ({ data, context }): Promise<Result<{ orderId: string; uncosted: string[] }>> => {
    const sb = asSb(context);
    if (!(await canManage(sb))) return { ok: false, message: "You don't have permission to create purchase orders." };
    const { orderFromWorkOrder, orderTotal, poNumber, uncostedLines } = await import("./logic");

    const { data: visit, error: ve } = await sb.from("install_visits").select("id,project_id,technician_supplier_id,starts_at,status").eq("id", data.visitId).maybeSingle();
    if (ve) return { ok: false, message: ve.message };
    if (!visit) return { ok: false, message: "That work order could not be found." };
    if (visit.status === "cancelled") return { ok: false, message: "This work order is cancelled." };
    if (!visit.technician_supplier_id) return { ok: false, message: "Pick a subcontractor as the crew first; a purchase order goes to a vendor." };

    const { data: supplier } = await sb.from("suppliers").select("id,name,supplies,active").eq("id", visit.technician_supplier_id).maybeSingle();
    if (!supplier) return { ok: false, message: "The crew's vendor record could not be found." };
    if (supplier.supplies !== "labour" && supplier.supplies !== "both") return { ok: false, message: `${supplier.name} is a materials supplier, not a subcontractor.` };

    const { data: open } = await sb.from("subcontract_orders").select("id,po_number,status").eq("visit_id", visit.id).neq("status", "cancelled");
    if (open?.length) return { ok: false, message: `This work order already has purchase order ${open[0].po_number}.` };

    const { data: lines, error: le } = await sb.from("install_visit_lines").select("id,description,quantity,uom,cost_code,sort_order").eq("visit_id", visit.id).order("sort_order");
    if (le) return { ok: false, message: le.message };
    if (!lines?.length) return { ok: false, message: "Add what this work order covers (its lines from the estimate) before making a purchase order." };

    const { data: rates } = await sb.from("labour_rates").select("id,name,uom,unit_cost_cents,cost_code,active").eq("active", true);
    const drafted: OrderLine[] = orderFromWorkOrder(lines as never, (rates ?? []) as never);
    const { subtotal_cents } = orderTotal(drafted);

    const { data: project } = await sb.from("projects").select("id,project_number").eq("id", visit.project_id).maybeSingle();
    const { count } = await sb.from("subcontract_orders").select("id", { count: "exact", head: true }).eq("project_id", visit.project_id);
    let seq = (count ?? 0) + 1;
    let inserted: { id: string } | null = null;
    // The number is unique across jobs; a clash (two people at once) just takes the next one.
    for (let tries = 0; tries < 5 && !inserted; tries++, seq++) {
      const { data: row, error: ie } = await sb
        .from("subcontract_orders")
        .insert({ project_id: visit.project_id, visit_id: visit.id, supplier_id: supplier.id, po_number: poNumber(project ?? { project_number: null, id: visit.project_id }, seq), subtotal_cents })
        .select("id")
        .maybeSingle();
      if (ie && !/duplicate|unique/i.test(ie.message)) return { ok: false, message: ie.message };
      inserted = row ?? null;
    }
    if (!inserted) return { ok: false, message: "Could not give the purchase order a number; try again." };
    const { error: ole } = await sb.from("subcontract_order_lines").insert(drafted.map((l) => ({ ...l, order_id: inserted!.id })));
    if (ole) return { ok: false, message: `The order was made but its lines were not saved: ${ole.message}` };
    return { ok: true, orderId: inserted.id, uncosted: uncostedLines(drafted) };
  });

type LineInput = { id?: string | undefined; description: string; quantity: number; uom: string; unit_cost_cents: number | null; cost_code: string | null; visit_line_id?: string | null };

/** Edits a draft: its lines (quantities and rates reviewed by a person) and notes. Sent orders are read-only. */
export const updateSubcontractOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string; lines: LineInput[]; notes?: string | null }) => {
    const lines = Array.isArray(d?.lines) ? d.lines.slice(0, 200) : [];
    for (const l of lines) {
      if (typeof l.description !== "string" || !l.description.trim()) throw new Error("Every line needs a description.");
      if (!Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0) throw new Error("Quantities must be numbers.");
      if (l.unit_cost_cents !== null && l.unit_cost_cents !== undefined && (!Number.isInteger(l.unit_cost_cents) || l.unit_cost_cents < 0)) throw new Error("Rates must be whole cents.");
    }
    return { orderId: uuid(d?.orderId, "The order"), lines, notes: typeof d.notes === "string" ? d.notes.slice(0, 4000) : null };
  })
  .handler(async ({ data, context }): Promise<Result<{ subtotal_cents: number }>> => {
    const sb = asSb(context);
    if (!(await canManage(sb))) return { ok: false, message: "You don't have permission to edit purchase orders." };
    const { orderTotal } = await import("./logic");
    const { data: order } = await sb.from("subcontract_orders").select("id,status").eq("id", data.orderId).maybeSingle();
    if (!order) return { ok: false, message: "That purchase order could not be found." };
    if (order.status !== "draft") return { ok: false, message: "Only a draft can be changed; this one has been sent." };
    const rows = data.lines.map((l, i) => ({
      order_id: order.id,
      visit_line_id: l.visit_line_id ?? null,
      description: l.description.trim(),
      quantity: Number(l.quantity),
      uom: l.uom || "EA",
      unit_cost_cents: l.unit_cost_cents ?? null,
      cost_code: l.cost_code || null,
      sort_order: i,
    }));
    const { error: de } = await sb.from("subcontract_order_lines").delete().eq("order_id", order.id);
    if (de) return { ok: false, message: de.message };
    if (rows.length) {
      const { error: ie } = await sb.from("subcontract_order_lines").insert(rows);
      if (ie) return { ok: false, message: ie.message };
    }
    const { subtotal_cents } = orderTotal(rows);
    const { error: ue } = await sb.from("subcontract_orders").update({ subtotal_cents, notes: data.notes }).eq("id", order.id);
    if (ue) return { ok: false, message: ue.message };
    return { ok: true, subtotal_cents };
  });

/** Creates the purchase order in QuickBooks for the subcontractor (vendor) and marks the order sent. */
export const sendSubcontractOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string; email?: string | undefined }) => {
    const email = typeof d?.email === "string" ? d.email.trim() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address doesn't look right.");
    return { orderId: uuid(d?.orderId, "The order"), email };
  })
  .handler(async ({ data, context }): Promise<Result<{ poNumber: string; qboDocNumber: string | null; emailed: boolean }>> => {
    const sb = asSb(context);
    if (!(await canManage(sb))) return { ok: false, message: "You don't have permission to send purchase orders." };
    const { subcontractPoLines, uncostedLines } = await import("./logic");
    const { data: order } = await sb.from("subcontract_orders").select("id,project_id,visit_id,supplier_id,po_number,status,subtotal_cents,notes").eq("id", data.orderId).maybeSingle();
    if (!order) return { ok: false, message: "That purchase order could not be found." };
    if (order.status !== "draft") return { ok: false, message: `Purchase order ${order.po_number} is already ${order.status}.` };
    const { data: lines } = await sb.from("subcontract_order_lines").select("visit_line_id,description,quantity,uom,unit_cost_cents,cost_code,sort_order").eq("order_id", order.id).order("sort_order");
    const orderLines = ((lines ?? []) as OrderLine[]).map((l) => ({ ...l, quantity: Number(l.quantity), unit_cost_cents: l.unit_cost_cents === null ? null : Number(l.unit_cost_cents) }));
    if (!orderLines.length) return { ok: false, message: "The purchase order has no lines." };
    const blank = uncostedLines(orderLines);
    if (blank.length) return { ok: false, message: `Enter a rate for ${blank.join(", ")} before sending; a blank cost is never sent as 0.` };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { qbo, qboEnv, qboConnection } = await import("../qbo/qbo.server");
    if (!qboEnv()) return { ok: false, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false, message: "Connect QuickBooks first (Company settings → Integrations)." };

    const { data: supplier } = await admin.from("suppliers").select("id,name,email").eq("id", order.supplier_id).maybeSingle();
    if (!supplier) return { ok: false, message: "The subcontractor's vendor record could not be found." };
    // The vendor must already be linked: purchase orders never create vendors in QuickBooks.
    const { data: link } = await admin.from("sync_links").select("external_id").eq("kind", "supplier").eq("system", "quickbooks").eq("bmd_id", supplier.id).maybeSingle();
    if (!link?.external_id) return { ok: false, message: `${supplier.name} is not linked to a QuickBooks vendor yet. Link it on Company settings → Sync, then send again.` };
    const { data: project } = await admin.from("projects").select("name,project_number").eq("id", order.project_id).maybeSingle();
    const { data: visit } = order.visit_id ? await admin.from("install_visits").select("starts_at").eq("id", order.visit_id).maybeSingle() : { data: null };

    const log = async (outcome: "sent" | "failed", detail: Record<string, unknown>, externalId?: string) => {
      const { error: e } = await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "purchase_order", bmd_id: order.id, external_id: externalId ?? null, label: `Sub PO ${order.po_number} · ${supplier.name}`, outcome, detail: { ...detail, by: context.userId } });
      if (e) console.error("[qbo] could not log subcontract purchase order", e.message);
    };

    let poId: string | null = null;
    let docNumber: string | null = null;
    try {
      const q = qbo();
      const auth = await q.getAccessToken();
      // Labour goes on the cost-of-labour account when the books have one, else the first cost-of-goods-sold account.
      let accounts = await q.queryAll("Account", auth, "AccountSubType IN ('CostOfLabor', 'CostOfLaborCos')");
      if (!accounts.length) accounts = await q.queryAll("Account", auth, "AccountType = 'Cost of Goods Sold'");
      const accountId = (accounts[0]?.["Id"] as string | undefined) ?? null;
      if (!accountId) throw new Error("QuickBooks has no cost-of-labour or cost-of-goods-sold account to put the labour on.");
      const job = project ? `${project.project_number ?? ""} ${project.name}`.trim() : "";
      const when = visit?.starts_at ? new Date(visit.starts_at).toLocaleDateString("en-CA", { timeZone: "America/Winnipeg" }) : "";
      const body: Record<string, unknown> = {
        VendorRef: { value: String(link.external_id) },
        DocNumber: order.po_number,
        Line: subcontractPoLines(orderLines, accountId),
        Memo: [`BMD job: ${job}`, when ? `Work order ${when}` : "", `PO ${order.po_number}`, order.notes ?? ""].filter(Boolean).join(" · ").slice(0, 4000),
        PrivateNote: `BMD subcontract PO ${order.po_number}`.slice(0, 4000),
        ...(data.email ? { POEmail: { Address: data.email } } : {}),
      };
      const res = await q.post("purchaseorder", body, auth);
      const po = res["PurchaseOrder"] as { Id?: string; DocNumber?: string } | undefined;
      poId = po?.Id ? String(po.Id) : null;
      docNumber = po?.DocNumber ? String(po.DocNumber) : poId;
      if (!poId) throw new Error("QuickBooks did not return the purchase order.");
      const sentAt = new Date().toISOString();
      const { error: ue } = await admin.from("subcontract_orders").update({ qbo_po_id: poId, qbo_po_sent_at: sentAt, status: "sent" as SubcontractStatus }).eq("id", order.id);
      if (ue) throw new Error(`Purchase order ${docNumber} was created in QuickBooks but not saved here: ${ue.message}`);
      let emailed = false;
      if (data.email) {
        await q.post(`purchaseorder/${encodeURIComponent(poId)}/send?sendTo=${encodeURIComponent(data.email)}`, undefined, auth);
        emailed = true;
        if (!supplier.email) await admin.from("suppliers").update({ email: data.email }).eq("id", supplier.id);
      }
      await log("sent", { po_number: order.po_number, qbo_doc_number: docNumber, email: data.email || null }, poId);
      return { ok: true, poNumber: order.po_number, qboDocNumber: docNumber, emailed };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await log("failed", { error: message, po_number: order.po_number }, poId ?? undefined);
      if (poId) return { ok: false, message: `Purchase order ${docNumber} was created in QuickBooks but not emailed: ${message}` };
      return { ok: false, message };
    }
  });

/** Cancels a draft or sent order here. A purchase order already in QuickBooks is left for the bookkeeper to close there. */
export const cancelSubcontractOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string }) => ({ orderId: uuid(d?.orderId, "The order") }))
  .handler(async ({ data, context }): Promise<Result> => {
    const sb = asSb(context);
    if (!(await canManage(sb))) return { ok: false, message: "You don't have permission to cancel purchase orders." };
    const { data: order } = await sb.from("subcontract_orders").select("id,status,po_number").eq("id", data.orderId).maybeSingle();
    if (!order) return { ok: false, message: "That purchase order could not be found." };
    if (order.status === "billed" || order.status === "paid") return { ok: false, message: `Purchase order ${order.po_number} has been billed; it can't be cancelled here.` };
    const { error } = await sb.from("subcontract_orders").update({ status: "cancelled" }).eq("id", order.id);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  });

/**
 * Reads QuickBooks for the bills raised against this job's subcontract purchase orders. A bill linked to the PO (or
 * carrying its number) moves the order to billed; once the bill's balance is zero the order is paid. Read only.
 */
export const subcontractReadBack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) => ({ projectId: uuid(d?.projectId, "The job") }))
  .handler(async ({ data, context }): Promise<Result<{ checked: number; billed: number; paid: number }>> => {
    const sb = asSb(context);
    if (!(await canManage(sb))) return { ok: false, message: "You don't have permission to check purchase orders." };
    const { billMatchesOrder, nextStatus, qboCents } = await import("./logic");
    const { data: orders, error } = await sb.from("subcontract_orders").select("id,supplier_id,po_number,status,qbo_po_id,qbo_bill_id").eq("project_id", data.projectId).in("status", ["sent", "billed"]);
    if (error) return { ok: false, message: error.message };
    const open = (orders ?? []) as Pick<SubcontractOrder, "id" | "supplier_id" | "po_number" | "status" | "qbo_po_id" | "qbo_bill_id">[];
    if (!open.length) return { ok: true, checked: 0, billed: 0, paid: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { qbo, qboEnv, qboConnection } = await import("../qbo/qbo.server");
    if (!qboEnv()) return { ok: false, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false, message: "Connect QuickBooks first (Company settings → Integrations)." };
    const q = qbo();
    const auth = await q.getAccessToken();

    const vendorOf = new Map<string, string>();
    const { data: links } = await admin.from("sync_links").select("bmd_id,external_id").eq("kind", "supplier").eq("system", "quickbooks").in("bmd_id", [...new Set(open.map((o) => o.supplier_id))]);
    for (const l of links ?? []) vendorOf.set(l.bmd_id, String(l.external_id));
    const billsOf = new Map<string, Record<string, unknown>[]>();
    const billsFor = async (vendorId: string) => {
      if (!billsOf.has(vendorId)) billsOf.set(vendorId, await q.queryAll("Bill", auth, `VendorRef = '${vendorId.replace(/'/g, "\\'")}'`));
      return billsOf.get(vendorId)!;
    };

    let billed = 0;
    let paid = 0;
    for (const o of open) {
      const vendorId = vendorOf.get(o.supplier_id);
      if (!vendorId) continue;
      const bill = (await billsFor(vendorId)).find((b) => (o.qbo_bill_id && String(b["Id"]) === o.qbo_bill_id) || billMatchesOrder(b, o));
      if (!bill) continue;
      const balance = qboCents(bill["Balance"]);
      const status = nextStatus(o.status, { bill: true, balanceCents: balance });
      if (status === o.status && o.qbo_bill_id) continue;
      const meta = bill["MetaData"] as { LastUpdatedTime?: string } | undefined;
      const patch: Record<string, unknown> = {
        status,
        qbo_bill_id: String(bill["Id"] ?? ""),
        qbo_bill_total_cents: qboCents(bill["TotalAmt"]),
        billed_at: typeof bill["TxnDate"] === "string" ? bill["TxnDate"] : new Date().toISOString(),
      };
      if (status === "paid") patch["paid_at"] = meta?.LastUpdatedTime ?? new Date().toISOString();
      const { error: ue } = await admin.from("subcontract_orders").update(patch).eq("id", o.id);
      if (ue) return { ok: false, message: ue.message };
      if (status === "paid") paid++;
      else billed++;
    }
    return { ok: true, checked: open.length, billed, paid };
  });
