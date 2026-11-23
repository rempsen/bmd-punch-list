/** Sending install visits to ArrivePing. Pure orchestration: the call to ArrivePing is handed in, so this has no env, network or database of its own. */
import type { ApResult } from "./client.server";
import {
  AP_PATHS,
  EXTERNAL_SOURCE,
  clientKey,
  clientPayload,
  errorCode,
  existingFromConflict,
  idempotencyKey,
  workOrderPayload,
  type ClientForPush,
  type ProjectForPush,
  type VisitForPush,
} from "./core";

export type FetchJson = (
  path: string,
  init: { method: "POST" | "PATCH"; body: unknown; idempotencyKey?: string },
) => Promise<ApResult>;

/** How the ArrivePing client for a BMD client was found: already linked, just created, or matched in ArrivePing. */
export type EnsureClientOutcome =
  | { outcome: "linked"; clientId: string; via: "linked" | "created" | "external_ref" | "email" }
  | { outcome: "failed"; error: string };

export type PushCreateOutcome =
  | { outcome: "sent"; jobId: string; key: string }
  | { outcome: "failed"; error: string; key: string }
  | { outcome: "skipped"; reason: "already linked" };
export type PushCancelOutcome =
  | { outcome: "sent"; jobId: string; key: string }
  | { outcome: "failed"; error: string; key: string }
  | { outcome: "skipped"; reason: "not linked" | "already requested" };

const NO_ID = "ArrivePing did not return a work order id";

/** A non-empty id, as text. */
function asId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/** The work order id out of a create reply: `id`, `work_order.id` or `data.id`. */
function workOrderId(json: unknown): string | null {
  return (
    asId(field(json, "id")) ??
    asId(field(field(json, "work_order"), "id")) ??
    asId(field(field(json, "data"), "id"))
  );
}

/** Calls ArrivePing, turning even an unexpected throw into a returned failure. */
async function call(
  fetchJson: FetchJson,
  path: string,
  body: unknown,
  key?: string,
  method: "POST" | "PATCH" = "POST",
): Promise<ApResult> {
  try {
    return await fetchJson(path, { method, body, ...(key ? { idempotencyKey: key } : {}) });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: "unreachable",
      error: `Could not reach ArrivePing: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Creates the ArrivePing work order for a visit. A retry passes the key it used before, so ArrivePing can never make a second work order. Never throws. */
export async function pushVisitCreate(deps: {
  fetchJson: FetchJson;
  visit: VisitForPush & { arriveping_job_id: string | null };
  project: ProjectForPush;
  /** The ArrivePing client the work order belongs to (from ensureArrivePingClient). */
  clientId: string;
  existingKey?: string | null;
}): Promise<PushCreateOutcome> {
  const { fetchJson, visit, project } = deps;
  if (visit.arriveping_job_id) return { outcome: "skipped", reason: "already linked" };
  const key = deps.existingKey ?? idempotencyKey("create", visit.id);
  const res = await call(fetchJson, AP_PATHS.workorders, workOrderPayload(visit, project, deps.clientId), key);
  if (!res.ok) {
    // ArrivePing already made this work order for us (an earlier try whose reply was lost): it hands it back.
    const existing = res.status === 409 ? existingFromConflict(res.json, "work_order") : null;
    return existing ? { outcome: "sent", jobId: existing.id, key } : { outcome: "failed", error: res.error, key };
  }
  const jobId = workOrderId(res.json);
  return jobId ? { outcome: "sent", jobId, key } : { outcome: "failed", error: NO_ID, key };
}

/** Cancels the visit's ArrivePing work order. A visit that was never sent has nothing to cancel. Never throws. */
export async function pushVisitCancel(deps: {
  fetchJson: FetchJson;
  visit: { id: string; arriveping_job_id: string | null; arriveping_status?: string | null };
  existingKey?: string | null;
}): Promise<PushCancelOutcome> {
  const { fetchJson, visit } = deps;
  const jobId = visit.arriveping_job_id;
  if (!jobId) return { outcome: "skipped", reason: "not linked" };
  if (visit.arriveping_status === "cancel_requested")
    return { outcome: "skipped", reason: "already requested" };
  const key = deps.existingKey ?? idempotencyKey("cancel", visit.id);
  const res = await call(
    fetchJson,
    `${AP_PATHS.workorders}/${encodeURIComponent(jobId)}/cancel`,
    {},
    key,
  );
  return res.ok ? { outcome: "sent", jobId, key } : { outcome: "failed", error: res.error, key };
}

export type RetryRow = {
  direction: string;
  entity_type: string;
  event_type: string;
  entity_id: string | null;
  idempotency_key: string | null;
  external_id: string | null;
  status: string;
};

export type RetryPlan =
  | { action: "resend"; visitId: string; key: string }
  | { action: "relink"; visitId: string; jobId: string }
  | { action: "cancel"; visitId: string }
  | { action: "ignore"; reason: string }
  | { action: "skip"; reason: string };

/**
 * What a retry of a logged event should do. A send that already got a work order id back is only re-linked to the visit:
 * calling ArrivePing again would trust an idempotency key that may have expired, and could make a duplicate. A cancel is
 * sent again under its own stable key. An incoming event is left failed: ArrivePing redelivers it, and setting it aside
 * here would make that redelivery look like a duplicate.
 */
export function planRetry(row: RetryRow): RetryPlan {
  if (row.status !== "failed" && row.status !== "pending")
    return { action: "skip", reason: `already ${row.status}` };
  if (row.direction === "in") return { action: "skip", reason: "ArrivePing will redeliver" };
  if (row.direction !== "out" || row.entity_type !== "visit" || !row.entity_id)
    return { action: "ignore", reason: "retry not supported yet" };
  if (row.event_type === "cancel") return { action: "cancel", visitId: row.entity_id };
  if (row.event_type !== "create") return { action: "ignore", reason: "retry not supported yet" };
  if (row.external_id) return { action: "relink", visitId: row.entity_id, jobId: row.external_id };
  if (!row.idempotency_key) return { action: "ignore", reason: "no idempotency key" };
  return { action: "resend", visitId: row.entity_id, key: row.idempotency_key };
}

const clientFailure = (error: string): EnsureClientOutcome => ({ outcome: "failed", error: `Couldn't create the client in ArrivePing. ${error}` });

/** One create attempt: a new client, or the one ArrivePing hands back in a 409. */
async function createClient(
  fetchJson: FetchJson,
  client: ClientForPush,
  withEmail: boolean,
): Promise<EnsureClientOutcome | { outcome: "email_taken" }> {
  const res = await call(fetchJson, AP_PATHS.clients, clientPayload(client, { withEmail }), clientKey(client.id, withEmail ? "create" : "no-email"));
  if (res.ok) {
    const id = asId(field(res.json, "id"));
    return id ? { outcome: "linked", clientId: id, via: "created" } : clientFailure("ArrivePing did not return a client id.");
  }
  if (res.status === 409) {
    const existing = existingFromConflict(res.json, "client");
    if (existing) {
      if (existing.via === "email") {
        // Found by email: tag it with our reference so the next lookup finds it by id. The client is usable either way.
        await call(fetchJson, `${AP_PATHS.clients}/${encodeURIComponent(existing.id)}`, { external_source: EXTERNAL_SOURCE, external_ref: client.id }, undefined, "PATCH");
      }
      return { outcome: "linked", clientId: existing.id, via: existing.via };
    }
    if (errorCode(res.json) === "email_taken") return { outcome: "email_taken" };
  }
  return clientFailure(res.error);
}

/**
 * The ArrivePing client for a BMD client: the linked one, or a new one created with BMD's id as its reference.
 * Safe to repeat: ArrivePing answers a second create with the client it already has. Never throws.
 */
export async function ensureArrivePingClient(deps: { fetchJson: FetchJson; client: ClientForPush; linkedId: string | null }): Promise<EnsureClientOutcome> {
  const { fetchJson, client, linkedId } = deps;
  if (linkedId) return { outcome: "linked", clientId: linkedId, via: "linked" };
  const first = await createClient(fetchJson, client, true);
  if (first.outcome !== "email_taken") return first;
  // The email belongs to someone on the company's ArrivePing team, so the client is created without it.
  const second = await createClient(fetchJson, client, false);
  return second.outcome === "email_taken" ? clientFailure("Its email belongs to someone on the ArrivePing team.") : second;
}
