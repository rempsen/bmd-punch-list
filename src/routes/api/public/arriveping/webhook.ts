import { createFileRoute } from "@tanstack/react-router";

/** Reasons an event was set aside that a redelivery could get past. */
const RETRY_IGNORED = new Set<unknown>(["no matching visit", "unrecognised event"]);

/**
 * ArrivePing reports crew status, assignment and rescheduling here. The shared secret in X-Webhook-Secret is the only way in.
 * Every delivery that gets past the secret and parses as JSON is logged in sync_events before anything changes, and its row is
 * closed out as acked, ignored or failed. Only a database failure answers 500, so ArrivePing retries exactly when a retry can help.
 */
export const Route = createFileRoute("/api/public/arriveping/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { applyInboundEvent, inboundEventKey, parseArrivePingEvent, secretMatches } =
          await import("@/lib/visits/logic");
        if (
          !secretMatches(
            request.headers.get("x-webhook-secret"),
            process.env["ARRIVEPING_WEBHOOK_SECRET"],
          )
        )
          return new Response("Unauthorized", { status: 401 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "not JSON" }, { status: 400 });
        }
        const { markAcked, markFailed, markIgnored, recordPending } =
          await import("@/lib/arriveping/outbox.server");
        const ignore = async (id: string, reason: string) => {
          await markIgnored(id, reason);
          return Response.json({ ok: true, ignored: reason });
        };
        const fail = async (id: string | null, error: string) => {
          console.error(`ArrivePing webhook: ${error}`);
          if (id) await markFailed(id, error);
          return Response.json({ ok: false }, { status: 500 });
        };

        let rowId: string | null = null;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const admin = supabaseAdmin as any;
          // A redelivery of an event already applied or set aside changes nothing. One still pending or failed is tried again,
          // and so is one set aside only because BMD could not place it then: the visit may have been linked since.
          const key = inboundEventKey(body);
          if (key) {
            const { data: seen } = await admin
              .from("sync_events")
              .select("id,status,last_error")
              .eq("idempotency_key", key)
              .maybeSingle();
            const retryable = seen?.status === "ignored" && RETRY_IGNORED.has(seen.last_error);
            if ((seen?.status === "acked" || seen?.status === "ignored") && !retryable)
              return Response.json({ ok: true, ignored: "duplicate" });
          }
          const ev = parseArrivePingEvent(body);
          const record = (visit: { id: string; project_id: string } | null, eventType: string) =>
            recordPending({
              direction: "in",
              entity_type: "visit",
              entity_id: visit?.id ?? null,
              project_id: visit?.project_id ?? null,
              event_type: eventType,
              idempotency_key: key,
              payload: body,
              external_id: ev?.jobId ?? null,
            });
          if (!ev) {
            const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
            const name = [b["event"], b["type"]].find((v) => typeof v === "string" && v.trim());
            rowId = await record(
              null,
              typeof name === "string" ? name.trim().slice(0, 100) : "unknown",
            );
            return await ignore(rowId, "unrecognised event");
          }

          const q = admin
            .from("install_visits")
            .select(
              "id,project_id,status,crew,starts_at,ends_at,arriveping_job_id,arriveping_status,arriveping_assigned_to,arriveping_last_event_at",
            );
          const { data: visit, error: findError } = await (
            ev.visitId ? q.eq("id", ev.visitId) : q.eq("arriveping_job_id", ev.jobId)
          ).maybeSingle();
          rowId = await record(visit ?? null, ev.kind === "status" ? ev.status : ev.kind);
          if (findError)
            return await fail(rowId, `could not look up the visit: ${findError.message}`);
          if (!visit) return await ignore(rowId, "no matching visit");

          const plan = applyInboundEvent(visit, ev, new Date().toISOString());
          if (!plan.ok) return await ignore(rowId, plan.reason);
          const { error } = await admin
            .from("install_visits")
            .update(plan.patch)
            .eq("id", visit.id);
          // A job id already tied to another visit is a data mix-up, not something a retry will fix: answer 200 so the sender stops.
          if (error)
            return /duplicate|unique/i.test(error.message)
              ? await ignore(rowId, "job id belongs to another visit")
              : await fail(rowId, `could not update visit ${visit.id}: ${error.message}`);
          const { error: logError } = await admin.from("install_visit_events").insert({
            visit_id: visit.id,
            project_id: visit.project_id,
            status: plan.event.status,
            note: plan.event.note,
            source: "arriveping",
            at: plan.event.at,
          });
          // The visit is updated either way; a missing activity entry is reported, not retried, so the change is not applied twice.
          if (logError)
            console.error(
              `install_visit_events: could not log "${plan.event.note}" for ${visit.id}: ${logError.message}`,
            );
          await markAcked(rowId);
          return Response.json({
            ok: true,
            kind: ev.kind,
            ...(ev.kind === "status" ? { status: ev.status } : {}),
            ...(logError ? { activityLogged: false } : {}),
          });
        } catch (error) {
          return await fail(rowId, error instanceof Error ? error.message : String(error));
        }
      },
    },
  },
});
