import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createQbo, type QboEnv, type QboStore } from "./connect";

/** qbo_connection has no browser access; the service-role client is the only way in. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as any;
const table = () => admin.from("qbo_connection");

/** The app's own QuickBooks credentials, set through the secure secret form. Null until they exist. */
export function qboEnv(): QboEnv | null {
  const clientId = process.env["QBO_CLIENT_ID"];
  const clientSecret = process.env["QBO_CLIENT_SECRET"];
  return clientId && clientSecret ? { clientId, clientSecret, sandbox: process.env["QBO_ENVIRONMENT"] === "sandbox" } : null;
}

/** Key for encrypting the refresh token and signing the sign-in state. Never leaves the server. */
export function qboKeyMaterial(): string {
  const k = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!k) throw new Error("Server is missing its service key");
  return `bmd-qbo-v1|${k}`;
}

const store: QboStore = {
  get: async () => (await table().select("realm_id,refresh_token_enc").eq("id", 1).maybeSingle()).data ?? null,
  saveToken: async (refreshTokenEnc) => void (await table().update({ refresh_token_enc: refreshTokenEnc }).eq("id", 1)),
  setError: async (message) => void (await table().update({ last_error: message }).eq("id", 1)),
};

export function qbo() {
  const env = qboEnv();
  if (!env) throw new Error("QuickBooks is not set up yet.");
  // The host's fetch must be called bare; handing it over as a property makes it throw "Illegal invocation".
  return createQbo({ fetch: (input, init) => fetch(input, init), env, store, keyMaterial: qboKeyMaterial() });
}

export type QboConnectionInfo = { company_name: string | null; connected_at: string; last_error: string | null; last_pull_at: string | null };
export async function qboConnection(): Promise<QboConnectionInfo | null> {
  return (await table().select("company_name,connected_at,last_error,last_pull_at").eq("id", 1).maybeSingle()).data ?? null;
}

export async function saveQboConnection(row: { realm_id: string; company_name: string | null; refresh_token_enc: string; connected_by: string }) {
  const { error } = await table().upsert({ id: 1, ...row, connected_at: new Date().toISOString(), last_error: null });
  if (error) throw new Error(error.message);
}

export async function removeQboConnection() {
  await table().delete().eq("id", 1);
}

/** Who may connect or disconnect QuickBooks: someone with the manage-integrations capability. Checked with the service client for the callback, which has no session. */
export async function mayManageIntegrations(userId: string): Promise<boolean> {
  // Same rule as the app's own checks: company level and job roles, and never for a deactivated person.
  const { data, error } = await admin.rpc("user_has_capability", { _user: userId, _capability: "manage_integrations" });
  if (error) throw new Error(error.message);
  return data === true;
}

/** Replaces the staged copy of one kind of QuickBooks record. Staging is a copy for review: nothing in the catalogue changes. */
export async function restage(entity: string, rows: { external_id: string; kind: string; name: string; data: Record<string, unknown> }[]) {
  const now = new Date().toISOString();
  const del = await admin.from("sync_staging").delete().eq("system", "quickbooks").eq("entity", entity);
  if (del.error) throw new Error(del.error.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("sync_staging").insert(rows.slice(i, i + 500).filter((r) => r.external_id).map((r) => ({ system: "quickbooks", entity, ...r, pulled_at: now })));
    if (error) throw new Error(error.message);
  }
  await table().update({ last_pull_at: now }).eq("id", 1);
}

// ── Clients from QuickBooks customers ───────────────────────────────────────────────────────────────────────────
/** The staged top-level customers, read with the service role (staging has no browser write access). */
export async function stagedClients(): Promise<{ external_id: string; name: string; data: Record<string, unknown> }[]> {
  const { data, error } = await admin.from("sync_staging").select("external_id,name,data").eq("system", "quickbooks").eq("entity", "Customer").eq("kind", "client").limit(10000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Creates the planned clients and attaches QuickBooks ids to the planned links. BMD's existing values are never changed. */
export async function applyClientPlan(plan: import("@/lib/clients/import").QboClientPlan, userId: string): Promise<{ created: number; linked: number }> {
  const log: Record<string, unknown>[] = [];
  const links: Record<string, unknown>[] = [];
  let created = 0;
  for (let i = 0; i < plan.inserts.length; i += 200) {
    const batch = plan.inserts.slice(i, i + 200);
    const { data: rows, error } = await admin.from("clients").insert(batch.map((c) => ({ name: c.name, email: c.email, phone: c.phone, billing_address: c.billingAddress, qbo_customer_id: c.qboId }))).select("id,name,qbo_customer_id");
    if (error) throw new Error(error.message);
    const byName = new Map((rows ?? []).map((r: { id: string; name: string }) => [r.name, r.id]));
    const contacts = batch.filter((c) => c.contactName && byName.has(c.name)).map((c) => ({ client_id: byName.get(c.name)!, name: c.contactName, email: c.email, phone_office: c.phone, is_primary: true }));
    if (contacts.length) {
      const { error: cErr } = await admin.from("client_contacts").insert(contacts);
      if (cErr) throw new Error(cErr.message);
    }
    for (const r of rows ?? []) {
      created++;
      links.push({ kind: "client", bmd_id: r.id, system: "quickbooks", external_id: r.qbo_customer_id, external_name: r.name, synced_at: new Date().toISOString() });
      log.push({ direction: "in", system: "quickbooks", kind: "client", bmd_id: r.id, external_id: r.qbo_customer_id, label: r.name, outcome: "applied", detail: { by: userId, how: "created from QuickBooks customer" } });
    }
  }
  for (const l of plan.links) {
    const { error } = await admin.from("clients").update({ qbo_customer_id: l.qboId }).eq("id", l.id).is("qbo_customer_id", null);
    if (error) throw new Error(error.message);
    links.push({ kind: "client", bmd_id: l.id, system: "quickbooks", external_id: l.qboId, external_name: l.name, synced_at: new Date().toISOString() });
    log.push({ direction: "in", system: "quickbooks", kind: "client", bmd_id: l.id, external_id: l.qboId, label: l.name, outcome: "bmd_kept", detail: { by: userId, how: "same name: linked, BMD's details kept" } });
  }
  if (links.length) {
    const { error } = await admin.from("sync_links").upsert(links, { onConflict: "kind,bmd_id,system" });
    if (error) throw new Error(error.message);
  }
  if (log.length) {
    const { error } = await admin.from("sync_log").insert(log);
    if (error) throw new Error(error.message);
  }
  return { created, linked: plan.links.length };
}
