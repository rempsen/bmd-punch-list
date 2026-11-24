import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Whether Microsoft 365 is set up here and whether this person has let the app write to their Outlook calendar. */
export const calendarOutlookStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { outlookState } = await import("./calendar.server");
    const { configured, account_email, consented } = await outlookState(context.userId);
    return { configured, account_email, consented };
  });

/**
 * "Connect my Outlook calendar". If the person has already allowed the calendar, syncing is simply switched on.
 * Otherwise this returns the Microsoft sign-in address, which asks for the calendar on top of what they already allowed.
 */
export const calendarOutlookConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getRequest, setCookie } = await import("@tanstack/react-start/server");
    const { msEnv, msKeyMaterial } = await import("@/lib/ms/graph.server");
    const { MS_NONCE_COOKIE } = await import("@/lib/ms/ms.functions");
    const { SCOPES, authorizeUrl, signState } = await import("@/lib/ms/core");
    const { outlookState, setOutlookEnabled } = await import("./calendar.server");
    const { connectScopes } = await import("./outlook");
    const env = msEnv();
    if (!env) throw new Error("Microsoft 365 is not set up yet.");
    const state = await outlookState(context.userId);
    if (state.consented) {
      await setOutlookEnabled(context.userId, true);
      return { connected: true as const, url: null };
    }
    const { data: maySend } = await (context.supabase as unknown as { rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }).rpc("has_capability", { _capability: "send_quotes" });
    const scopes = connectScopes(state.scopes, maySend === true, SCOPES);
    const nonce = crypto.randomUUID();
    // Same guard as the mail sign-in: the nonce cookie ties the sign-in to this browser.
    setCookie(MS_NONCE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/ms", maxAge: 600 });
    const origin = new URL(getRequest().url).origin;
    const signed = await signState({ userId: context.userId, kind: "calendar", nonce, exp: Date.now() + 600_000, scopes }, msKeyMaterial());
    return {
      connected: false as const,
      url: authorizeUrl({ ...env, redirectUri: `${origin}/api/ms/callback`, state: signed, scopes, ...(state.account_email ? { loginHint: state.account_email } : {}) }),
    };
  });

/** Stops writing visits to Outlook. Events already there are left alone. */
export const calendarOutlookStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { setOutlookEnabled } = await import("./calendar.server");
    await setOutlookEnabled(context.userId, false);
    return { ok: true };
  });

/** "Sync my calendar now" (force) and the quiet check when Scheduling is opened (not forced: at most every 15 minutes). */
export const calendarSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { force: boolean }) => ({ force: d?.force === true }))
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { syncOutlookFor } = await import("./calendar.server");
    return syncOutlookFor(context.userId, { force: data.force, requestUrl: getRequest().url });
  });
