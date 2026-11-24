import { createFileRoute } from "@tanstack/react-router";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * The automatic takeoff's optional AI helper. The takeoff workspace (a separate bundle under /takeoff/, signed in
 * with the same BMD Projects session) posts rooms the drawings leave without a finish; this asks the app's AI
 * model which finish each gets and returns suggestions. Staff who may edit estimates only. Text only. Nothing is
 * saved here: the workspace records each suggestion as a proposal a person accepts or changes.
 */
export const Route = createFileRoute("/api/takeoff/decide-finishes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (token.split(".").length !== 3) return json(401, { error: "Sign in to BMD Projects first." });
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !key) return json(503, { error: "BMD Projects is not connected." });
        try {
          const { createClient } = await import("@supabase/supabase-js");
          // The person's own session: the capability check below runs as them, under the database's rules.
          const supabase = createClient(url, key, {
            global: {
              headers: { Authorization: `Bearer ${token}` },
              fetch: (input, init) => {
                const headers = new Headers(init?.headers);
                headers.set("apikey", key);
                return fetch(input, { ...init, headers });
              },
            },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
          if (claimsError || !claims?.claims?.sub) return json(401, { error: "Sign in to BMD Projects first." });
          const { data: allowed } = await supabase.rpc("has_capability", { _capability: "manage_estimates" });
          if (allowed !== true) return json(403, { error: "You don't have permission to run the takeoff's AI helper." });

          const { buildDecideRequest, cleanDecideInput, parseDecisions } = await import("@/lib/takeoff/decide-finishes");
          let input;
          try {
            input = cleanDecideInput(await request.json());
          } catch {
            return json(400, { error: "Invalid request" });
          }
          const { askStrongModel } = await import("@/lib/ai/model.server");
          const reply = await askStrongModel(buildDecideRequest(input));
          return json(200, { answers: parseDecisions(reply.text, input), model: reply.model });
        } catch (e) {
          // "AI is not set up", "no model at the standard", "credits have run out": said as they are, so the run can report it and carry on.
          return json(503, { error: (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200) });
        }
      },
    },
  },
});
