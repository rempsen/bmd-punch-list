/** Install visits and what ArrivePing tells us about them. */
export type VisitStatus = "scheduled" | "en_route" | "arrived" | "completed" | "cancelled";
export type Visit = { id: string; starts_at: string; ends_at: string | null; crew: string | null; notes: string | null; site_contact: string | null; arriveping_job_id: string | null; status: VisitStatus };

/** Compares the secret a caller sent with ours without leaking where they differ. No secret configured means nobody gets in. */
export function secretMatches(got: string | null | undefined, expected: string | null | undefined): boolean {
  if (!got || !expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: Record<string, VisitStatus> = { en_route: "en_route", enroute: "en_route", on_the_way: "en_route", arrived: "arrived", arrival: "arrived", completed: "completed", complete: "completed", cancelled: "cancelled", canceled: "cancelled" };

/** What a webhook body says happened, and to which visit. `at` is ArrivePing's own timestamp, as sent. */
type EventRef = { jobId: string | null; visitId: string | null; at: string | null };
export type ArrivePingEvent =
  | ({ kind: "status"; status: VisitStatus } & EventRef)
  | ({ kind: "assigned"; assignee: string | null } & EventRef)
  | ({ kind: "rescheduled"; startsAt: string; endsAt: string | null } & EventRef);

const iso = (v: unknown): string | null | undefined => {
  if (v == null) return undefined;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const personName = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as Record<string, unknown>)["name"] : v;
  return typeof n === "string" && n.trim() ? n.trim() : null;
};

/** Picks the event and the visit out of a webhook body. Anything it does not recognise is ignored, never guessed at. */
export function parseArrivePingEvent(body: unknown): ArrivePingEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const d = (b["data"] && typeof b["data"] === "object" ? b["data"] : {}) as Record<string, unknown>;
  const raw = (...keys: string[]) => keys.map((k) => b[k] ?? d[k]).find((v) => v != null);
  const pick = (...keys: string[]) => keys.map((k) => b[k] ?? d[k]).find((v) => typeof v === "string" || typeof v === "number");
  const name = String(pick("event", "type", "status") ?? "").toLowerCase().split(/[.:]/).pop()!;
  const job = pick("job_id", "jobId");
  const ext = pick("external_id", "externalId", "reference");
  const visitId = typeof ext === "string" && UUID.test(ext) ? ext : null;
  if (job == null && !visitId) return null;
  const at = pick("occurred_at", "timestamp", "at");
  const ref: EventRef = { jobId: job == null ? null : String(job), visitId, at: typeof at === "string" ? at : null };

  if (name === "unassigned") return { kind: "assigned", assignee: null, ...ref };
  if (name.endsWith("assigned")) {
    const assignee = personName(raw("assigned_to")) ?? personName(raw("tech")) ?? personName(raw("assignee"));
    return assignee ? { kind: "assigned", assignee, ...ref } : null;
  }
  if (name === "rescheduled" || name === "reschedule") {
    const startsAt = iso(raw("start_at", "starts_at", "start"));
    const endsAt = iso(raw("end_at", "ends_at", "end"));
    if (!startsAt || endsAt === null) return null;
    if (endsAt && Date.parse(endsAt) < Date.parse(startsAt)) return null;
    return { kind: "rescheduled", startsAt, endsAt: endsAt ?? null, ...ref };
  }
  const status = STATUSES[name];
  return status ? { kind: "status", status, ...ref } : null;
}

/** The sync log key for a delivery that carries ArrivePing's event id, so a redelivery is recognised. No id, no key. */
export function inboundEventKey(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = [b["id"], b["event_id"]].find((v) => typeof v === "string" && v.trim());
  return typeof id === "string" && id.trim().length <= 200 ? `ap-evt-${id.trim()}` : null;
}

const ORDER: VisitStatus[] = ["scheduled", "en_route", "arrived", "completed"];
const NOTES: Record<VisitStatus, string> = { scheduled: "Install visit scheduled", en_route: "Crew on the way", arrived: "Crew arrived on site", completed: "Install visit completed", cancelled: "Install visit cancelled" };

/** The visit's next state for an incoming status, or null when it changes nothing (a repeat, or a step backwards). */
export function applyVisitEvent(visit: Pick<Visit, "status" | "crew">, to: VisitStatus): { status: VisitStatus; note: string } | null {
  if (visit.status === "cancelled" || visit.status === "completed" || visit.status === to) return null;
  if (to !== "cancelled" && ORDER.indexOf(to) <= ORDER.indexOf(visit.status)) return null;
  return { status: to, note: `${NOTES[to]}${visit.crew ? ` (${visit.crew})` : ""}` };
}
export const visitNote = (status: VisitStatus, crew: string | null) => `${NOTES[status]}${crew ? ` (${crew})` : ""}`;

const cell = (v: string | null | undefined) => {
  // A leading =, +, - or @ would be run as a formula by a spreadsheet; an apostrophe makes it plain text.
  const s = /^[=+\-@]/.test(v ?? "") ? `'${v}` : (v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Visits as a CSV to load into ArrivePing by hand. The Reference column is what ArrivePing should send back as external_id. */
export function visitsCsv(visits: Visit[], project: { name: string; number: string | null; address: string | null; client: string | null }): string {
  const iso = (s: string | null) => (s ? new Date(s).toISOString().replace(".000Z", "Z") : "");
  const rows = visits.map((v) => [v.id, `${project.number ? `${project.number} ` : ""}${project.name}`, project.client, project.address, iso(v.starts_at), iso(v.ends_at), v.crew, v.site_contact, v.notes].map(cell).join(","));
  return ["Reference,Project,Client,Address,Start,End,Crew,Site contact,Notes", ...rows].join("\r\n");
}

const SCHEDULE_TZ = "America/Winnipeg";
/** A visit's times as BMD reads them, in Winnipeg time: "Dec 3, 2026, 8:00 a.m. – 4:00 p.m.". */
export function scheduleRange(startsAt: string, endsAt: string | null, timeZone = SCHEDULE_TZ): string {
  const f = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone });
  return endsAt ? f.formatRange(new Date(startsAt), new Date(endsAt)) : f.format(new Date(startsAt));
}

export type InboundVisit = Pick<Visit, "status" | "crew" | "starts_at" | "ends_at" | "arriveping_job_id"> & { arriveping_assigned_to?: string | null };
export type InboundPlan =
  | { ok: true; patch: Record<string, string | null>; event: { status: string; note: string; at: string } }
  | { ok: false; reason: "no change" };

const sameTime = (a: string | null, b: string | null) => (a == null || b == null ? a == b : Date.parse(a) === Date.parse(b));

/**
 * What an ArrivePing event does to a visit: the columns to update and the activity entry to log, or why it changes nothing.
 * A finished visit (completed or cancelled) is never changed. `now` stands in for an event time that is missing or unreadable.
 */
export function applyInboundEvent(visit: InboundVisit, ev: ArrivePingEvent, now: string): InboundPlan {
  const at = iso(ev.at) ?? now;
  const common = { arriveping_last_event_at: at, ...(ev.jobId && !visit.arriveping_job_id ? { arriveping_job_id: ev.jobId } : {}) };
  const closed = visit.status === "completed" || visit.status === "cancelled";
  if (ev.kind === "status") {
    const next = applyVisitEvent(visit, ev.status);
    if (!next) return { ok: false, reason: "no change" };
    return { ok: true, patch: { status: next.status, arriveping_status: next.status, ...common }, event: { status: next.status, note: next.note, at } };
  }
  if (closed) return { ok: false, reason: "no change" };
  if (ev.kind === "assigned") {
    if ((visit.arriveping_assigned_to ?? null) === ev.assignee) return { ok: false, reason: "no change" };
    // Only a visit that has not started takes ArrivePing's assignment as its status; once the crew is out, that status is live.
    const status = visit.status === "scheduled" ? { arriveping_status: ev.assignee ? "assigned" : "scheduled" } : {};
    return {
      ok: true,
      patch: { arriveping_assigned_to: ev.assignee, ...status, ...common },
      event: ev.assignee ? { status: "assigned", note: `Assigned to ${ev.assignee} in ArrivePing`, at } : { status: "unassigned", note: "Unassigned in ArrivePing", at },
    };
  }
  if (sameTime(visit.starts_at, ev.startsAt) && sameTime(visit.ends_at, ev.endsAt)) return { ok: false, reason: "no change" };
  // No end from ArrivePing means none is known: the old end is cleared rather than kept against a new start.
  return { ok: true, patch: { starts_at: ev.startsAt, ends_at: ev.endsAt, ...common }, event: { status: "rescheduled", note: `Rescheduled in ArrivePing to ${scheduleRange(ev.startsAt, ev.endsAt)}`, at } };
}
