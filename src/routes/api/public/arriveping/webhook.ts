import { createFileRoute } from "@tanstack/react-router";

/** ArrivePing reports crew status here. The shared secret in X-Webhook-Secret is the only way in. */
export const Route = createFileRoute("/api/public/arriveping/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { applyVisitEvent, parseArrivePingEvent, secretMatches } = await import("@/lib/visits/logic");
        if (!secretMatches(request.headers.get("x-webhook-secret"), process.env["ARRIVEPING_WEBHOOK_SECRET"])) return new Response("Unauthorized", { status: 401 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "not JSON" }, { status: 400 });
        }
        const ev = parseArrivePingEvent(body);
        if (!ev) return Response.json({ ok: true, ignored: "unrecognised event" });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = supabaseAdmin as any;
        const q = admin.from("install_visits").select("id,project_id,status,crew,arriveping_job_id");
        const { data: visit } = await (ev.visitId ? q.eq("id", ev.visitId) : q.eq("arriveping_job_id", ev.jobId)).maybeSingle();
        if (!visit) return Response.json({ ok: true, ignored: "no matching visit" });
        const next = applyVisitEvent(visit, ev.status);
        if (!next) return Response.json({ ok: true, ignored: "no change" });
        const { error } = await admin.from("install_visits").update({ status: next.status, ...(ev.jobId && !visit.arriveping_job_id ? { arriveping_job_id: ev.jobId } : {}) }).eq("id", visit.id);
        // A job id already tied to another visit is a data mix-up, not something a retry will fix: answer 200 so the sender stops.
        if (error) return /duplicate|unique/i.test(error.message) ? Response.json({ ok: true, ignored: "job id belongs to another visit" }) : Response.json({ ok: false }, { status: 500 });
        const { error: logError } = await admin.from("install_visit_events").insert({ visit_id: visit.id, project_id: visit.project_id, status: next.status, note: next.note, source: "arriveping", ...(ev.at && !Number.isNaN(Date.parse(ev.at)) ? { at: ev.at } : {}) });
        return Response.json({ ok: true, status: next.status, ...(logError ? { activityLogged: false } : {}) });
      },
    },
  },
});
