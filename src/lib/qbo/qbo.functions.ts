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
    const { stageItem, stageVendor, QboReconnectError } = await import("./connect");
    if (!qboEnv()) return { ok: false as const, reason: "setup" as const, message: "QuickBooks is not set up yet." };
    if (!(await qboConnection())) return { ok: false as const, reason: "connect" as const, message: "Connect QuickBooks first." };
    try {
      const q = qbo();
      const auth = await q.getAccessToken();
      const [items, vendors] = await Promise.all([q.queryAll("Item", auth), q.queryAll("Vendor", auth)]);
      const stagedItems = items.map((i) => stageItem(i as never));
      const stagedVendors = vendors.map((v) => stageVendor(v as never));
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
