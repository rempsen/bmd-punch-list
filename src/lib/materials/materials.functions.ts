import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = { ids: string[]; email: string };

/**
 * Creates one QuickBooks purchase order for the selected material lines (one supplier) and emails it to the supplier.
 * Returns a result instead of throwing so the dialog can show exactly what happened, including a PO that was created but not sent.
 */
export const createPurchaseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!Array.isArray(d?.ids) || d.ids.length === 0 || d.ids.some((i) => typeof i !== "string")) throw new Error("Select the lines to order.");
    const email = String(d.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter the supplier's email address.");
    return { ids: d.ids.slice(0, 200), email };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as never as { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }>; from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const can = async (c: string) => (await sb.rpc("has_capability", { _capability: c })).data === true;
    if (!(await can("manage_materials")) && !(await can("manage_projects"))) return { ok: false as const, message: "You don't have permission to order materials." };

    const { poBlock, purchaseOrderBody } = await import("./logic");
    const { data: rows, error } = await sb.from("material_orders").select("id,project_id,supplier_id,catalogue_item_id,description,quantity,unit,unit_cost_cents,status,qbo_po_id,project:projects(name,project_number)").in("id", data.ids);
    if (error) return { ok: false as const, message: error.message };
    const lines = (rows ?? []) as { id: string; supplier_id: string | null; catalogue_item_id: string | null; description: string; quantity: number; unit: string; unit_cost_cents: number | null; status: string; qbo_po_id: string | null; project: { name: string; project_number: string | null } | null }[];
    if (lines.length !== data.ids.length) return { ok: false as const, message: "Some selected lines could not be found. Refresh and try again." };
    const block = poBlock(lines);
    if (block) return { ok: false as const, message: block };
    const supplierId = lines[0]!.supplier_id!;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { qbo, qboEnv, qboConnection } = await import("./../qbo/qbo.server");
    if (!qboEnv()) return { ok: false as const, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false as const, message: "Connect QuickBooks first (Settings → Integrations)." };

    const { data: supplier } = await admin.from("suppliers").select("id,name,email").eq("id", supplierId).maybeSingle();
    if (!supplier) return { ok: false as const, message: "Supplier not found." };
    const log = async (outcome: "sent" | "failed", detail: Record<string, unknown>, externalId?: string) => {
      const { error: e } = await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "purchase_order", bmd_id: supplierId, external_id: externalId ?? null, label: `PO · ${supplier.name}`, outcome, detail: { ...detail, lines: data.ids, by: context.userId } });
      if (e) console.error("[qbo] could not log purchase order", e.message);
    };

    let poId: string | null = null;
    let docNumber: string | null = null;
    try {
      const q = qbo();
      const auth = await q.getAccessToken();
      // Vendor: the linked one, or create it and remember the link.
      const { data: link } = await admin.from("sync_links").select("external_id").eq("kind", "supplier").eq("system", "quickbooks").eq("bmd_id", supplierId).maybeSingle();
      let vendorId: string | null = link?.external_id ?? null;
      if (!vendorId) {
        const found = await q.queryAll("Vendor", auth, `DisplayName = '${String(supplier.name).replace(/'/g, "\\'")}'`);
        vendorId = (found[0]?.["Id"] as string | undefined) ?? null;
        if (!vendorId) {
          const created = await q.post("vendor", { DisplayName: String(supplier.name).slice(0, 100), PrimaryEmailAddr: { Address: data.email } }, auth);
          vendorId = String((created["Vendor"] as { Id?: string } | undefined)?.Id ?? "");
          if (!vendorId) throw new Error("QuickBooks did not return the new vendor.");
        }
        const now = new Date().toISOString();
        const { error: le } = await admin.from("sync_links").upsert({ kind: "supplier", system: "quickbooks", bmd_id: supplierId, external_id: vendorId, external_name: supplier.name, linked_at: now, synced_at: now }, { onConflict: "kind,bmd_id,system" });
        if (le) console.error("[qbo] vendor link not saved", le.message);
      }
      // Items: catalogue items linked to QuickBooks items.
      const catIds = [...new Set(lines.map((l) => l.catalogue_item_id).filter(Boolean))] as string[];
      const itemOf = new Map<string, string>();
      if (catIds.length) {
        const { data: links } = await admin.from("sync_links").select("bmd_id,external_id").eq("kind", "material").eq("system", "quickbooks").in("bmd_id", catIds);
        for (const l of links ?? []) itemOf.set(l.bmd_id, l.external_id);
      }
      const poLines = lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_cost_cents: l.unit_cost_cents, qboItemId: (l.catalogue_item_id && itemOf.get(l.catalogue_item_id)) || null }));
      let accountId: string | null = null;
      if (poLines.some((l) => !l.qboItemId)) {
        const accts = await q.queryAll("Account", auth, "AccountSubType = 'SuppliesMaterialsCogs'");
        accountId = (accts[0]?.["Id"] as string | undefined) ?? null;
      }
      const jobs = [...new Set(lines.map((l) => (l.project ? `${l.project.project_number ?? ""} ${l.project.name}`.trim() : "")).filter(Boolean))];
      const body = purchaseOrderBody(vendorId, poLines, { accountId, memo: jobs.length ? `BMD job: ${jobs.join(", ")}` : "", email: data.email });
      const res = await q.post("purchaseorder", body, auth);
      const po = res["PurchaseOrder"] as { Id?: string; DocNumber?: string } | undefined;
      poId = po?.Id ? String(po.Id) : null;
      docNumber = po?.DocNumber ? String(po.DocNumber) : poId;
      if (!poId) throw new Error("QuickBooks did not return the purchase order.");
      const { error: ue } = await admin.from("material_orders").update({ qbo_po_id: poId, po_number: docNumber, status: "on_order", ordered_at: new Date().toISOString() }).in("id", data.ids);
      if (ue) throw new Error(`Purchase order ${docNumber} was created in QuickBooks but not saved here: ${ue.message}`);

      await q.post(`purchaseorder/${encodeURIComponent(poId)}/send?sendTo=${encodeURIComponent(data.email)}`, undefined, auth);
      const sentAt = new Date().toISOString();
      await admin.from("material_orders").update({ qbo_po_sent_at: sentAt }).in("id", data.ids);
      if (!supplier.email) await admin.from("suppliers").update({ email: data.email }).eq("id", supplierId);
      await log("sent", { po_number: docNumber, email: data.email }, poId);
      return { ok: true as const, poNumber: docNumber, sent: true, message: `Purchase order ${docNumber} created and sent to ${data.email}.` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await log("failed", { error: message, po_number: docNumber }, poId ?? undefined);
      if (poId) return { ok: false as const, poNumber: docNumber, message: `Purchase order ${docNumber} was created but not sent: ${message}` };
      return { ok: false as const, message };
    }
  });
