import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/** Called by the 5-minute schedule. Copies newly added project documents to OneDrive. */
export const Route = createFileRoute("/api/public/onedrive/mirror")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin.from("intake_cron").select("token").eq("id", 1).maybeSingle();
        const expected = data?.token ?? "";
        const got = request.headers.get("x-intake-token") ?? "";
        if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
          return new Response("Unauthorized", { status: 401 });
        const { msEnv } = await import("@/lib/ms/graph.server");
        if (!msEnv()) return Response.json({ skipped: "Microsoft 365 is not set up" });
        try {
          const { runMirror } = await import("@/lib/ms/mirror.server");
          return Response.json(await runMirror());
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
