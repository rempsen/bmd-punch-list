import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/intake/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin.from("intake_cron").select("token").eq("id", 1).maybeSingle();
        const expected = data?.token ?? "";
        const got = request.headers.get("x-intake-token") ?? "";
        if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
          return new Response("Unauthorized", { status: 401 });
        const { pollMailbox } = await import("@/lib/intake.server");
        try {
          const mail = await pollMailbox(supabaseAdmin as never);
          // Piggyback CompanyCam backstop sync on the same 3-hourly run (no extra schedule).
          const cc = await import("@/lib/companycam.server");
          const companycam: Record<string, unknown> = {};
          if (cc.hasToken()) {
            const { data: jobs } = await supabaseAdmin.from("projects").select("id").eq("companycam_sync_enabled", true).not("companycam_project_id", "is", null);
            for (const j of jobs ?? []) companycam[j.id] = await cc.syncProject(supabaseAdmin as never, j.id).catch((e: Error) => ({ error: e.message }));
          }
          return Response.json({ ...mail, companycam });
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
