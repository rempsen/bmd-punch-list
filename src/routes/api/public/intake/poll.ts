import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/intake/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["INTAKE_CRON_TOKEN"];
        const got = request.headers.get("x-intake-token") ?? "";
        if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected)))
          return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { pollMailbox } = await import("@/lib/intake.server");
        try {
          return Response.json(await pollMailbox(supabaseAdmin as never));
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
