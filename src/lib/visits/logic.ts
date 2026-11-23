/** Install visits and what ArrivePing tells us about them. */
export type VisitStatus = "scheduled" | "en_route" | "arrived" | "completed" | "cancelled";
export type Visit = { id: string; starts_at: string; ends_at: string | null; crew: string | null; notes: string | null; site_contact: string | null; arriveping_job_id: string | null; status: VisitStatus; arriveping_status: string | null; arriveping_assigned_to: string | null };

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
/** `assigned_techs[]` from a full work order: names joined, an empty list meaning nobody. Undefined when there is no list. */
const techNames = (v: unknown): string | null | undefined => {
  if (!Array.isArray(v)) return undefined;
  const names = v.map(personName).filter((n): n is string => n != null);
  return names.length ? names.join(", ") : null;
};

/** Picks the event and the visit out of a webhook body. Anything it does not recognise is ignored, never guessed at. */
export function parseArrivePingEvent(body: unknown): ArrivePingEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const d = (b["data"] && typeof b["data"] === "object" ? b["data"] : {}) as Record<string, unknown>;
  const raw = (...keys: string[]) => keys.map((k) => b[k] ?? d[k]).find((v) => v != null);
  const pick = (...keys: string[]) => keys.map((k) => b[k] ?? d[k]).find((v) => typeof v === "string" || typeof v === "number");
  const name = String(pick("event", "type", "status") ?? "").toLowerCase().split(/[.:]/).pop()!;
  // The envelope's top-level `id` is the event's own id, so a work order's `id` is only read from inside `data`.
  const job = pick("job_id", "jobId", "work_order_id") ?? [d["id"]].find((v) => typeof v === "string" || typeof v === "number");
  const ext = ["external_id", "externalId", "external_ref", "reference"].flatMap((k) => [b[k], d[k]]).find((v) => typeof v === "string" && UUID.test(v));
  const visitId = typeof ext === "string" ? ext : null;
  if (job == null && !visitId) return null;
  const at = pick("occurred_at", "timestamp", "at");
  const ref: EventRef = { jobId: job == null ? null : String(job), visitId, at: typeof at === "string" ? at : null };

  if (name.endsWith("assigned")) {
    // A full work order lists who is on it now, which is the truth for an assignment or an unassignment alike.
    const techs = techNames(raw("assigned_techs"));
    if (techs !== undefined) return { kind: "assigned", assignee: techs, ...ref };
    if (name === "unassigned") return { kind: "assigned", assignee: null, ...ref };
    const assignee = personName(raw("assigned_to")) ?? personName(raw("tech")) ?? personName(raw("assignee"));
    return assignee ? { kind: "assigned", assignee, ...ref } : null;
  }
  if (name === "rescheduled" || name === "reschedule") {
    const sched = (d["schedule"] && typeof d["schedule"] === "object" ? d["schedule"] : {}) as Record<string, unknown>;
    const startsAt = iso(raw("start_at", "starts_at", "start") ?? sched["start_at"]);
    const endsAt = iso(raw("end_at", "ends_at", "end") ?? sched["end_at"]);
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

export type InboundVisit = Pick<Visit, "status" | "crew" | "starts_at" | "ends_at" | "arriveping_job_id"> & { arriveping_assigned_to?: string | null; arriveping_last_event_at?: string | null };
export type InboundPlan =
  | { ok: true; patch: Record<string, string | null>; event: { status: string; note: string; at: string } }
  | { ok: false; reason: "no change" | "stale" };

const sameTime = (a: string | null, b: string | null) => (a == null || b == null ? a == b : Date.parse(a) === Date.parse(b));

/**
 * What an ArrivePing event does to a visit: the columns to update and the activity entry to log, or why it changes nothing.
 * A finished visit (completed or cancelled) is never changed. `now` stands in for an event time that is missing or unreadable.
 * ArrivePing does not promise order, so an assignment or reschedule older than the last event applied is stale (last write
 * wins by event time); status only ever moves forward, so a late one still applies. The last-event time never goes back.
 */
export function applyInboundEvent(visit: InboundVisit, ev: ArrivePingEvent, now: string, timeZone = SCHEDULE_TZ): InboundPlan {
  const at = iso(ev.at) ?? now;
  const last = iso(visit.arriveping_last_event_at) ?? null;
  const behind = last != null && Date.parse(at) < Date.parse(last);
  const common = { arriveping_last_event_at: behind ? last : at, ...(ev.jobId && !visit.arriveping_job_id ? { arriveping_job_id: ev.jobId } : {}) };
  const closed = visit.status === "completed" || visit.status === "cancelled";
  if (ev.kind === "status") {
    const next = applyVisitEvent(visit, ev.status);
    if (!next) return { ok: false, reason: "no change" };
    return { ok: true, patch: { status: next.status, arriveping_status: next.status, ...common }, event: { status: next.status, note: next.note, at } };
  }
  if (closed) return { ok: false, reason: "no change" };
  if (behind) return { ok: false, reason: "stale" };
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
  // A new start with no end moves the visit as a whole: the old end shifts by the same amount, so its length is kept.
  const shifted = visit.ends_at ? new Date(Date.parse(visit.ends_at) + Date.parse(ev.startsAt) - Date.parse(visit.starts_at)).toISOString() : null;
  const endsAt = ev.endsAt ?? shifted;
  if (sameTime(visit.starts_at, ev.startsAt) && sameTime(visit.ends_at, endsAt)) return { ok: false, reason: "no change" };
  return { ok: true, patch: { starts_at: ev.startsAt, ends_at: endsAt, ...common }, event: { status: "rescheduled", note: `Rescheduled in ArrivePing to ${scheduleRange(ev.startsAt, endsAt, timeZone)}`, at } };
}

/** The start and end of a visit from the schedule form, in the browser's time. No end date means the same day; no end time means no end. */
export function visitTimes(form: { date: string; endDate?: string; start: string; end: string }): { startsAt: Date; endsAt: Date | null } | { error: string } {
  const startsAt = new Date(`${form.date}T${form.start}`);
  if (!form.date || !form.start || Number.isNaN(startsAt.getTime())) return { error: "Choose a date and start time." };
  if (!form.end) return { startsAt, endsAt: null };
  const endsAt = new Date(`${form.endDate || form.date}T${form.end}`);
  if (Number.isNaN(endsAt.getTime())) return { error: "Choose a date and start time." };
  if (endsAt < startsAt) return { error: "The end is before the start." };
  return { startsAt, endsAt };
}

/** A visit's dates for its row, in Winnipeg time. Several days read as the days, then the daily hours: "Dec 1 – Dec 4, 8:00 a.m. – 4:00 p.m.". */
export function visitRange(startsAt: string, endsAt: string | null, timeZone = SCHEDULE_TZ): string {
  const s = new Date(startsAt);
  const e = endsAt ? new Date(endsAt) : null;
  const day = (d: Date, year: boolean) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone }).format(d);
  const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
  if (!e || ymd(s) === ymd(e)) return scheduleRange(startsAt, endsAt, timeZone);
  const time = new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone });
  const years = ymd(s).slice(0, 4) !== ymd(e).slice(0, 4);
  return `${day(s, years)} – ${day(e, years)}, ${time.format(s)} – ${time.format(e)}`;
}

/** What ArrivePing says about a visit, in the crew's words. */
export const AP_LABEL: Record<string, string> = { scheduled: "Scheduled", assigned: "Assigned", en_route: "On the way", arrived: "On site", completed: "Completed", cancelled: "Cancelled", cancel_requested: "Cancel requested" };

/** The ArrivePing pill for a visit's row, or null when it was never sent: "Assigned to Brodie", "On the way", "Scheduled in ArrivePing". */
export function arrivepingBadge(v: { arriveping_job_id: string | null; arriveping_status: string | null; arriveping_assigned_to: string | null }): string | null {
  if (!v.arriveping_job_id) return null;
  const status = v.arriveping_status ?? "";
  if (status === "assigned" && v.arriveping_assigned_to) return `Assigned to ${v.arriveping_assigned_to}`;
  if (status === "scheduled") return "Scheduled in ArrivePing";
  return Object.hasOwn(AP_LABEL, status) ? AP_LABEL[status]! : "In ArrivePing";
}
