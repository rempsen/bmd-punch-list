import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TIME_SETTINGS, rateFor, type TimeEntry, type TimeSettings } from "./logic";
import { previewTime, sendTimeActivities, type PlannedTime, type QboPersonLink, type TimePreview, type TimeSendInput, type TimeSendStore } from "./qbo";

/** time_entries has no browser write access; the service-role client writes after the caller has been checked. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = supabaseAdmin as any;
const entries = () => admin.from("time_entries");
export const ENTRY_COLS =
  "id,user_id,project_id,clock_in_at,clock_out_at,rounded_minutes,in_lat,in_lng,in_accuracy_m,out_lat,out_lng,out_accuracy_m,note_in,note_out,source,original,adjusted_at,adjusted_by,adjust_reason,approved_at,approved_by,qbo_time_activity_id,qbo_sent_at,qbo_error,qbo_attempts";

export async function timeSettings(): Promise<TimeSettings> {
  const { data } = await admin.from("time_settings").select("rounding_minutes,overtime_daily_minutes,overtime_weekly_minutes").eq("id", 1).maybeSingle();
  return { ...DEFAULT_TIME_SETTINGS, ...(data ?? {}) };
}

export async function openEntry(userId: string): Promise<TimeEntry | null> {
  const { data, error } = await entries().select(ENTRY_COLS).eq("user_id", userId).is("clock_out_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function entryById(id: string): Promise<TimeEntry | null> {
  const { data, error } = await entries().select(ENTRY_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function entriesByIds(ids: string[]): Promise<TimeEntry[]> {
  if (!ids.length) return [];
  const { data, error } = await entries().select(ENTRY_COLS).in("id", ids);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Adds an entry. `duplicate` is true when the database refused a second open entry for the person. */
export async function insertEntry(row: Record<string, unknown>): Promise<{ entry: TimeEntry | null; duplicate: boolean }> {
  const { data, error } = await entries().insert(row).select(ENTRY_COLS).maybeSingle();
  if (error) {
    if (error.code === "23505") return { entry: null, duplicate: true };
    throw new Error(error.message);
  }
  return { entry: data, duplicate: false };
}

/** Closes the person's open entry. Returns null when it was already closed (a second press, another phone). */
export async function closeEntry(id: string, patch: Record<string, unknown>): Promise<TimeEntry | null> {
  const { data, error } = await entries().update(patch).eq("id", id).is("clock_out_at", null).select(ENTRY_COLS).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Changes an entry that is neither approved nor sent; the database guard refuses anything else as well. */
export async function patchUnapproved(id: string, patch: Record<string, unknown>): Promise<TimeEntry | null> {
  const { data, error } = await entries().update(patch).eq("id", id).is("approved_at", null).is("qbo_time_activity_id", null).select(ENTRY_COLS).maybeSingle();
  if (error) throw new Error(error.code === "23505" ? "This person is already clocked in on another entry." : error.message);
  return data ?? null;
}

export async function setApproval(ids: string[], patch: { approved_at: string | null; approved_by: string | null }): Promise<number> {
  if (!ids.length) return 0;
  let q = entries().update(patch).in("id", ids).is("qbo_time_activity_id", null);
  q = patch.approved_at ? q.not("clock_out_at", "is", null).is("approved_at", null) : q.not("approved_at", "is", null);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export async function profileExists(id: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("id").eq("id", id).maybeSingle();
  return !!data;
}
export async function projectExists(id: string): Promise<boolean> {
  const { data } = await admin.from("projects").select("id").eq("id", id).maybeSingle();
  return !!data;
}

// ── QuickBooks ─────────────────────────────────────────────────────────────────────────────────────────────
const MAX = 200;

/** Everything approved and not yet in QuickBooks (or just the given entries), with what each needs to be planned. */
async function sendInputs(ids?: string[]): Promise<TimeSendInput[]> {
  let q = entries().select(`${ENTRY_COLS},person:profiles(full_name,email),project:projects(name,project_number)`).not("approved_at", "is", null).is("qbo_time_activity_id", null).order("clock_in_at").limit(MAX);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Row = TimeEntry & { person: { full_name: string | null; email: string | null } | null; project: { name: string; project_number: string | null } | null };
  const rows = (data ?? []) as Row[];
  if (!rows.length) return [];
  const users = [...new Set(rows.map((r) => r.user_id))];
  const projects = [...new Set(rows.map((r) => r.project_id))];
  const [links, customers, rates, jobRates] = await Promise.all([
    admin.from("time_qbo_people").select("user_id,qbo_type,qbo_id,qbo_name").in("user_id", users),
    admin.from("sync_links").select("bmd_id,external_id").eq("system", "quickbooks").eq("kind", "project").in("bmd_id", projects),
    admin.from("person_rates").select("user_id,billable_rate_cents").in("user_id", users),
    admin.from("project_person_rates").select("project_id,user_id,billable_rate_cents").in("project_id", projects).in("user_id", users),
  ]);
  for (const r of [links, customers, rates, jobRates]) if (r.error) throw new Error(r.error.message);
  const linkOf = new Map<string, QboPersonLink>(((links.data ?? []) as (QboPersonLink & { user_id: string })[]).map((l) => [l.user_id, { qbo_type: l.qbo_type, qbo_id: l.qbo_id, qbo_name: l.qbo_name ?? null }]));
  const customerOf = new Map<string, string>(((customers.data ?? []) as { bmd_id: string; external_id: string }[]).map((l) => [l.bmd_id, l.external_id]));
  const rateOf = new Map<string, { billable_rate_cents: number | null }>(((rates.data ?? []) as { user_id: string; billable_rate_cents: number | null }[]).map((r) => [r.user_id, r]));
  const jobRateOf = new Map<string, { billable_rate_cents: number | null }>(((jobRates.data ?? []) as { project_id: string; user_id: string; billable_rate_cents: number | null }[]).map((r) => [`${r.project_id}|${r.user_id}`, r]));
  return rows.map((r) => ({
    entry: r,
    personName: r.person?.full_name || r.person?.email || "Someone",
    projectName: [r.project?.project_number, r.project?.name].filter(Boolean).join(" ") || "Job",
    personLink: linkOf.get(r.user_id) ?? null,
    customerId: customerOf.get(r.project_id) ?? null,
    billableRateCents: rateFor(rateOf.get(r.user_id), jobRateOf.get(`${r.project_id}|${r.user_id}`)),
  }));
}

export async function previewTimeSends(ids?: string[]): Promise<TimePreview> {
  return previewTime(await sendInputs(ids));
}

const label = (s: PlannedTime) => `${s.personName} · ${s.projectName} · ${s.day}`;

function store(by: string): TimeSendStore {
  return {
    sendable: async (id) => {
      const { data } = await entries().select("approved_at,qbo_time_activity_id").eq("id", id).maybeSingle();
      return !!data && !!data.approved_at && !data.qbo_time_activity_id;
    },
    sent: async (id, qboId, at, s) => {
      const { error } = await entries().update({ qbo_time_activity_id: qboId, qbo_sent_at: at, qbo_error: null }).eq("id", id).is("qbo_time_activity_id", null);
      // Not saved means the next press repeats the same request id, which QuickBooks answers with this same record.
      if (error) throw new Error(`Sent to QuickBooks as time activity ${qboId}, but that could not be saved here: ${error.message}`);
      await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "time", bmd_id: id, external_id: qboId, label: label(s), outcome: "sent", detail: { summary: s.summary, by } });
    },
    failed: async (id, message, refused, s) => {
      const { data } = await entries().select("qbo_attempts").eq("id", id).maybeSingle();
      await entries().update({ qbo_error: message.slice(0, 500), ...(refused ? { qbo_attempts: (data?.qbo_attempts ?? 0) + 1 } : {}) }).eq("id", id).is("qbo_time_activity_id", null);
      await admin.from("sync_log").insert({ direction: "out", system: "quickbooks", kind: "time", bmd_id: id, external_id: null, label: label(s), outcome: "failed", detail: { summary: s.summary, error: message.slice(0, 500), by } });
    },
  };
}

/** Sends the ticked entries. One run at a time, sharing the catalogue sender's lock so two sends never overlap. */
export async function runTimeSends(ids: string[], by: string): Promise<{ sent: number; failed: number; skipped: number; held: number; message?: string }> {
  const { data: token, error } = await admin.rpc("sync_send_lock");
  if (error) throw new Error(error.message);
  if (typeof token !== "string") return { sent: 0, failed: 0, skipped: 0, held: 0, message: "Another send to QuickBooks is running. Try again in a few minutes." };
  try {
    const { qbo } = await import("@/lib/qbo/qbo.server");
    const q = qbo();
    const auth = await q.getAccessToken();
    // Planned again from what is stored now, never from what the browser showed.
    const preview = await previewTimeSends(ids);
    const r = await sendTimeActivities({ post: (path, body) => q.post(path, body, auth), store: store(by), now: () => new Date().toISOString() }, preview.sends);
    return { ...r, held: preview.held.length };
  } finally {
    const { error: unlockError } = await admin.rpc("sync_send_unlock", { _token: token });
    if (unlockError) console.error(`[time] could not release the send lock: ${unlockError.message}`);
  }
}

/** Active employees and vendors, read from QuickBooks for the linking screen. Reads only. */
export async function qboPeopleOptions(): Promise<{ employees: { Id?: string; DisplayName?: string; GivenName?: string; FamilyName?: string }[]; vendors: { Id?: string; DisplayName?: string; GivenName?: string; FamilyName?: string }[] }> {
  const { qbo } = await import("@/lib/qbo/qbo.server");
  const q = qbo();
  const auth = await q.getAccessToken();
  const [employees, vendors] = await Promise.all([q.queryAll("Employee", auth, "Active = true"), q.queryAll("Vendor", auth, "Active = true")]);
  return { employees, vendors };
}

export async function crewForLinking(): Promise<{ id: string; full_name: string | null; email: string | null }[]> {
  const [{ data: access }, { data: members }, { data: seen }] = await Promise.all([
    admin.from("user_access").select("user_id,level,goes_to_site,status"),
    admin.from("project_members").select("user_id").eq("role", "bmd_field"),
    entries().select("user_id").limit(5000),
  ]);
  const off = new Set(((access ?? []) as { user_id: string; status: string }[]).filter((a) => a.status === "deactivated").map((a) => a.user_id));
  const ids = new Set<string>();
  for (const a of (access ?? []) as { user_id: string; level: string; goes_to_site: boolean }[]) if (a.level === "bmd_field" || a.goes_to_site) ids.add(a.user_id);
  for (const m of (members ?? []) as { user_id: string }[]) ids.add(m.user_id);
  for (const id of off) ids.delete(id);
  for (const e of (seen ?? []) as { user_id: string }[]) ids.add(e.user_id);
  if (!ids.size) return [];
  const { data, error } = await admin.from("profiles").select("id,full_name,email").in("id", [...ids]).order("full_name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function peopleLinks(): Promise<(QboPersonLink & { user_id: string })[]> {
  const { data, error } = await admin.from("time_qbo_people").select("user_id,qbo_type,qbo_id,qbo_name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function savePersonLink(userId: string, link: QboPersonLink | null, by: string): Promise<void> {
  if (!link) {
    const { error } = await admin.from("time_qbo_people").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.from("time_qbo_people").upsert({ user_id: userId, qbo_type: link.qbo_type, qbo_id: link.qbo_id, qbo_name: link.qbo_name ?? null, linked_at: new Date().toISOString(), linked_by: by }, { onConflict: "user_id" });
  if (error) throw new Error(error.code === "23505" ? "That QuickBooks record is already linked to someone else." : error.message);
}
