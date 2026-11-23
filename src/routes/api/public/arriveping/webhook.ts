import { createFileRoute } from "@tanstack/react-router";

/**
 * ArrivePing reports assignment, rescheduling and crew status here, two ways:
 * - Integration webhooks (Settings → Integrations → ArrivePing → Connect), signed in X-ArrivePing-Signature with the
 *   secret BMD received when it subscribed.
 * - Office alerts from ArrivePing's Notifications module, carrying the shared secret in X-Webhook-Secret.
 * A delivery with neither is refused. What happens next is in processInbound (src/lib/arriveping/inbound.server.ts).
 */
export const Route = createFileRoute("/api/public/arriveping/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const signature = request.headers.get("x-arriveping-signature");
        let allowed = false;
        if (signature) {
          const { webhookSecret } = await import("@/lib/arriveping/inbound.server");
          const { verifyArrivePingSignature } = await import("@/lib/arriveping/core");
          const secret = await webhookSecret();
          allowed = secret !== null && (await verifyArrivePingSignature(secret, raw, signature));
        } else {
          const { secretMatches } = await import("@/lib/visits/logic");
          allowed = secretMatches(
            request.headers.get("x-webhook-secret"),
            process.env["ARRIVEPING_WEBHOOK_SECRET"],
          );
        }
        if (!allowed) return new Response("Unauthorized", { status: 401 });

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return Response.json({ ok: false, reason: "not JSON" }, { status: 400 });
        }
        const { processInbound } = await import("@/lib/arriveping/inbound.server");
        const reply = await processInbound(body);
        return Response.json(reply.body, { status: reply.status });
      },
    },
  },
});
