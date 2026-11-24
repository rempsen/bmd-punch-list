import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { planSend, type PlannedSend, type QboReference } from "./send";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as any;
const BATCH = 50;

export type Preview = { sends: PlannedSend[]; held: { outboxId: string; label: string; reason: string }[] };

export async function sendSetting(): Promise<{ enabled: boolean; lastSendAt: string | null }> {
  const { data } = await admin.from("sync_settings").select("quickbooks_send_enabled,last_send_at").eq("id", 1).maybeSingle();
  return { enabled: data?.quickbooks_send_enabled === true, lastSendAt: data?.last_send_at ?? null };
}
export async function setSendSetting(enabled: boolean, userId: string) {
  const { error } = await admin.from("sync_settings").upsert({ id: 1, quickbooks_send_enabled: enabled, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

type Row = { id: string; kind: string; bmd_id: string; label: string | null; op: "create" | "update" | "delete"; changes: Record<string, { from: unknown; to: unknown }> };
const TABLE: Record<string, string> = { material: "catalogue_materials", labour: "labour_rates", supplier: "suppliers" };

async function readRecord(kind: string, id: string) {
  const t = TABLE[kind];
  if (!t) return null;
  const cols = kind === "material" ? "id,name,active,unit_cost_cents,supplier_id" : kind === "labour" ? "id,name,active,unit_cost_cents" : "id,name,active,email,phone,account_number";
  const { data } = await admin.from(t).select(cols).eq("id", id).maybeSingle();
  if (!data) return null;
  let supplier_name: string | null = null;
  if (kind === "material" && data.supplier_id) supplier_name = (await admin.from("suppliers").select("name").eq("id", data.supplier_id).maybeSingle()).data?.name ?? null;
  return { ...data, supplier_name };
}

async function links(kind: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await admin.from("sync_links").select("bmd_id,external_id").eq("system", "quickbooks").eq("kind", kind).in("bmd_id", ids);
  return new Map(((data ?? []) as { bmd_id: string; external_id: string }[]).map((l) => [l.bmd_id, l.external_id]));
}

/** Plans every waiting change (or the given ones) against what QuickBooks holds right now. Reads only. */
export async function previewSends(ids?: string[]): Promise<Preview> {
  const { qbo } = await import("@/lib/qbo/qbo.server");
  const q = qbo();
  const auth = await q.getAccessToken();
  let query = admin.from("sync_outbox").select("id,kind,bmd_id,label,op,changes").eq("status", "waiting").in("kind", ["material", "labour", "supplier"]).order("created_at").limit(BATCH);
  if (ids?.length) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const byKind = new Map<string, string[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.bmd_id]);
  const linkMaps = new Map<string, Map<string, string>>();
  for (const [k, v] of byKind) linkMaps.set(k, await links(k, v));
  const refCache = new Map<string, QboReference>();
  const reference = async (kind: string): Promise<QboReference> => {
    if (refCache.has(kind)) return refCache.get(kind)!;
    const any = (await admin.from("sync_links").select("external_id").eq("system", "quickbooks").eq("kind", kind).limit(1)).data?.[0]?.external_id as string | undefined;
    let ref: QboReference = null;
    if (any) {
      const it = (await q.get(`item/${encodeURIComponent(any)}?minorversion=75`, auth).catch(() => null))?.["Item"] as Record<string, unknown> | undefined;
      if (it) ref = { Type: it["Type"] as string, IncomeAccountRef: it["IncomeAccountRef"] as { value: string }, ExpenseAccountRef: it["ExpenseAccountRef"] as { value: string } };
    }
    refCache.set(kind, ref);
    return ref;
  };
  const out: Preview = { sends: [], held: [] };
  for (const r of rows) {
    const record = await readRecord(r.kind, r.bmd_id);
    const ext = linkMaps.get(r.kind)?.get(r.bmd_id) ?? null;
    const supplierExt = r.kind === "material" && record?.supplier_id ? ((await links("supplier", [record.supplier_id])).get(record.supplier_id) ?? null) : null;
    let current: { Id: string; SyncToken: string } | null = null;
    if (ext) {
      const path = r.kind === "supplier" ? `vendor/${encodeURIComponent(ext)}` : `item/${encodeURIComponent(ext)}`;
      const body = await q.get(`${path}?minorversion=75`, auth).catch(() => null);
      const obj = body?.[r.kind === "supplier" ? "Vendor" : "Item"] as { Id?: string; SyncToken?: string } | undefined;
      if (obj?.Id && obj.SyncToken != null) current = { Id: obj.Id, SyncToken: String(obj.SyncToken) };
    }
    const plan = planSend({ outbox: r, record, link: ext ? { external_id: ext } : null, supplierLink: supplierExt ? { external_id: supplierExt } : null, current, reference: !ext && r.kind !== "supplier" && r.op !== "delete" ? await reference(r.kind) : null });
    if (plan.ok) out.sends.push(plan.send);
    else out.held.push({ outboxId: r.id, label: record?.name ?? r.label ?? "(no name)", reason: plan.reason });
  }
  return out;
}

/** Sends the planned changes. Each one is logged whether it succeeded or failed; BMD's records are never changed here. */
export async function runSends(ids?: string[], by?: string): Promise<{ sent: number; failed: number; held: number; skipped?: string }> {
  // One run at a time: the 5-minute schedule and a manual "Send now" must never send the same change twice.
  // The lock is a token so only the run that took it can release it; a run that outlives its 30-minute lease
  // cannot clear a newer run's lock. PostgREST calls never throw; they return { data, error }.
  const { data: token, error } = await admin.rpc("sync_send_lock");
  if (error) throw new Error(error.message);
  if (typeof token !== "string") return { sent: 0, failed: 0, held: 0, skipped: "Another send is running. Try again in a few minutes." };
  try {
    return await runSendsLocked(ids, by);
  } finally {
    const { error: unlockError } = await admin.rpc("sync_send_unlock", { _token: token });
    if (unlockError) console.error(`[sync] could not release the send lock: ${unlockError.message}`);
  }
}

async function runSendsLocked(ids: string[] | undefined, by: string | undefined): Promise<{ sent: number; failed: number; held: number }> {
  const { qbo } = await import("@/lib/qbo/qbo.server");
  const q = qbo();
  const auth = await q.getAccessToken();
  const preview = await previewSends(ids);
  const now = () => new Date().toISOString();
  let sent = 0, failed = 0;
  for (const h of preview.held) {
    await admin.from("sync_outbox").update({ status: "failed", error: h.reason, updated_at: now() }).eq("id", h.outboxId);
  }
  for (const s of preview.sends) {
    const path = s.target === "Vendor" ? "vendor" : "item";
    try {
      const res = await q.post(path, s.body, auth);
      const obj = res[s.target] as { Id?: string; Name?: string; DisplayName?: string } | undefined;
      const extId = obj?.Id ?? s.qboId;
      await admin.from("sync_outbox").update({ status: "sent", sent_at: now(), updated_at: now(), error: null }).eq("id", s.outboxId);
      if (extId) await admin.from("sync_links").upsert({ kind: s.kind, bmd_id: s.bmdId, system: "quickbooks", external_id: extId, external_name: s.label, synced_at: now(), last_synced: s.body }, { onConflict: "kind,bmd_id,system" });
      await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: s.kind, bmd_id: s.bmdId, external_id: extId, label: s.label, outcome: "sent", detail: { op: s.op, summary: s.summary, by: by ?? "schedule" } });
      sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("sync_outbox").update({ status: "failed", error: message.slice(0, 500), updated_at: now() }).eq("id", s.outboxId);
      await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: s.kind, bmd_id: s.bmdId, external_id: s.qboId, label: s.label, outcome: "failed", detail: { op: s.op, summary: s.summary, error: message.slice(0, 500), by: by ?? "schedule" } });
      failed++;
    }
  }
  await admin.from("sync_settings").update({ last_send_at: now() }).eq("id", 1);
  return { sent, failed, held: preview.held.length };
}
