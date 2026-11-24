import { AP_PATHS } from "./core";
import { matchWorkOrder, readWorkOrder, readWorkOrderPage, visitStatusFor, type ApWorkOrder, type MatchContext } from "./match";

/**
 * Work orders scheduled in ArrivePing itself, brought into BMD. Server only. A work order the matcher can place becomes
 * an install visit (source 'arriveping'); the rest are held in `arriveping_inbox` for Scheduling → Work orders, where a
 * person links them to a job, makes a job from them, or ignores them. Everything here is idempotent on the ArrivePing id.
 */

const OPEN_STAGES = ["opportunity", "estimating", "quote_out", "won", "in_progress"];

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

export type ImportOutcome =
  | { kind: "exists"; visitId: string }
  | { kind: "visit"; visitId: string; projectId: string; how: "number" | "client" | "manual" }
  | { kind: "inbox"; reason: string }
  | { kind: "ignored"; reason: string }
  | { kind: "error"; error: string };

async function matchContext(db: Awaited<ReturnType<typeof admin>>): Promise<MatchContext> {
  const [{ data: projects }, { data: links }] = await Promise.all([
    db.from("projects").select("id,project_number,name,client_id").in("stage", OPEN_STAGES),
    db.from("sync_links").select("bmd_id,external_id").eq("kind", "client").eq("system", "arriveping"),
  ]);
  const clientLinks: Record<string, string> = {};
  for (const l of (links ?? []) as { bmd_id: string; external_id: string }[]) clientLinks[l.external_id] = l.bmd_id;
  return {
    projects: ((projects ?? []) as { id: string; project_number: string | null; name: string; client_id: string | null }[]).map((p) => ({ id: p.id, number: p.project_number, name: p.name, client_id: p.client_id })),
    clientLinks,
  };
}

/** The visit row an ArrivePing work order becomes. The 24 h cap is BMD's rule for what it sends; what ArrivePing already holds is stored as is. */
export function visitRowFor(wo: ApWorkOrder, projectId: string): Record<string, unknown> {
  const start = wo.startAt && !Number.isNaN(Date.parse(wo.startAt)) ? wo.startAt : new Date().toISOString();
  const end = wo.endAt && !Number.isNaN(Date.parse(wo.endAt)) && Date.parse(wo.endAt) >= Date.parse(start) ? wo.endAt : null;
  return {
    project_id: projectId,
    starts_at: start,
    ends_at: end,
    crew: wo.assignedTo,
    assigned_name: wo.assignedTo,
    site_contact: wo.siteContact,
    notes: wo.notes,
    arriveping_job_id: wo.id,
    arriveping_status: wo.status,
    arriveping_assigned_to: wo.assignedTo,
    status: visitStatusFor(wo.status),
    source: "arriveping",
    scope: wo.title,
  };
}

/** Creates the visit for a work order on a job, logs it, and settles any inbox row. Returns the existing visit when the job id is already on one. */
export async function createVisitFromWorkOrder(wo: ApWorkOrder, projectId: string, how: "number" | "client" | "manual", by: string | null): Promise<ImportOutcome> {
  const db = await admin();
  const { data: existing } = await db.from("install_visits").select("id").eq("arriveping_job_id", wo.id).maybeSingle();
  if (existing) return { kind: "exists", visitId: existing.id };
  const { data: visit, error } = await db.from("install_visits").insert({ ...visitRowFor(wo, projectId), created_by: by }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const { data: again } = await db.from("install_visits").select("id").eq("arriveping_job_id", wo.id).maybeSingle();
      if (again) return { kind: "exists", visitId: again.id };
    }
    return { kind: "error", error: `Could not create the visit: ${error.message}` };
  }
  await db.from("install_visit_events").insert({
    visit_id: visit.id,
    project_id: projectId,
    status: "scheduled",
    note: `Scheduled in ArrivePing${wo.assignedTo ? ` (${wo.assignedTo})` : ""}${how === "manual" ? " — linked to this job in BMD" : how === "client" ? " — matched by client" : " — matched by job number"}`,
    source: "arriveping",
  });
  await db
    .from("arriveping_inbox")
    .update({ status: "linked", project_id: projectId, visit_id: visit.id, updated_at: new Date().toISOString() })
    .eq("arriveping_job_id", wo.id);
  return { kind: "visit", visitId: visit.id, projectId, how };
}

/** Places one work order: a visit when it matches a job, else a row in the inbox. BMD's own work orders are not touched. */
export async function importWorkOrder(wo: ApWorkOrder): Promise<ImportOutcome> {
  const db = await admin();
  const { data: existing } = await db.from("install_visits").select("id").eq("arriveping_job_id", wo.id).maybeSingle();
  if (existing) return { kind: "exists", visitId: existing.id };
  const match = matchWorkOrder(wo, await matchContext(db));
  if (match.kind === "bmd") return { kind: "ignored", reason: "BMD's own work order" };
  if (match.kind === "match") return await createVisitFromWorkOrder(wo, match.projectId, match.how, null);
  const { data: held } = await db.from("arriveping_inbox").select("status").eq("arriveping_job_id", wo.id).maybeSingle();
  if (held?.status === "ignored") return { kind: "ignored", reason: "ignored earlier" };
  const { error } = await db.from("arriveping_inbox").upsert(
    {
      arriveping_job_id: wo.id,
      title: wo.title,
      reference: wo.reference,
      customer_name: wo.customerName,
      customer_id: wo.customerId,
      starts_at: wo.startAt,
      ends_at: wo.endAt,
      assigned_to: wo.assignedTo,
      ap_status: wo.status,
      site_contact: wo.siteContact,
      notes: wo.notes,
      payload: wo,
      reason: match.reason,
      status: "unmatched",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "arriveping_job_id" },
  );
  if (error) return { kind: "error", error: `Could not hold the work order: ${error.message}` };
  return { kind: "inbox", reason: match.reason };
}

/** Reads one work order from ArrivePing and places it. */
export async function importWorkOrderById(jobId: string): Promise<ImportOutcome> {
  const db = await admin();
  // Most events are about a visit BMD already has; no need to read the work order again for those.
  const { data: existing } = await db.from("install_visits").select("id").eq("arriveping_job_id", jobId).maybeSingle();
  if (existing) return { kind: "exists", visitId: existing.id };
  const { data: held } = await db.from("arriveping_inbox").select("status").eq("arriveping_job_id", jobId).maybeSingle();
  if (held?.status === "ignored") return { kind: "ignored", reason: "ignored earlier" };
  const { apFetch } = await import("./client.server");
  const res = await apFetch(`${AP_PATHS.workorders}/${encodeURIComponent(jobId)}`, { method: "GET" });
  if (!res.ok) return { kind: "error", error: res.error };
  const wo = readWorkOrder(res.json);
  if (!wo) return { kind: "error", error: "ArrivePing returned a work order BMD could not read" };
  return await importWorkOrder({ ...wo, id: wo.id || jobId });
}

export type PullResult = { ran: boolean; read: number; visits: number; held: number; skipped: number; error?: string };

/**
 * Lists work orders changed in ArrivePing since the last pull (`GET /api/v1/workorders?updated_since=&cursor=`) and
 * places each one BMD does not have. Pages until ArrivePing stops handing back a cursor, up to a cap per run.
 */
export async function pullWorkOrders(opts: { since?: string | null; maxPages?: number } = {}): Promise<PullResult> {
  const { apFetch } = await import("./client.server");
  const db = await admin();
  const { data: link } = await db.from("arriveping_link").select("last_pull_at").eq("id", 1).maybeSingle();
  const since = opts.since === undefined ? ((link?.last_pull_at as string | null) ?? null) : opts.since;
  const startedAt = new Date().toISOString();
  const out: PullResult = { ran: true, read: 0, visits: 0, held: 0, skipped: 0 };
  let cursor: string | null = null;
  for (let page = 0; page < (opts.maxPages ?? 10); page++) {
    const params = new URLSearchParams();
    if (since) params.set("updated_since", since);
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    const res = await apFetch(`${AP_PATHS.workorders}${qs ? `?${qs}` : ""}`, { method: "GET" });
    if (!res.ok) return { ...out, error: res.error };
    const { items, next } = readWorkOrderPage(res.json);
    for (const wo of items) {
      out.read++;
      const r = await importWorkOrder(wo);
      if (r.kind === "visit") out.visits++;
      else if (r.kind === "inbox") out.held++;
      else if (r.kind === "error") out.error ??= r.error;
      else out.skipped++;
    }
    if (!next || next === cursor || !items.length) break;
    cursor = next;
  }
  if (!out.error) await db.from("arriveping_link").upsert({ id: 1, last_pull_at: startedAt });
  return out;
}
