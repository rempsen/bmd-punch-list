import { createFileRoute } from "@tanstack/react-router";

const back = (origin: string, params: Record<string, string>) =>
  new Response(null, {
    status: 302,
    headers: {
      location: `${origin}/settings?${new URLSearchParams({ tab: "sync", ...params })}`,
      "set-cookie": "bmd_qbo_nonce=; Path=/api/qbo; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    },
  });

/** QuickBooks sends the browser back here after sign-in, with the company (realm) that was chosen. */
export const Route = createFileRoute("/api/qbo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const fail = (message: string) => back(origin, { qbo: "error", message });
        try {
          if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "Sign-in was cancelled." : "QuickBooks sign-in failed.");
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          const realmId = url.searchParams.get("realmId");
          if (!code || !state || !realmId || !/^\d{1,30}$/.test(realmId)) return fail("QuickBooks sign-in did not complete.");

          const { verifyState } = await import("@/lib/ms/core");
          const { qbo, qboKeyMaterial, saveQboConnection, mayManageIntegrations } = await import("@/lib/qbo/qbo.server");
          const payload = await verifyState(state, qboKeyMaterial());
          const nonce = /(?:^|;\s*)bmd_qbo_nonce=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
          if (!payload || payload.kind !== "quickbooks" || !nonce || nonce !== payload.nonce) return fail("That sign-in link has expired. Start again from Company settings.");
          if (!(await mayManageIntegrations(payload.userId))) return fail("You don't have permission to connect QuickBooks.");

          const q = qbo();
          const tokens = await q.exchangeCode(code, `${origin}/api/qbo/callback`);
          const company = await q.companyName({ accessToken: tokens.accessToken, realmId }).catch(() => null);
          await saveQboConnection({ realm_id: realmId, company_name: company, refresh_token_enc: tokens.refreshTokenEnc, connected_by: payload.userId });
          return back(origin, { qbo: "connected" });
        } catch (e) {
          const reason = ((e as Error).message || "").split("\n")[0]!.slice(0, 160);
          console.error("[qbo callback]", reason);
          return fail(`Could not finish connecting QuickBooks. ${reason}`.trim());
        }
      },
    },
  },
});
