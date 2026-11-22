import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COOKIE = "bmd_ms_nonce";

async function allowed(sb: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> }, capability: string) {
  const { data } = await sb.rpc("has_capability", { _capability: capability });
  return data === true;
}

/** What the signed-in user needs to know about Microsoft 365: is it set up, their own mailbox, and the shared library. */
export const msStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { msEnv, connectionFor, libraryConnection } = await import("./graph.server");
    const sb = context.supabase as never;
    const [canSend, canManage] = await Promise.all([allowed(sb, "send_quotes"), allowed(sb, "manage_integrations")]);
    const configured = !!msEnv();
    const mine = configured && (canSend || canManage) ? await connectionFor(context.userId) : null;
    const lib = configured && canManage ? await libraryConnection() : null;
    return {
      configured,
      canSend,
      canManage,
      mine,
      library: lib
        ? { account_email: lib.account_email, connected_at: lib.connected_at, last_error: lib.last_error, onedrive_root_path: lib.onedrive_root_path, isMe: lib.user_id === context.userId }
        : null,
    };
  });

/** Starts the Microsoft sign-in. Returns the address to send the browser to. */
export const msConnectStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "mail" | "library" }) => {
    if (!d || (d.kind !== "mail" && d.kind !== "library")) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { getRequest, setCookie } = await import("@tanstack/react-start/server");
    const { msEnv, msKeyMaterial } = await import("./graph.server");
    const { authorizeUrl, signState } = await import("./core");
    const env = msEnv();
    if (!env) throw new Error("Microsoft 365 is not set up yet.");
    const sb = context.supabase as never;
    if (!(await allowed(sb, data.kind === "library" ? "manage_integrations" : "send_quotes"))) {
      throw new Error("You don't have permission to connect Microsoft 365.");
    }
    const nonce = crypto.randomUUID();
    // The nonce cookie ties the sign-in to this browser, so a link crafted by someone else cannot attach their mailbox here.
    setCookie(COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/ms", maxAge: 600 });
    const origin = new URL(getRequest().url).origin;
    const state = await signState({ userId: context.userId, kind: data.kind, nonce, exp: Date.now() + 600_000 }, msKeyMaterial());
    return { url: authorizeUrl({ ...env, redirectUri: `${origin}/api/ms/callback`, state }) };
  });

export const msDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { removeConnection } = await import("./graph.server");
    await removeConnection(context.userId);
    return { ok: true };
  });

/** Sends a short message from the user's own mailbox to themselves, to prove sending works. */
export const msSendTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { connectionFor, sendMailAs } = await import("./graph.server");
    const mine = await connectionFor(context.userId);
    if (!mine) return { ok: false as const, reason: "reconnect" as const, message: "Connect Outlook first." };
    return sendMailAs(context.userId, {
      to: [mine.account_email],
      subject: "BMD Projects test message",
      html: "<p>This is a test from BMD Projects. If you can read this, and it also shows in your Sent Items, quotes will send from your own mailbox.</p>",
    });
  });

export const MS_NONCE_COOKIE = COOKIE;
