import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/companycam/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifySignature, webhookSecret, handleWebhook, log } = await import("@/lib/companycam.server");
        const admin = supabaseAdmin as never;
        const secret = await webhookSecret(admin);
        const sig = request.headers.get("x-companycam-signature") ?? request.headers.get("x-signature");
        if (!secret || !(await verifySignature(body, sig, secret))) return new Response("Unauthorized", { status: 401 });
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(body);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        try {
          await handleWebhook(admin, evt as never);
        } catch (e) {
          await log(admin, { direction: "in", entity: `webhook:${String(evt["type"] ?? "")}`, status: "error", error: (e as Error).message });
        }
        return new Response("ok");
      },
    },
  },
});
