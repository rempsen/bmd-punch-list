import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type QboItemPreview = { name: string; description: string; purchaseCost: number | null; sku: string | null };
type Input = { materialId: string; send: boolean };
export type ItemPushResult =
  | { ok: true; sent: false; preview: QboItemPreview; existing: { id: string; name: string | null } | null }
  | { ok: true; sent: true; itemId: string; itemName: string | null; sku: string | null; message: string }
  | { ok: false; message: string };

/**
 * Sends one catalogue material to QuickBooks as a non-inventory item. `send: false` returns the preview only.
 * Links the item (sync_links, kind material) and logs to sync_log like the purchase-order sender.
 */
export const pushCatalogueItemToQbo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (typeof d?.materialId !== "string" || !d.materialId) throw new Error("Pick a catalogue item.");
    return { materialId: d.materialId, send: d.send === true };
  })
  .handler(async ({ data, context }): Promise<ItemPushResult> => {
    const sb = context.supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const can = async (c: string) => (await sb.rpc("has_capability", { _capability: c })).data === true;
    if (!(await can("manage_catalogue")) && !(await can("view_pricing"))) return { ok: false, message: "You don't have permission to send catalogue items to QuickBooks." };
    const { data: m, error } = await sb.from("catalogue_materials").select("id,name,sku,cost_uom,unit_cost_cents,manufacturer,product_line,colour").eq("id", data.materialId).maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!m) return { ok: false, message: "Catalogue item not found." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data: link } = await admin.from("sync_links").select("external_id,external_name").eq("kind", "material").eq("system", "quickbooks").eq("bmd_id", m.id).maybeSingle();
    const { qboItemBody } = await import("./item");
    const src = { name: m.name, sku: m.sku, unit: m.cost_uom, unit_cost_cents: m.unit_cost_cents, description: [m.manufacturer, m.product_line, m.colour].filter(Boolean).join(" · ") || null };
    if (!data.send) {
      const b = qboItemBody(src, { expenseId: null, incomeId: null });
      const preview: QboItemPreview = { name: String(b["Name"]), description: String(b["Description"]), purchaseCost: (b["PurchaseCost"] as number | undefined) ?? null, sku: (b["Sku"] as string | undefined) ?? null };
      return { ok: true, sent: false, preview, existing: link ? { id: link.external_id, name: link.external_name } : null };
    }
    if (link) return { ok: true, sent: true, itemId: link.external_id, itemName: link.external_name, sku: m.sku, message: `Already in QuickBooks as item ${link.external_id}.` };

    const { qbo, qboEnv, qboConnection } = await import("./qbo.server");
    if (!qboEnv()) return { ok: false, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false, message: "Connect QuickBooks first (Settings → Integrations)." };
    const log = async (outcome: "sent" | "failed", detail: Record<string, unknown>, externalId?: string) => {
      const { error: e } = await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "material", bmd_id: m.id, external_id: externalId ?? null, label: `Item · ${m.name}`, outcome, detail: { ...detail, by: context.userId } });
      if (e) console.error("[qbo] could not log item push", e.message);
    };
    try {
      const q = qbo();
      const auth = await q.getAccessToken();
      const [exp, inc] = await Promise.all([q.queryAll("Account", auth, "AccountSubType = 'SuppliesMaterialsCogs'"), q.queryAll("Account", auth, "AccountType = 'Income'")]);
      const body = qboItemBody(src, { expenseId: (exp[0]?.["Id"] as string | undefined) ?? null, incomeId: (inc[0]?.["Id"] as string | undefined) ?? null });
      const res = await q.post("item", body, auth);
      const it = (res["Item"] ?? res) as Record<string, unknown>;
      const itemId = String(it["Id"] ?? "");
      if (!itemId) throw new Error("QuickBooks did not return an item id.");
      const itemName = (it["Name"] as string | undefined) ?? m.name;
      const now = new Date().toISOString();
      const { error: le } = await admin.from("sync_links").upsert({ kind: "material", system: "quickbooks", bmd_id: m.id, external_id: itemId, external_name: itemName, linked_at: now, synced_at: now }, { onConflict: "kind,bmd_id,system" });
      if (le) console.error("[qbo] item link not saved", le.message);
      await log("sent", { item_name: itemName }, itemId);
      return { ok: true, sent: true, itemId, itemName, sku: (it["Sku"] as string | undefined) ?? m.sku, message: `Created QuickBooks item ${itemId} (${itemName}).` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await log("failed", { error: message });
      return { ok: false, message };
    }
  });
