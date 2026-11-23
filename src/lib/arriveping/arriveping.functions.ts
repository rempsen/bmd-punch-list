import { STALE_PENDING_MS } from "./core";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PushCancelOutcome, PushCreateOutcome } from "./push";

/**
 * ArrivePing server functions. The only thing these throw is "Not allowed": anything that goes wrong with ArrivePing
 * or the database comes back as a value, and every call to ArrivePing is logged in sync_events before it is made.
 */

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> };

async function allowed(sb: Rpc, capability: string) {
  const { data } = await sb.rpc("has_capability", { _capability: capability });
  return data === true;
}

async function requireAny(sb: Rpc, ...capabilities: string[]) {
  const results = await Promise.all(capabilities.map((c) => allowed(sb, c)));
  if (!results.some(Boolean)) throw new Error("Not allowed");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // sync_events and the ArrivePing visit columns are newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

const VISIT_NOT_FOUND = "Install visit not found";

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const visitIdInput = (d: { visitId: string }) => {
  if (!d || typeof d.visitId !== "string" || d.visitId.trim() === "")
    throw new Error("Invalid request");
  return { visitId: d.visitId.trim() };
};

const idInput = (d: { id: string }) => {
  if (!d || typeof d.id !== "string" || d.id.trim() === "") throw new Error("Invalid request");
  return { id: d.id.trim() };
};

type VisitRow = {
  id: string;
  project_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  crew: string | null;
  notes: string | null;
  site_contact: string | null;
  arriveping_job_id: string | null;
};

/** The visit and its project, or a sentence saying why not. */
async function loadVisit(
  visitId: string,
): Promise<{ visit: VisitRow; project: import("./core").ProjectForPush } | { error: string }> {
  const db = await admin();
  const { data: visit, error } = await db
    .from("install_visits")
    .select("id,project_id,status,starts_at,ends_at,crew,notes,site_contact,arriveping_job_id")
    .eq("id", visitId)
    .maybeSingle();
  if (error) return { error: `Could not load the install visit: ${error.message}` };
  if (!visit) return { error: VISIT_NOT_FOUND };
  const { data: p, error: pError } = await db
    .from("projects")
    .select("id,name,project_number,address,street,city,province,postal_code,client_id,client_name")
    .eq("id", visit.project_id)
    .maybeSingle();
  if (pError) return { error: `Could not load the project: ${pError.message}` };
  if (!p) return { error: "Project not found" };
  return {
    visit,
    project: {
      id: p.id,
      name: p.name,
      number: p.project_number,
      address: p.address,
      client: p.client_name,
      client_id: p.client_id,
      street: p.street,
      city: p.city,
      province: p.province,
      postal_code: p.postal_code,
    },
  };
}

/** Records the visit's activity log entry. A failure here is logged; the sync itself already succeeded. */
async function logVisitEvent(
  visit: { id: string; project_id: string },
  status: string,
  note: string,
) {
  try {
    const db = await admin();
    const { error } = await db
      .from("install_visit_events")
      .insert({ visit_id: visit.id, project_id: visit.project_id, status, note, source: "sync" });
    if (error)
      console.error(
        `install_visit_events: could not log "${note}" for ${visit.id}: ${error.message}`,
      );
  } catch (error) {
    console.error(`install_visit_events: could not log "${note}" for ${visit.id}:`, error);
  }
}

/**
 * Links a visit to the work order ArrivePing created and closes out the log row. If the link cannot be made, the row is
 * marked failed with the work order id kept in external_id, so a retry re-links it instead of sending again.
 */
async function linkVisit(
  eventId: string,
  visit: { id: string; project_id: string },
  jobId: string,
  key: string,
): Promise<PushCreateOutcome> {
  const { markFailed, markSent } = await import("./outbox.server");
  try {
    const db = await admin();
    const { data: linked, error: linkError } = await db
      .from("install_visits")
      .update({ arriveping_job_id: jobId, arriveping_status: "scheduled" })
      .eq("id", visit.id)
      .is("arriveping_job_id", null)
      .select("id");
    if (linkError || !linked?.length) {
      const why = linkError
        ? linkError.message
        : "the visit was linked to another work order meanwhile";
      const error = `Sent to ArrivePing as work order ${jobId}, but could not link it to the visit: ${why}`;
      await markFailed(eventId, error, jobId);
      return { outcome: "failed", error, key };
    }
    await markSent(eventId, jobId);
    await logVisitEvent(visit, "scheduled", `Sent to ArrivePing (work order ${jobId})`);
    return { outcome: "sent", jobId, key };
  } catch (e) {
    const error = `Sent to ArrivePing as work order ${jobId}, but could not link it to the visit: ${message(e)}`;
    await markFailed(eventId, error, jobId);
    return { outcome: "failed", error, key };
  }
}

/** The BMD client a project belongs to: its linked client, or else the one whose name matches the project's client name. */
async function loadClient(project: import("./core").ProjectForPush): Promise<{ client: import("./core").ClientForPush; linkedId: string | null } | { error: string }> {
  const db = await admin();
  const cols = "id,name,email,phone,billing_address";
  let client: import("./core").ClientForPush | null = null;
  if (project.client_id) {
    const { data, error } = await db.from("clients").select(cols).eq("id", project.client_id).maybeSingle();
    if (error) return { error: `Could not load the client: ${error.message}` };
    client = data;
  } else if (project.client?.trim()) {
    // Older projects carry only the client's name. Names are unique (case and spaces ignored), so an exact match is safe.
    const want = project.client.trim().toLowerCase();
    const escaped = project.client.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data, error } = await db.from("clients").select(cols).ilike("name", escaped).limit(5);
    if (error) return { error: `Could not load the client: ${error.message}` };
    client = ((data ?? []) as import("./core").ClientForPush[]).find((c) => c.name.trim().toLowerCase() === want) ?? null;
  }
  const label = project.number ? `${project.number} ${project.name}` : project.name;
  if (!client) return { error: `${label} has no client record, and ArrivePing needs one. Pick the project's client under Overview → Details → Edit, then send again.` };
  const { data: link, error } = await db
    .from("sync_links")
    .select("external_id")
    .eq("kind", "client")
    .eq("system", "arriveping")
    .eq("bmd_id", client.id)
    .maybeSingle();
  if (error) return { error: `Could not read the client's ArrivePing link: ${error.message}` };
  return { client, linkedId: link?.external_id ?? null };
}

/** Remembers which ArrivePing client a BMD client is, and logs it on the Sync tab. Null on success, else why not. */
async function saveClientLink(client: import("./core").ClientForPush, apClientId: string, via: string): Promise<string | null> {
  const db = await admin();
  const { error } = await db.from("sync_links").insert({
    kind: "client",
    bmd_id: client.id,
    system: "arriveping",
    external_id: apClientId,
    external_name: client.name,
    synced_at: new Date().toISOString(),
  });
  if (error && error.code === "23505") {
    // Already linked: the same pair (a race between two pushes) is fine; any other pairing is not.
    const [{ data: byExternal }, { data: byBmd }] = await Promise.all([
      db.from("sync_links").select("bmd_id,external_id").eq("kind", "client").eq("system", "arriveping").eq("external_id", apClientId).maybeSingle(),
      db.from("sync_links").select("bmd_id,external_id").eq("kind", "client").eq("system", "arriveping").eq("bmd_id", client.id).maybeSingle(),
    ]);
    if (byExternal && byExternal.bmd_id !== client.id)
      return `ArrivePing client ${apClientId} is already linked to another BMD client. Two BMD clients may share an email; merge them or give "${client.name}" its own email, then send again.`;
    if (byBmd && byBmd.external_id !== apClientId)
      return `"${client.name}" is already linked to ArrivePing client ${byBmd.external_id}, not ${apClientId}. Check the client in ArrivePing before sending again.`;
  } else if (error) {
    return `Could not save the client's ArrivePing link: ${error.message}`;
  }
  const { error: logError } = await db
    .from("sync_log")
    .insert({ direction: "out", system: "arriveping", kind: "client", bmd_id: client.id, external_id: apClientId, label: client.name, outcome: "sent", detail: { via } });
  // The link is saved; a missing history line is not worth failing the push for.
  if (logError) console.error("[arriveping] could not log the client link", logError.message);
  return null;
}

/**
 * Sends a visit to ArrivePing as a work order: logs it as pending, calls ArrivePing, then marks the log sent or failed.
 * On success the visit is linked to the work order. If an earlier attempt already got a work order back, that one is
 * linked and ArrivePing is not called again.
 */
async function runPushCreate(
  visitId: string,
  existingKey?: string | null,
): Promise<PushCreateOutcome> {
  const { idempotencyKey, workOrderPayload } = await import("./core");
  const key = existingKey ?? idempotencyKey("create", visitId);
  const loaded = await loadVisit(visitId);
  if ("error" in loaded) return { outcome: "failed", error: loaded.error, key };
  const { visit, project } = loaded;
  if (visit.arriveping_job_id) return { outcome: "skipped", reason: "already linked" };
  // Only a visit that is still scheduled may be sent: another tab may have completed or cancelled it since the button was drawn.
  if (visit.status !== "scheduled")
    return { outcome: "failed", error: `The visit is ${visit.status}, so it was not sent to ArrivePing.`, key };

  const db = await admin();
  const { data: earlier } = await db
    .from("sync_events")
    .select("id,status,external_id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (earlier?.external_id && earlier.status !== "sent" && earlier.status !== "acked") {
    return linkVisit(earlier.id, visit, earlier.external_id, key);
  }

  const { recordPending, markFailed, markIgnored } = await import("./outbox.server");
  let eventId: string;
  try {
    eventId = await recordPending({
      direction: "out",
      entity_type: "visit",
      entity_id: visit.id,
      project_id: visit.project_id,
      event_type: "create",
      idempotency_key: key,
      payload: workOrderPayload(visit, project),
    });
  } catch (error) {
    // Without a log row a failure could not be shown or retried, so ArrivePing is not called.
    return { outcome: "failed", error: message(error), key };
  }

  let jobId: string | undefined;
  try {
    const { apFetch } = await import("./client.server");
    const { ensureArrivePingClient, pushVisitCreate } = await import("./push");
    const { visitPushProblem } = await import("./core");
    const problem = visitPushProblem(visit, project);
    if (problem) {
      await markFailed(eventId, problem);
      return { outcome: "failed", error: problem, key };
    }
    // ArrivePing files every work order under a client: find or create it first.
    const loadedClient = await loadClient(project);
    if ("error" in loadedClient) {
      await markFailed(eventId, loadedClient.error);
      return { outcome: "failed", error: loadedClient.error, key };
    }
    const ensured = await ensureArrivePingClient({ fetchJson: apFetch, client: loadedClient.client, linkedId: loadedClient.linkedId });
    if (ensured.outcome === "failed") {
      await markFailed(eventId, ensured.error);
      return { outcome: "failed", error: ensured.error, key };
    }
    if (ensured.via !== "linked") {
      const linkError = await saveClientLink(loadedClient.client, ensured.clientId, ensured.via);
      if (linkError) {
        await markFailed(eventId, linkError);
        return { outcome: "failed", error: linkError, key };
      }
    }
    const result = await pushVisitCreate({ fetchJson: apFetch, visit, project, clientId: ensured.clientId, existingKey: key });
    if (result.outcome === "failed") {
      await markFailed(eventId, result.error);
      return result;
    }
    if (result.outcome === "skipped") {
      // Only reachable if the visit was linked between our read and the call; nothing was sent.
      await markIgnored(eventId, "already linked");
      return result;
    }
    jobId = result.jobId;
    return await linkVisit(eventId, visit, result.jobId, result.key);
  } catch (error) {
    const text = `Unexpected error sending to ArrivePing: ${message(error)}`;
    await markFailed(eventId, text, jobId);
    return { outcome: "failed", error: text, key };
  }
}

/** Re-links a work order ArrivePing already created. Never calls ArrivePing. */
async function runRelink(
  eventId: string,
  visitId: string,
  jobId: string,
  key: string,
): Promise<RetryOutcome> {
  const { markIgnored, markSent } = await import("./outbox.server");
  const db = await admin();
  const { data: visit, error } = await db
    .from("install_visits")
    .select("id,project_id,arriveping_job_id")
    .eq("id", visitId)
    .maybeSingle();
  if (error)
    return { outcome: "failed", error: `Could not load the install visit: ${error.message}`, key };
  if (!visit) {
    await markIgnored(eventId, "the install visit no longer exists");
    return { outcome: "ignored", reason: "the install visit no longer exists" };
  }
  if (visit.arriveping_job_id === jobId) {
    await markSent(eventId, jobId);
    return { outcome: "sent", jobId, key };
  }
  if (visit.arriveping_job_id) {
    await markIgnored(
      eventId,
      `the visit is linked to work order ${visit.arriveping_job_id}, not ${jobId}`,
    );
    return { outcome: "skipped", reason: "already linked" };
  }
  return linkVisit(eventId, visit, jobId, key);
}

/** Asks ArrivePing to cancel the visit's work order, logged the same way as a send. The job id is kept so the webhook can still match the visit. */
async function runCancel(visitId: string): Promise<PushCancelOutcome> {
  const { idempotencyKey } = await import("./core");
  const key = idempotencyKey("cancel", visitId);
  const db = await admin();
  const { data: visit, error } = await db
    .from("install_visits")
    .select("id,project_id,arriveping_job_id,arriveping_status")
    .eq("id", visitId)
    .maybeSingle();
  if (error)
    return { outcome: "failed", error: `Could not load the install visit: ${error.message}`, key };
  if (!visit) return { outcome: "failed", error: VISIT_NOT_FOUND, key };
  if (!visit.arriveping_job_id) return { outcome: "skipped", reason: "not linked" };
  if (visit.arriveping_status === "cancel_requested")
    return { outcome: "skipped", reason: "already requested" };

  const { recordPending, markFailed, markSent } = await import("./outbox.server");
  let eventId: string;
  try {
    eventId = await recordPending({
      direction: "out",
      entity_type: "visit",
      entity_id: visit.id,
      project_id: visit.project_id,
      event_type: "cancel",
      idempotency_key: key,
      external_id: visit.arriveping_job_id,
      payload: { job_id: visit.arriveping_job_id },
    });
  } catch (e) {
    return { outcome: "failed", error: message(e), key };
  }

  try {
    const { apFetch } = await import("./client.server");
    const { pushVisitCancel } = await import("./push");
    const result = await pushVisitCancel({ fetchJson: apFetch, visit, existingKey: key });
    if (result.outcome === "failed") await markFailed(eventId, result.error);
    if (result.outcome !== "sent") return result;
    await markSent(eventId, result.jobId);
    const { error: statusError } = await db
      .from("install_visits")
      .update({ arriveping_status: "cancel_requested" })
      .eq("id", visit.id);
    // The cancel reached ArrivePing; pressing again re-sends with the same key, which ArrivePing treats as one cancel.
    if (statusError)
      console.error(
        `install_visits ${visit.id}: could not mark cancel_requested: ${statusError.message}`,
      );
    await logVisitEvent(
      visit,
      "cancelled",
      `Cancel sent to ArrivePing (work order ${result.jobId})`,
    );
    return result;
  } catch (e) {
    const text = `Unexpected error cancelling in ArrivePing: ${message(e)}`;
    await markFailed(eventId, text);
    return { outcome: "failed", error: text, key };
  }
}

export type RetryOutcome =
  | PushCreateOutcome
  | PushCancelOutcome
  | { outcome: "ignored"; reason: string }
  | { outcome: "not_found" };

/** Retries one logged event, as `planRetry` decides: re-link a work order already created, send or cancel again, leave an incoming event for ArrivePing to redeliver, or set aside. */
async function runRetry(id: string): Promise<RetryOutcome> {
  const { markIgnored } = await import("./outbox.server");
  const { planRetry } = await import("./push");
  const db = await admin();
  const { data: row, error } = await db
    .from("sync_events")
    .select("id,direction,entity_type,entity_id,event_type,idempotency_key,external_id,status")
    .eq("id", id)
    .maybeSingle();
  if (error)
    return { outcome: "failed", error: `Could not load the sync event: ${error.message}`, key: "" };
  if (!row) return { outcome: "not_found" };

  const plan = planRetry(row);
  if (plan.action === "skip") return { outcome: "ignored", reason: plan.reason };
  if (plan.action === "ignore") {
    await markIgnored(row.id, plan.reason);
    return { outcome: "ignored", reason: plan.reason };
  }
  if (plan.action === "relink")
    return runRelink(row.id, plan.visitId, plan.jobId, row.idempotency_key ?? "");
  if (plan.action === "cancel") {
    // Same stable cancel key, so recordPending picks this row up again and ArrivePing treats it as the one cancel.
    const result = await runCancel(plan.visitId);
    if (result.outcome === "skipped") {
      await markIgnored(row.id, result.reason);
    } else if (result.outcome === "failed" && result.error === VISIT_NOT_FOUND) {
      await markIgnored(row.id, "the install visit no longer exists");
      return { outcome: "ignored", reason: "the install visit no longer exists" };
    }
    return result;
  }

  const result = await runPushCreate(plan.visitId, plan.key);
  if (result.outcome === "skipped") {
    await markIgnored(row.id, "already linked");
  } else if (result.outcome === "failed" && result.error === VISIT_NOT_FOUND) {
    await markIgnored(row.id, "the install visit no longer exists");
    return { outcome: "ignored", reason: "the install visit no longer exists" };
  }
  return result;
}

/** What Settings needs to show the ArrivePing card. Counts and times are only filled in for people who manage integrations. */
export const arrivepingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { arrivepingKey } = await import("./client.server");
    const canManage = await allowed(context.supabase as never, "manage_integrations");
    const origin = new URL(getRequest().url).origin;
    const base = {
      configured: arrivepingKey() !== null,
      canManage,
      webhookUrl: `${origin}/api/public/arriveping/webhook`,
      webhookSecretSet: (process.env["ARRIVEPING_WEBHOOK_SECRET"] ?? "").trim() !== "",
      lastOutAt: null as string | null,
      lastInAt: null as string | null,
      failedCount: 0,
      pendingCount: 0,
    };
    if (!canManage) return base;
    try {
      const db = await admin();
      const events = () =>
        db
          .from("sync_events")
          .select("id", { count: "exact", head: true })
          .eq("system", "arriveping");
      const latest = (direction: "out" | "in") =>
        db
          .from("sync_events")
          .select("created_at,processed_at")
          .eq("system", "arriveping")
          .eq("direction", direction);
      const newest = { ascending: false } as const;
      const [failed, pending, out, inbound] = await Promise.all([
        events().eq("status", "failed"),
        events().eq("status", "pending"),
        latest("out")
          .in("status", ["sent", "acked"])
          .order("processed_at", { ...newest, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        latest("in").order("created_at", newest).limit(1).maybeSingle(),
      ]);
      return {
        ...base,
        failedCount: failed.count ?? 0,
        pendingCount: pending.count ?? 0,
        lastOutAt: out.data ? (out.data.processed_at ?? out.data.created_at) : null,
        lastInAt: inbound.data?.created_at ?? null,
      };
    } catch (error) {
      console.error("arrivepingStatus: could not read sync_events:", error);
      return base;
    }
  });

/** Proves the key and the connection work by listing the ArrivePing tools the key can use. */
export const arrivepingTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; tools?: string[]; error?: string }> => {
    await requireAny(context.supabase as never, "manage_integrations");
    const { mcpProbe } = await import("./client.server");
    return mcpProbe();
  });

/** The sync log, newest first, at most 100 rows. */
export const listSyncEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: "failed" | "pending" | "all"; limit?: number } | undefined) => {
    const status = d?.status ?? "all";
    if (status !== "failed" && status !== "pending" && status !== "all")
      throw new Error("Invalid request");
    const limit = Number.isFinite(d?.limit)
      ? Math.min(100, Math.max(1, Math.floor(d!.limit!)))
      : 50;
    return { status, limit };
  })
  .handler(async ({ data, context }) => {
    await requireAny(context.supabase as never, "manage_integrations");
    const db = await admin();
    let q = db.from("sync_events").select("*").eq("system", "arriveping");
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error)
      return {
        ok: false as const,
        error: `Could not load the sync log: ${error.message}`,
        rows: [] as import("./outbox.server").SyncEventRow[],
      };
    return { ok: true as const, rows: (rows ?? []) as import("./outbox.server").SyncEventRow[] };
  });

/** Sends an install visit to ArrivePing. A failure is logged and returned; it never undoes or blocks the visit itself. */
export const pushVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(visitIdInput)
  .handler(async ({ data, context }): Promise<PushCreateOutcome> => {
    await requireAny(context.supabase as never, "manage_projects", "manage_integrations");
    return runPushCreate(data.visitId);
  });

/** Asks ArrivePing to cancel a visit's work order. A visit that was never sent is skipped. */
export const cancelVisitPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(visitIdInput)
  .handler(async ({ data, context }): Promise<PushCancelOutcome> => {
    await requireAny(context.supabase as never, "manage_projects", "manage_integrations");
    return runCancel(data.visitId);
  });

/** Retries one failed (or stuck pending) sync event. */
export const retrySyncEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(idInput)
  .handler(async ({ data, context }): Promise<RetryOutcome> => {
    await requireAny(context.supabase as never, "manage_integrations");
    return runRetry(data.id);
  });

const stalePendingBefore = () => new Date(Date.now() - STALE_PENDING_MS).toISOString();
const RETRY_BATCH = 20;
const RETRY_BUDGET_MS = 20_000;

/**
 * Retries up to 20 failed outgoing events, oldest first, one at a time, stopping after about 20 seconds. `remaining` counts
 * failed outgoing events this batch did not reach. Failed incoming events are left for ArrivePing to redeliver.
 */
export const retryAllFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAny(context.supabase as never, "manage_integrations");
    const counts = { total: 0, sent: 0, failed: 0, skipped: 0, ignored: 0, remaining: 0 };
    const db = await admin();
    const { data: rows, error } = await db
      .from("sync_events")
      .select("id")
      .eq("system", "arriveping")
      .eq("direction", "out")
      .or(`status.eq.failed,and(status.eq.pending,created_at.lt.${stalePendingBefore()})`)
      .order("created_at", { ascending: true })
      .limit(RETRY_BATCH);
    if (error)
      return {
        ok: false as const,
        error: `Could not load failed events: ${error.message}`,
        ...counts,
      };
    const started = Date.now();
    for (const row of (rows ?? []) as { id: string }[]) {
      if (Date.now() - started > RETRY_BUDGET_MS) break;
      counts.total += 1;
      try {
        const result = await runRetry(row.id);
        if (result.outcome === "sent") counts.sent += 1;
        else if (result.outcome === "failed") counts.failed += 1;
        else if (result.outcome === "skipped") counts.skipped += 1;
        else counts.ignored += 1;
      } catch (e) {
        console.error(`retryAllFailed: sync event ${row.id} threw:`, e);
        counts.failed += 1;
      }
    }
    const { count } = await db
      .from("sync_events")
      .select("id", { count: "exact", head: true })
      .eq("system", "arriveping")
      .eq("direction", "out")
      .or(`status.eq.failed,and(status.eq.pending,created_at.lt.${stalePendingBefore()})`);
    // Failed rows not attempted in this batch: the ones retried here that failed again are reported in `failed` instead.
    counts.remaining = Math.max(0, (count ?? 0) - counts.failed);
    return { ok: true as const, ...counts };
  });
