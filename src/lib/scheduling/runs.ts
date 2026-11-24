/**
 * Multi-day work as a run: one visit per workday, linked by `run_id` and numbered "Day 2 of 3". Each day is still its own
 * visit and its own ArrivePing work order. Pure; days are YYYY-MM-DD site days (Winnipeg).
 */
import { siteDay } from "./logic";
import { addWorkdays, nextWorkday, onOrAfterWorkday, workdaysBetween, type WorkCalendar } from "./workdays";

export const MAX_RUN_DAYS = 30;
export type RunDay = { day: string; run_day: number | null; run_total: number | null };

/** The days of a run of `count` days starting on `start`: the first day as chosen, each later one on the next workday. One day is no run. */
export function planRun(start: string, count: number, cal: WorkCalendar): RunDay[] {
  const n = Math.max(1, Math.min(MAX_RUN_DAYS, Math.floor(Number.isFinite(count) ? count : 1)));
  if (n === 1) return [{ day: start, run_day: null, run_total: null }];
  const out: RunDay[] = [];
  for (let i = 0, d = start; i < n; i++, d = nextWorkday(d, cal)) out.push({ day: d, run_day: i + 1, run_total: n });
  return out;
}

type RunVisit = { id: string; starts_at: string; status: string };

/**
 * Where each visit of a run goes when one day is moved to `newDay`. "one" moves only that day; "following" also shifts
 * every later live day by the same number of workdays. Earlier days and cancelled days never move. An empty list is no move.
 */
export function shiftRun(run: RunVisit[], movedId: string, newDay: string, mode: "one" | "following", cal: WorkCalendar, tz?: string): { id: string; day: string }[] {
  const moved = run.find((v) => v.id === movedId);
  if (!moved) return [];
  const oldDay = siteDay(moved.starts_at, tz);
  if (oldDay === newDay) return [];
  const out = [{ id: moved.id, day: newDay }];
  if (mode === "one") return out;
  const delta = workdaysBetween(oldDay, newDay, cal);
  const later = run.filter((v) => v.id !== movedId && v.status !== "cancelled" && v.starts_at > moved.starts_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  let previous = newDay;
  for (const v of later) {
    // Shifted by the same number of workdays, and always on a workday after the day before it.
    let day = onOrAfterWorkday(addWorkdays(siteDay(v.starts_at, tz), delta, cal), cal);
    if (day <= previous) day = nextWorkday(previous, cal);
    previous = day;
    if (day !== siteDay(v.starts_at, tz)) out.push({ id: v.id, day });
  }
  return out;
}

/** The run's numbering after a change: live days numbered in date order; cancelled days, and a run left with one day, are no longer in it. The database keeps the same rule (renumber_visit_run). */
export function renumberRun(run: RunVisit[]): { id: string; run_day: number | null; run_total: number | null; in_run: boolean }[] {
  const live = run.filter((v) => v.status !== "cancelled").sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
  const total = live.length;
  return run.map((v) => {
    const i = live.indexOf(v);
    return i >= 0 && total > 1 ? { id: v.id, run_day: i + 1, run_total: total, in_run: true } : { id: v.id, run_day: null, run_total: null, in_run: false };
  });
}

/** "Day 2 of 3", or null for a visit that is not part of a run. */
export const runLabel = (v: { run_day?: number | null; run_total?: number | null }): string | null =>
  v.run_day && v.run_total && v.run_total > 1 ? `Day ${v.run_day} of ${v.run_total}` : null;
