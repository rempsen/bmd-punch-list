import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COOKIE = "bmd_qbo_nonce";

async function allowed(sb: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> }, capability: string) {
  const { data } = await sb.rpc("has_capability", { _capability: capability });
  return data === true;
}

/** Whether the app has QuickBooks credentials, whether it is connected, and to which company. */
export const qboStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { qboEnv, qboConnection } = await import("./qbo.server");
    const sb = context.supabase as never;
    const [canManage, canCatalogue] = await Promise.all([allowed(sb, "manage_integrations"), allowed(sb, "manage_catalogue")]);
    const configured = !!qboEnv();
    const connection = configured && (canManage || canCatalogue) ? await qboConnection() : null;
    return { configured, canManage, canPull: canManage || canCatalogue, connection };
  });

/** Starts the QuickBooks sign-in. Returns the address to send the browser to. */
export const qboConnectStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getRequest, setCookie } = await import("@tanstack/react-start/server");
    const { qboEnv, qboKeyMaterial } = await import("./qbo.server");
    const { qboAuthorizeUrl } = await import("./connect");
    const { signState } = await import("@/lib/ms/core");
    const env = qboEnv();
    if (!env) throw new Error("QuickBooks is not set up yet.");
    if (!(await allowed(context.supabase as never, "manage_integrations"))) throw new Error("You don't have permission to connect QuickBooks.");
    const nonce = crypto.randomUUID();
    // The nonce cookie ties the sign-in to this browser, so a link crafted by someone else cannot attach their company here.
    setCookie(COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/qbo", maxAge: 600 });
    const origin = new URL(getRequest().url).origin;
    const state = await signState({ userId: context.userId, kind: "quickbooks", nonce, exp: Date.now() + 600_000 }, qboKeyMaterial());
    return { url: qboAuthorizeUrl({ clientId: env.clientId, redirectUri: `${origin}/api/qbo/callback`, state }) };
  });

export const qboDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await allowed(context.supabase as never, "manage_integrations"))) throw new Error("You don't have permission to disconnect QuickBooks.");
    const { removeQboConnection } = await import("./qbo.server");
    await removeQboConnection();
    return { ok: true };
  });

/**
 * Reads every item and vendor from QuickBooks into the staging area and says what was found.
 * It only reads. Nothing in QuickBooks changes, and nothing in the catalogue changes until the staged records are imported.
 */
export const qboPullProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as never;
    if (!(await allowed(sb, "manage_integrations")) && !(await allowed(sb, "manage_catalogue"))) throw new Error("You don't have permission to pull from QuickBooks.");
    const { qbo, qboEnv, qboConnection, restage } = await import("./qbo.server");
    const { stageItem, stageVendor, vendorEvidence, QboReconnectError } = await import("./connect");
    if (!qboEnv()) return { ok: false as const, reason: "setup" as const, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false as const, reason: "connect" as const, message: "Connect QuickBooks first." };
    try {
      const q = qbo();
      const auth = await q.getAccessToken();
      const [items, vendors] = await Promise.all([q.queryAll("Item", auth), q.queryAll("Vendor", auth)]);
      // Three years of bills and expenses say which vendors BMD buys materials from. Reading them is optional:
      // if QuickBooks refuses, the pull still succeeds and the import simply suggests fewer suppliers.
      const since = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
      const evidence = await Promise.all([q.queryAll("Account", auth), q.queryAll("Bill", auth, `TxnDate >= '${since}'`), q.queryAll("Purchase", auth, `TxnDate >= '${since}'`)])
        .then(([accounts, bills, purchases]) => vendorEvidence([...bills, ...purchases] as never, items as never, accounts as never))
        .catch((e: unknown) => {
          console.error(`[qbo] purchase history not read: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        });
      const stagedItems = items.map((i) => stageItem(i as never));
      const stagedVendors = vendors.map((v) => stageVendor(v as never, evidence));
      await restage("Item", stagedItems);
      await restage("Vendor", stagedVendors);
      const counts: Record<string, number> = {};
      for (const s of [...stagedItems, ...stagedVendors]) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
      return { ok: true as const, counts };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, reason: e instanceof QboReconnectError ? ("connect" as const) : ("error" as const), message };
    }
  });

/** Reads every customer from QuickBooks into the staging area. Reads only; nothing in BMD or QuickBooks changes. */
export const qboPullCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as never;
    if (!(await allowed(sb, "manage_integrations")) && !(await allowed(sb, "manage_projects"))) throw new Error("You don't have permission to pull from QuickBooks.");
    const { qbo, qboEnv, qboConnection, restage } = await import("./qbo.server");
    const { stageCustomer, QboReconnectError } = await import("./connect");
    if (!qboEnv()) return { ok: false as const, reason: "setup" as const, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false as const, reason: "connect" as const, message: "Connect QuickBooks first." };
    try {
      const q = qbo();
      const auth = await q.getAccessToken();
      const customers = await q.queryAll("Customer", auth);
      const staged = customers.map((c) => stageCustomer(c as never, customers as never));
      await restage("Customer", staged);
      const clients = staged.filter((s) => s.kind === "client").length;
      return { ok: true as const, clients, jobs: staged.length - clients };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false as const, reason: e instanceof QboReconnectError ? ("connect" as const) : ("error" as const), message };
    }
  });

/**
 * Turns the staged QuickBooks customers into BMD clients. With `dryRun` it only says what would happen.
 * BMD is the centre of truth: a client BMD already has keeps its details and only gains the QuickBooks id.
 */
export const qboImportClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { dryRun: boolean }) => ({ dryRun: !!d?.dryRun }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as never;
    if (!(await allowed(sb, "manage_projects"))) throw new Error("You don't have permission to change clients.");
    const { stagedClients, applyClientPlan } = await import("./qbo.server");
    const { planQboClientImport } = await import("@/lib/clients/import");
    const staged = await stagedClients();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error } = await (context.supabase as any).from("clients").select("id,name,qbo_customer_id");
    if (error) throw new Error(error.message);
    const plan = planQboClientImport(staged as never, existing ?? []);
    const summary = { staged: staged.length, inserts: plan.inserts.length, links: plan.links.length, unchanged: plan.unchanged, skippedInactive: plan.skippedInactive, sample: plan.inserts.slice(0, 8).map((c) => c.name), linkSample: plan.links.slice(0, 8).map((l) => l.name) };
    if (data.dryRun) return { ...summary, created: 0, linked: 0 };
    const r = await applyClientPlan(plan, context.userId);
    return { ...summary, ...r };
  });
