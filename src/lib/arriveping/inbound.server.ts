import { EXTERNAL_SOURCE } from "./core";

/**
 * What ArrivePing tells BMD, applied to install visits. Server only. Two ways in, one set of rules:
 * - `processInbound`: a webhook delivery (an integration event, or an office alert from ArrivePing's Notifications module).
 * - `reconcileVisits`: BMD reading each open, linked work order from ArrivePing and catching its visit up, for anything a
 *   webhook missed.
 */

/** Reasons an event was set aside that a redelivery could get past. */
const RETRY_IGNORED = new Set<unknown>(["no matching visit", "unrecognised event"]);
const VISIT_COLUMNS =
  "id,project_id,status,crew,starts_at,ends_at,arriveping_job_id,arriveping_status,arriveping_assigned_to,arriveping_last_event_at";

export type InboundReply = { status: number; body: Record<string, unknown> };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // sync_events, arriveping_link and the ArrivePing visit columns are newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

/** Key for encrypting the webhook signing secret at rest. Never leaves the server. */
function linkKeyMaterial(): string {
  const k = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!k) throw new Error("Server is missing its service key");
  return `bmd-arriveping-webhook-v1|${k}`;
}

export type LinkRow = {
  subscription_id: string | null;
  webhook_url: string | null;
  secret_enc: string | null;
  events: string | null;
  connected_at: string | null;
  last_check_at: string | null;
  last_check_error: string | null;
};

export async function readLink(): Promise<LinkRow | null> {
  const db = await admin();
  const { data, error } = await db
    .from("arriveping_link")
    .select(
      "subscription_id,webhook_url,secret_enc,events,connected_at,last_check_at,last_check_error",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not read the ArrivePing link: ${error.message}`);
  return (data as LinkRow | null) ?? null;
}

export async function saveLink(
  patch: Partial<LinkRow> & { connected_by?: string | null },
): Promise<void> {
  const db = await admin();
  const { error } = await db.from("arriveping_link").upsert({ id: 1, ...patch });
  if (error) throw new Error(`Could not save the ArrivePing link: ${error.message}`);
}

export async function sealSecret(secret: string): Promise<string> {
  const { encryptToken } = await import("@/lib/ms/core");
  return encryptToken(secret, linkKeyMaterial());
}

/** The signing secret for integration webhooks, or null when BMD is not subscribed (or the stored copy can't be read). */
export async function webhookSecret(): Promise<string | null> {
  try {
    const row = await readLink();
    if (!row?.secret_enc) return null;
    const { decryptToken } = await import("@/lib/ms/core");
    return await decryptToken(row.secret_enc, linkKeyMaterial());
  } catch (error) {
    console.error("ArrivePing webhook: could not read the signing secret:", error);
    return null;
  }
}

/** Applies one webhook delivery. Only a database failure answers 500, so ArrivePing retries exactly when a retry can help. */
export async function processInbound(body: unknown): Promise<InboundReply> {
  const { applyInboundEvent, inboundEventKey, parseArrivePingEvent } =
    await import("@/lib/visits/logic");
  const { markAcked, markFailed, markIgnored, recordPending } = await import("./outbox.server");
  const done = (b: Record<string, unknown>): InboundReply => ({ status: 200, body: b });
  const ignore = async (id: string, reason: string) => {
    await markIgnored(id, reason);
    return done({ ok: true, ignored: reason });
  };
  const fail = async (id: string | null, error: string): Promise<InboundReply> => {
    console.error(`ArrivePing webhook: ${error}`);
    if (id) await markFailed(id, error);
    return { status: 500, body: { ok: false } };
  };

  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const data =
    b["data"] && typeof b["data"] === "object" ? (b["data"] as Record<string, unknown>) : null;
  const typeName = [b["event"], b["type"]].find((v) => typeof v === "string" && v.trim());
  const name = typeof typeName === "string" ? typeName.trim().slice(0, 100) : "unknown";
  // An integration event about a work order BMD did not send (a service call booked in ArrivePing) is none of BMD's business.
  if (data && name.startsWith("workorder.") && data["external_source"] !== EXTERNAL_SOURCE)
    return done({ ok: true, ignored: "not a BMD job" });

  let rowId: string | null = null;
  try {
    const db = await admin();
    const key = inboundEventKey(body);
    if (key) {
      const { data: seen } = await db
        .from("sync_events")
        .select("id,status,last_error")
        .eq("idempotency_key", key)
        .maybeSingle();
      const retryable = seen?.status === "ignored" && RETRY_IGNORED.has(seen.last_error);
      if ((seen?.status === "acked" || seen?.status === "ignored") && !retryable)
        return done({ ok: true, ignored: "duplicate" });
    }
    const record = (
      visit: { id: string; project_id: string } | null,
      eventType: string,
      externalId: string | null,
    ) =>
      recordPending({
        direction: "in",
        entity_type: "visit",
        entity_id: visit?.id ?? null,
        project_id: visit?.project_id ?? null,
        event_type: eventType,
        idempotency_key: key,
        payload: body,
        external_id: externalId,
      });

    // ArrivePing's "Send test" on BMD's subscription: proof the address, the signature and the secret all line up.
    if (name === "ping") {
      rowId = await record(null, "ping", null);
      await markAcked(rowId);
      return done({ ok: true, ping: true });
    }

    const ev = parseArrivePingEvent(body);
    if (!ev) {
      rowId = await record(null, name, null);
      return await ignore(rowId, "unrecognised event");
    }

    const q = db.from("install_visits").select(VISIT_COLUMNS);
    const { data: visit, error: findError } = await (
      ev.visitId ? q.eq("id", ev.visitId) : q.eq("arriveping_job_id", ev.jobId)
    ).maybeSingle();
    if (findError) {
      rowId = await record(null, ev.kind === "status" ? ev.status : ev.kind, ev.jobId);
      return await fail(rowId, `could not look up the visit: ${findError.message}`);
    }
    // Office alerts go out for every job in ArrivePing; one that matches no BMD visit is simply not BMD's.
    if (!visit && !data && (b["bookingId"] != null || b["booking_id"] != null))
      return done({ ok: true, ignored: "not a BMD job" });
    rowId = await record(visit ?? null, ev.kind === "status" ? ev.status : ev.kind, ev.jobId);
    if (!visit) return await ignore(rowId, "no matching visit");

    const plan = applyInboundEvent(visit, ev, new Date().toISOString());
    if (!plan.ok) return await ignore(rowId, plan.reason);
    const { error } = await db.from("install_visits").update(plan.patch).eq("id", visit.id);
    // A job id already tied to another visit is a data mix-up, not something a retry will fix: answer 200 so the sender stops.
    if (error)
      return /duplicate|unique/i.test(error.message)
        ? await ignore(rowId, "job id belongs to another visit")
        : await fail(rowId, `could not update visit ${visit.id}: ${error.message}`);
    const logError = await logActivity(db, visit, [plan.event]);
    await markAcked(rowId);
    return done({
      ok: true,
      kind: ev.kind,
      ...(ev.kind === "status" ? { status: ev.status } : {}),
      ...(logError ? { activityLogged: false } : {}),
    });
  } catch (error) {
    return await fail(rowId, error instanceof Error ? error.message : String(error));
  }
}

/** Adds the visit's activity entries. The visit is updated either way; a missing entry is reported, not retried, so the change is not applied twice. */
async function logActivity(
  db: Awaited<ReturnType<typeof admin>>,
  visit: { id: string; project_id: string },
  events: { status: string; note: string; at: string }[],
): Promise<string | null> {
  if (!events.length) return null;
  const { error } = await db.from("install_visit_events").insert(
    events.map((e) => ({
      visit_id: visit.id,
      project_id: visit.project_id,
      status: e.status,
      note: e.note,
      source: "arriveping",
      at: e.at,
    })),
  );
  if (error)
    console.error(
      `install_visit_events: could not log ${events.length} change(s) for ${visit.id}: ${error.message}`,
    );
  return error ? error.message : null;
}

/** How often an automatic check may run; "Check now" ignores it. */
export const CHECK_EVERY_MS = 2 * 60_000;
const MAX_VISITS_PER_CHECK = 40;

export type CheckResult = {
  ran: boolean;
  checked: number;
  updated: number;
  failed: number;
  error?: string;
};

/**
 * Reads each open, linked visit's work order from ArrivePing and brings the visit up to date. Visits whose window ended
 * more than a week ago are left alone. `force` skips the two-minute spacing that keeps page loads from calling ArrivePing
 * every time; the claim on last_check_at is atomic, so two pages opening at once run one check between them.
 */
export async function reconcileVisits(
  opts: { force?: boolean; projectId?: string | undefined } = {},
): Promise<CheckResult> {
  const { reconcileWithWorkOrder } = await import("@/lib/visits/logic");
  const { apFetch } = await import("./client.server");
  const { AP_PATHS } = await import("./core");
  const db = await admin();
  const now = new Date();
  const nowIso = now.toISOString();

  if (!opts.force) {
    const cutoff = new Date(now.getTime() - CHECK_EVERY_MS).toISOString();
    const { data: claimed, error } = await db
      .from("arriveping_link")
      .update({ last_check_at: nowIso })
      .eq("id", 1)
      .or(`last_check_at.is.null,last_check_at.lt.${cutoff}`)
      .select("id");
    if (error)
      return {
        ran: false,
        checked: 0,
        updated: 0,
        failed: 0,
        error: `Could not start the check: ${error.message}`,
      };
    if (!claimed?.length) return { ran: false, checked: 0, updated: 0, failed: 0 };
  } else {
    await saveLink({ last_check_at: nowIso });
  }

  const weekAgo = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
  let q = db
    .from("install_visits")
    .select(VISIT_COLUMNS)
    .not("arriveping_job_id", "is", null)
    .in("status", ["scheduled", "en_route", "arrived"])
    .gte("starts_at", weekAgo)
    .order("starts_at", { ascending: true })
    .limit(MAX_VISITS_PER_CHECK);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  const { data: visits, error: listError } = await q;
  if (listError)
    return {
      ran: true,
      checked: 0,
      updated: 0,
      failed: 0,
      error: `Could not read install visits: ${listError.message}`,
    };

  let updated = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const visit of (visits ?? []) as Array<
    { id: string; project_id: string; arriveping_job_id: string } & Record<string, string | null>
  >) {
    const res = await apFetch(
      `${AP_PATHS.workorders}/${encodeURIComponent(visit.arriveping_job_id)}`,
      { method: "GET" },
    );
    if (!res.ok) {
      failed++;
      firstError ??= res.error;
      // A key or permission problem fails every visit the same way: stop rather than call ArrivePing forty times.
      if (res.status === 401 || res.status === 403 || res.code === "not_configured") break;
      continue;
    }
    const json = res.json as Record<string, unknown> | null;
    const wo =
      json &&
      typeof json === "object" &&
      json["work_order"] &&
      typeof json["work_order"] === "object"
        ? json["work_order"]
        : json;
    const { patch, events } = reconcileWithWorkOrder(visit as never, wo, nowIso);
    if (!events.length) continue;
    const { error } = await db.from("install_visits").update(patch).eq("id", visit.id);
    if (error) {
      failed++;
      firstError ??= `Could not update a visit: ${error.message}`;
      continue;
    }
    updated++;
    await logActivity(db, visit, events);
    // The sync queue shows what the check changed, the same as a webhook would have.
    const { recordPending, markAcked } = await import("./outbox.server");
    try {
      for (const e of events) {
        const id = await recordPending({
          direction: "in",
          entity_type: "visit",
          entity_id: visit.id,
          project_id: visit.project_id,
          event_type: e.status,
          payload: { source: "check", note: e.note, work_order: wo },
          external_id: visit.arriveping_job_id,
        });
        await markAcked(id);
      }
    } catch (error) {
      console.error("ArrivePing check: could not log to sync_events:", error);
    }
  }
  const checked = (visits ?? []).length;
  await saveLink({ last_check_error: firstError ?? null }).catch(() => {});
  return { ran: true, checked, updated, failed, ...(firstError ? { error: firstError } : {}) };
}
