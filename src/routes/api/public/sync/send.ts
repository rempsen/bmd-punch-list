import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/** Called by the 5-minute schedule. Sends waiting catalogue changes to QuickBooks, only while the switch is on. */
export const Route = createFileRoute("/api/public/sync/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin.from("intake_cron").select("token").eq("id", 1).maybeSingle();
        const expected = data?.token ?? "";
        const got = request.headers.get("x-intake-token") ?? "";
        if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
          return new Response("Unauthorized", { status: 401 });
        const { qboEnv, qboConnection } = await import("@/lib/qbo/qbo.server");
        if (!qboEnv() || !(await qboConnection())) return Response.json({ skipped: "QuickBooks is not connected" });
        const { sendSetting, runSends } = await import("@/lib/sync/send.server");
        if (!(await sendSetting()).enabled) return Response.json({ skipped: "sending is off" });
        try {
          return Response.json(await runSends());
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
