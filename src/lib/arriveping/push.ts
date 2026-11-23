/** Sending install visits to ArrivePing. Pure orchestration: the call to ArrivePing is handed in, so this has no env, network or database of its own. */
import type { ApResult } from "./client.server";
import {
  AP_PATHS,
  idempotencyKey,
  workOrderPayload,
  type ProjectForPush,
  type VisitForPush,
} from "./core";

export type FetchJson = (
  path: string,
  init: { method: "POST"; body: unknown; idempotencyKey: string },
) => Promise<ApResult>;

export type PushCreateOutcome =
  | { outcome: "sent"; jobId: string; key: string }
  | { outcome: "failed"; error: string; key: string }
  | { outcome: "skipped"; reason: "already linked" };
export type PushCancelOutcome =
  | { outcome: "sent"; jobId: string; key: string }
  | { outcome: "failed"; error: string; key: string }
  | { outcome: "skipped"; reason: "not linked" };

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
  key: string,
): Promise<ApResult> {
  try {
    return await fetchJson(path, { method: "POST", body, idempotencyKey: key });
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
  existingKey?: string | null;
}): Promise<PushCreateOutcome> {
  const { fetchJson, visit, project } = deps;
  if (visit.arriveping_job_id) return { outcome: "skipped", reason: "already linked" };
  const key = deps.existingKey ?? idempotencyKey("create", visit.id);
  const res = await call(fetchJson, AP_PATHS.workorders, workOrderPayload(visit, project), key);
  if (!res.ok) return { outcome: "failed", error: res.error, key };
  const jobId = workOrderId(res.json);
  return jobId ? { outcome: "sent", jobId, key } : { outcome: "failed", error: NO_ID, key };
}

/** Cancels the visit's ArrivePing work order. A visit that was never sent has nothing to cancel. Never throws. */
export async function pushVisitCancel(deps: {
  fetchJson: FetchJson;
  visit: { id: string; arriveping_job_id: string | null };
  existingKey?: string | null;
}): Promise<PushCancelOutcome> {
  const { fetchJson, visit } = deps;
  const jobId = visit.arriveping_job_id;
  if (!jobId) return { outcome: "skipped", reason: "not linked" };
  const key = deps.existingKey ?? idempotencyKey("cancel", visit.id);
  const res = await call(
    fetchJson,
    `${AP_PATHS.workorders}/${encodeURIComponent(jobId)}/cancel`,
    {},
    key,
  );
  return res.ok ? { outcome: "sent", jobId, key } : { outcome: "failed", error: res.error, key };
}
