import { createFileRoute } from "@tanstack/react-router";

const back = (origin: string, params: Record<string, string>) =>
  new Response(null, {
    status: 302,
    headers: {
      location: `${origin}/settings?${new URLSearchParams({ tab: "microsoft", ...params })}`,
      "set-cookie": "bmd_ms_nonce=; Path=/api/ms; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    },
  });

/** Microsoft sends the browser back here after sign-in. */
export const Route = createFileRoute("/api/ms/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const fail = (message: string) => back(origin, { ms: "error", message });
        try {
          if (url.searchParams.get("error")) {
            return fail(url.searchParams.get("error") === "access_denied" ? "Sign-in was cancelled." : (url.searchParams.get("error_description") ?? "Microsoft sign-in failed.").split("\n")[0]!.slice(0, 200));
          }
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state) return fail("Microsoft sign-in did not complete.");

          const { verifyState, GRAPH, SCOPES } = await import("@/lib/ms/core");
          const { msGraph, msKeyMaterial, saveConnection } = await import("@/lib/ms/graph.server");
          const payload = await verifyState(state, msKeyMaterial());
          const nonce = /(?:^|;\s*)bmd_ms_nonce=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
          if (!payload || !nonce || nonce !== payload.nonce) return fail("That sign-in link has expired. Start again from Settings.");

          const g = msGraph();
          const tokens = await g.exchangeCode(code, `${origin}/api/ms/callback`);
          const me = (await (await g.graph(tokens.accessToken, `${GRAPH}/me?$select=mail,userPrincipalName`)).json()) as { mail?: string | null; userPrincipalName?: string };
          const email = me.mail || me.userPrincipalName;
          if (!email) return fail("Microsoft did not return the mailbox address.");

          if (payload.kind === "library") {
            // Only someone who may manage integrations can become the shared library connection.
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: admin } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", payload.userId);
            const { data: perms } = await supabaseAdmin.from("role_permissions").select("role").eq("capability", "manage_integrations").eq("allowed", true);
            const { data: mem } = await supabaseAdmin.from("project_members").select("role").eq("user_id", payload.userId);
            const ok = new Set((perms ?? []).map((p) => p.role as string));
            const roles = [...(admin ?? []), ...(mem ?? [])].map((r) => r.role as string);
            if (!roles.some((r) => r === "super_admin" || r === "bmd_admin" || ok.has(r))) return fail("You don't have permission to set the library connection.");
          }
          await saveConnection({ user_id: payload.userId, account_email: email, refresh_token_enc: tokens.refreshTokenEnc, scopes: SCOPES.join(" "), library: payload.kind === "library" });
          return back(origin, { ms: "connected" });
        } catch (e) {
          // Microsoft's own wording (an AADSTS code and a sentence) says what to fix and holds nothing secret.
          const reason = ((e as Error).message || "").split("\n")[0]!.replace(/Trace ID.*$/i, "").slice(0, 160);
          console.error("[ms callback]", reason);
          return fail(`Could not finish connecting Microsoft 365. ${reason}`.trim());
        }
      },
    },
  },
});
