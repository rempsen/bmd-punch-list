/**
 * Pure rules for the time clock and timesheets. No I/O. Days and weeks are site days (Winnipeg), Monday first.
 * The exact clock-in and clock-out instants are always kept; paid time is the rounded minutes worked out by `roundMinutes`.
 */
import { siteDay, shiftWeek, weekDays } from "@/lib/scheduling/logic";
import { SCHEDULE_TZ } from "@/lib/visits/logic";

export type Original = { clock_in_at: string; clock_out_at: string | null; project_id: string; rounded_minutes: number | null };
export type TimeEntry = {
  id: string;
  user_id: string;
  project_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  /** Paid minutes, rounded. Null while the person is still clocked in. */
  rounded_minutes: number | null;
  in_lat: number | null;
  in_lng: number | null;
  in_accuracy_m: number | null;
  out_lat: number | null;
  out_lng: number | null;
  out_accuracy_m: number | null;
  note_in: string | null;
  note_out: string | null;
  /** 'clock' when the person clocked in themselves; 'office' for a missed entry the office added. */
  source: "clock" | "office";
  /** What the entry said before the office first changed it. */
  original: Original | null;
  adjusted_at: string | null;
  adjusted_by: string | null;
  adjust_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  qbo_time_activity_id: string | null;
  qbo_sent_at: string | null;
  qbo_error: string | null;
  qbo_attempts: number;
};
export type TimeSettings = { rounding_minutes: number; overtime_daily_minutes: number; overtime_weekly_minutes: number };
export const DEFAULT_TIME_SETTINGS: TimeSettings = { rounding_minutes: 15, overtime_daily_minutes: 480, overtime_weekly_minutes: 2400 };
export type Location = { lat: number; lng: number; accuracy: number };

// ── Rounding ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * THE rounding rule: paid minutes are the time between in and out, to the nearest `increment` minutes, half way going up.
 * With 15: 7 minutes is 0, 8 minutes is 15. Never negative. An unusable increment falls back to 15.
 */
export function roundMinutes(clockInAt: string, clockOutAt: string, increment: number = 15): number {
  const inc = Number.isFinite(increment) && increment >= 1 && increment <= 60 ? Math.floor(increment) : 15;
  const ms = Date.parse(clockOutAt) - Date.parse(clockInAt);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / (inc * 60_000)) * inc;
}

// ── Winnipeg days and weeks ────────────────────────────────────────────────────────────────────────────────
/** The instant a wall-clock date and time ("2026-12-01", "08:00") names in a time zone, daylight saving included. */
export function zonedInstant(date: string, time: string, timeZone: string = SCHEDULE_TZ): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})/.exec(time);
  if (!d || !t) return null;
  const [y, mo, day, h, mi] = [+d[1]!, +d[2]!, +d[3]!, +t[1]!, +t[2]!];
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, day, h, mi);
  if (Number.isNaN(wall) || new Date(wall).getUTCDate() !== day) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const offset = (ms: number) => {
    const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p["year"]!, +p["month"]! - 1, +p["day"]!, +p["hour"]!, +p["minute"]!, +p["second"]!) - ms;
  };
  const first = wall - offset(wall);
  return new Date(wall - offset(first));
}

/** The instants a Monday-to-Sunday week starts and ends at (end not included). */
export function weekBounds(monday: string, tz: string = SCHEDULE_TZ): { from: string; to: string } {
  return { from: zonedInstant(monday, "00:00", tz)!.toISOString(), to: zonedInstant(shiftWeek(monday, 1), "00:00", tz)!.toISOString() };
}

/** The site day an entry counts on: the day the person clocked in, even when the shift runs past midnight. */
export const entryDay = (e: Pick<TimeEntry, "clock_in_at">, tz: string = SCHEDULE_TZ): string => siteDay(e.clock_in_at, tz);

/** The wall-clock time of an instant in site time, as "HH:MM" for a time input. */
export function wallTime(at: string, tz: string = SCHEDULE_TZ): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return `${p["hour"]}:${p["minute"]}`;
}
export const timeText = (at: string, tz: string = SCHEDULE_TZ): string => new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone: tz }).format(new Date(at));
export const dayText = (day: string): string => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

// ── Totals and the overtime heads-up ───────────────────────────────────────────────────────────────────────
export type PersonWeek = {
  userId: string;
  /** Paid minutes per site day (only days with closed entries). */
  days: Record<string, number>;
  weekMinutes: number;
  /** Days over the daily limit. A heads-up only: hours and pay are never changed. */
  overDays: string[];
  overWeek: boolean;
  clockedIn: boolean;
  entryIds: string[];
};
export type WeekSummary = { people: PersonWeek[]; totalMinutes: number; overtime: { userId: string; days: string[]; week: boolean }[] };

/** One week's totals by person and day. Entries outside the week are ignored; an open entry counts for nothing until it is closed. */
export function summariseWeek(entries: TimeEntry[], monday: string, limits: { dailyMinutes: number; weeklyMinutes: number }, tz: string = SCHEDULE_TZ): WeekSummary {
  const inWeek = new Set(weekDays(monday));
  const byUser = new Map<string, PersonWeek>();
  for (const e of entries) {
    const day = entryDay(e, tz);
    if (!inWeek.has(day)) continue;
    const p = byUser.get(e.user_id) ?? { userId: e.user_id, days: {}, weekMinutes: 0, overDays: [], overWeek: false, clockedIn: false, entryIds: [] };
    p.entryIds.push(e.id);
    if (e.clock_out_at == null || e.rounded_minutes == null) p.clockedIn = true;
    else {
      p.days[day] = (p.days[day] ?? 0) + e.rounded_minutes;
      p.weekMinutes += e.rounded_minutes;
    }
    byUser.set(e.user_id, p);
  }
  const people = [...byUser.values()];
  for (const p of people) {
    p.overDays = Object.keys(p.days).filter((d) => p.days[d]! > limits.dailyMinutes).sort();
    p.overWeek = p.weekMinutes > limits.weeklyMinutes;
  }
  return {
    people,
    totalMinutes: people.reduce((n, p) => n + p.weekMinutes, 0),
    overtime: people.filter((p) => p.overDays.length > 0 || p.overWeek).map((p) => ({ userId: p.userId, days: p.overDays, week: p.overWeek })),
  };
}

// ── Clocking in and out ────────────────────────────────────────────────────────────────────────────────────
const clean = (s: string | null | undefined): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, 1000) : null);
const usable = (l: Location | null | undefined): Location | null =>
  l && Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180 ? { lat: l.lat, lng: l.lng, accuracy: Number.isFinite(l.accuracy) && l.accuracy >= 0 ? l.accuracy : 0 } : null;

export type ClockInRow = { user_id: string; project_id: string; clock_in_at: string; note_in: string | null; in_lat: number | null; in_lng: number | null; in_accuracy_m: number | null; source: "clock"; created_by: string };
export function planClockIn(i: { open: Pick<TimeEntry, "id" | "project_id"> | null; userId: string; projectId: string; now: string; note: string | null; location: Location | null }):
  | { ok: true; row: ClockInRow }
  | { ok: false; reason: string; openId: string; openProjectId: string } {
  if (i.open) return { ok: false, reason: "You are still clocked in on another job. Clock out of it first.", openId: i.open.id, openProjectId: i.open.project_id };
  const l = usable(i.location);
  return { ok: true, row: { user_id: i.userId, project_id: i.projectId, clock_in_at: i.now, note_in: clean(i.note), in_lat: l?.lat ?? null, in_lng: l?.lng ?? null, in_accuracy_m: l ? l.accuracy : null, source: "clock", created_by: i.userId } };
}

export type ClockOutPatch = { clock_out_at: string; rounded_minutes: number; note_out: string | null; out_lat: number | null; out_lng: number | null; out_accuracy_m: number | null };
export function planClockOut(i: { open: Pick<TimeEntry, "clock_in_at"> | null; now: string; increment: number; note: string | null; location: Location | null }): { ok: true; patch: ClockOutPatch } | { ok: false; reason: string } {
  if (!i.open) return { ok: false, reason: "You are not clocked in." };
  const l = usable(i.location);
  return { ok: true, patch: { clock_out_at: i.now, rounded_minutes: roundMinutes(i.open.clock_in_at, i.now, i.increment), note_out: clean(i.note), out_lat: l?.lat ?? null, out_lng: l?.lng ?? null, out_accuracy_m: l ? l.accuracy : null } };
}

// ── The office: adjust and approve ─────────────────────────────────────────────────────────────────────────
export type Change = { clockInAt: string; clockOutAt: string | null; projectId: string; reason: string };
const SENT = "This entry has been sent to QuickBooks and can no longer be changed here.";

function checkChange(c: Change): string | null {
  if (!clean(c.reason)) return "Say briefly why this is being changed.";
  if (!c.projectId) return "Choose the job.";
  if (Number.isNaN(Date.parse(c.clockInAt))) return "Enter the clock-in time.";
  if (c.clockOutAt != null && Number.isNaN(Date.parse(c.clockOutAt))) return "Enter the clock-out time.";
  if (c.clockOutAt != null && Date.parse(c.clockOutAt) < Date.parse(c.clockInAt)) return "The clock-out is before the clock-in.";
  return null;
}

export type AdjustPatch = { clock_in_at: string; clock_out_at: string | null; project_id: string; rounded_minutes: number | null; original: Original; adjusted_at: string; adjusted_by: string; adjust_reason: string };
/** A change to an entry's in, out or job. The values from before the first change are kept for good. Approved entries are locked. */
export function planAdjust(i: { entry: TimeEntry; change: Change; by: string; now: string; increment: number }): { ok: true; patch: AdjustPatch } | { ok: false; reason: string } {
  const { entry: e, change: c } = i;
  if (e.qbo_time_activity_id) return { ok: false, reason: SENT };
  if (e.approved_at) return { ok: false, reason: "This entry is approved. Remove the approval before changing it." };
  const bad = checkChange(c);
  if (bad) return { ok: false, reason: bad };
  return {
    ok: true,
    patch: {
      clock_in_at: c.clockInAt,
      clock_out_at: c.clockOutAt,
      project_id: c.projectId,
      rounded_minutes: c.clockOutAt == null ? null : roundMinutes(c.clockInAt, c.clockOutAt, i.increment),
      original: e.original ?? { clock_in_at: e.clock_in_at, clock_out_at: e.clock_out_at, project_id: e.project_id, rounded_minutes: e.rounded_minutes },
      adjusted_at: i.now,
      adjusted_by: i.by,
      adjust_reason: clean(c.reason)!,
    },
  };
}

export type MissedRow = { user_id: string; project_id: string; clock_in_at: string; clock_out_at: string; rounded_minutes: number; source: "office"; created_by: string; adjusted_at: string; adjusted_by: string; adjust_reason: string };
/** An entry the office adds for someone who never clocked in. Always closed, always with a reason. */
export function planMissedEntry(i: { userId: string; change: Change; by: string; now: string; increment: number }): { ok: true; row: MissedRow } | { ok: false; reason: string } {
  const c = i.change;
  if (c.clockOutAt == null) return { ok: false, reason: "A missed entry needs both a clock-in and a clock-out." };
  const bad = checkChange(c);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, row: { user_id: i.userId, project_id: c.projectId, clock_in_at: c.clockInAt, clock_out_at: c.clockOutAt, rounded_minutes: roundMinutes(c.clockInAt, c.clockOutAt, i.increment), source: "office", created_by: i.by, adjusted_at: i.now, adjusted_by: i.by, adjust_reason: clean(c.reason)! } };
}

/** "Adjusted by Dana from 7:02 a.m.–3:40 p.m. · reason", "Added by Dana · reason", or null for an untouched entry. */
export function adjustedLine(e: Pick<TimeEntry, "original" | "source" | "adjust_reason" | "adjusted_by">, byName: string | null | undefined, tz: string = SCHEDULE_TZ): string | null {
  const who = byName || "the office";
  const why = e.adjust_reason ? ` · ${e.adjust_reason}` : "";
  if (e.original) return `Adjusted by ${who} from ${timeText(e.original.clock_in_at, tz)}–${e.original.clock_out_at ? timeText(e.original.clock_out_at, tz) : "still clocked in"}${why}`;
  if (e.source === "office") return `Added by ${who}${why}`;
  return null;
}

/** Which of the chosen entries can be approved (or have approval removed), and why the rest cannot. */
export function planApprove(i: { entries: Pick<TimeEntry, "id" | "clock_out_at" | "approved_at" | "qbo_time_activity_id">[]; approve: boolean; by: string; now: string }): {
  ids: string[];
  patch: { approved_at: string | null; approved_by: string | null };
  skipped: { id: string; reason: string }[];
} {
  const ids: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const e of i.entries) {
    if (i.approve) {
      if (e.approved_at) continue;
      if (e.clock_out_at == null) skipped.push({ id: e.id, reason: "Still clocked in" });
      else ids.push(e.id);
    } else {
      if (!e.approved_at) continue;
      if (e.qbo_time_activity_id) skipped.push({ id: e.id, reason: "Already sent to QuickBooks" });
      else ids.push(e.id);
    }
  }
  return { ids, patch: i.approve ? { approved_at: i.now, approved_by: i.by } : { approved_at: null, approved_by: null }, skipped };
}

// ── Rates ──────────────────────────────────────────────────────────────────────────────────────────────────
export type PersonRate = { hourly_cost_cents?: number | null; billable_rate_cents: number | null };
export type ProjectPersonRate = { billable_rate_cents: number | null };

/**
 * A person's billable rate on a job, in cents an hour: the job's own rate for them if one is set, else their default.
 * Null means unknown, which is never the same as zero.
 */
export function rateFor(person: PersonRate | null | undefined, project: ProjectPersonRate | null | undefined): number | null {
  if (project && project.billable_rate_cents != null) return project.billable_rate_cents;
  return person?.billable_rate_cents ?? null;
}

/** What paid minutes cost at an hourly cost. Unknown cost, or an open entry, is unknown (null), never zero. */
export function labourCostCents(minutes: number | null | undefined, hourlyCostCents: number | null | undefined): number | null {
  if (minutes == null || hourlyCostCents == null) return null;
  return Math.round((minutes * hourlyCostCents) / 60);
}

/** A typed dollar amount as cents. Blank is unknown (null); anything that is not a plain amount is refused. */
export function dollarsToCents(text: string): { ok: true; cents: number | null } | { ok: false } {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return { ok: true, cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false };
  const cents = Math.round(Number(t) * 100);
  return cents <= 100_000_00 ? { ok: true, cents } : { ok: false };
}
export const centsText = (cents: number | null | undefined): string => (cents == null ? "Unknown" : `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// ── Words ──────────────────────────────────────────────────────────────────────────────────────────────────
export const hoursText = (minutes: number | null | undefined): string => (minutes == null ? "—" : (minutes / 60).toFixed(2));

/** The running time of an open entry, as "3 h 05 min". */
export function runningText(clockInAt: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(clockInAt)) / 60_000));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** "2 clocked in: Ana, Ben" for a job's Overview, or null when nobody is. */
export function clockedInLine(names: string[]): string | null {
  if (names.length === 0) return null;
  return `${names.length} clocked in: ${[...names].sort((a, b) => a.localeCompare(b)).join(", ")}`;
}

export const mapLink = (lat: number, lng: number): string => `https://www.google.com/maps?q=${lat},${lng}`;
