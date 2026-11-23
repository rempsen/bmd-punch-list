import type { Json } from "@/integrations/supabase/types";

/** The ArrivePing sync log (`sync_events`), written with the service role. Every call to ArrivePing is recorded before it is made, so a failure always leaves a row to show and retry. */

export type SyncStatus = "pending" | "sent" | "acked" | "failed" | "ignored";
export type SyncEventRow = {
  id: string;
  direction: "out" | "in";
  system: string;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  event_type: string;
  idempotency_key: string | null;
  external_id: string | null;
  payload: Json;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
};

const SYSTEM = "arriveping";
const UNIQUE_VIOLATION = "23505";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // sync_events is newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

/** Records an event as `pending` and returns its id. A key already on file (a retry) returns that row's id instead. Throws only when the row cannot be written at all. */
export async function recordPending(e: {
  direction: "out" | "in";
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  event_type: string;
  idempotency_key?: string | null;
  payload: unknown;
  external_id?: string | null;
}): Promise<string> {
  const db = await admin();
  const row = {
    direction: e.direction,
    system: SYSTEM,
    entity_type: e.entity_type,
    entity_id: e.entity_id,
    project_id: e.project_id,
    event_type: e.event_type,
    idempotency_key: e.idempotency_key ?? null,
    external_id: e.external_id ?? null,
    payload: e.payload ?? {},
    status: "pending",
  };
  const { data, error } = await db.from("sync_events").insert(row).select("id").single();
  if (!error) return data.id as string;
  if (error.code === UNIQUE_VIOLATION && e.idempotency_key) {
    const { data: existing, error: findError } = await db
      .from("sync_events")
      .select("id")
      .eq("idempotency_key", e.idempotency_key)
      .maybeSingle();
    if (existing?.id) return existing.id as string;
    if (findError) throw new Error(`Could not record the sync event: ${findError.message}`);
  }
  throw new Error(`Could not record the sync event: ${error.message}`);
}

/** Closes out an attempt: bumps `attempts`, stamps `processed_at`. A failure to write is logged, never thrown, so it cannot undo work already done in ArrivePing. */
async function finish(
  id: string,
  patch: { status: SyncStatus; last_error: string | null; external_id?: string },
): Promise<void> {
  try {
    const db = await admin();
    const { data: current } = await db
      .from("sync_events")
      .select("attempts")
      .eq("id", id)
      .maybeSingle();
    const attempts = (typeof current?.attempts === "number" ? current.attempts : 0) + 1;
    const { error } = await db
      .from("sync_events")
      .update({ ...patch, attempts, processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error(`sync_events ${id}: could not mark ${patch.status}: ${error.message}`);
  } catch (error) {
    console.error(`sync_events ${id}: could not mark ${patch.status}:`, error);
  }
}

export const markSent = (id: string, externalId?: string): Promise<void> =>
  finish(id, {
    status: "sent",
    last_error: null,
    ...(externalId ? { external_id: externalId } : {}),
  });
export const markFailed = (id: string, error: string): Promise<void> =>
  finish(id, { status: "failed", last_error: error });
export const markIgnored = (id: string, reason: string): Promise<void> =>
  finish(id, { status: "ignored", last_error: reason });

/** The newest pending or failed row for this entity and event, so a retry can reuse its idempotency key. Null when there is none (or it cannot be read). */
export async function findPendingOrFailed(
  entity_type: string,
  entity_id: string,
  event_type: string,
): Promise<SyncEventRow | null> {
  const db = await admin();
  const { data, error } = await db
    .from("sync_events")
    .select("*")
    .eq("system", SYSTEM)
    .eq("entity_type", entity_type)
    .eq("entity_id", entity_id)
    .eq("event_type", event_type)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error(`sync_events lookup failed: ${error.message}`);
  return (data as SyncEventRow | null) ?? null;
}
