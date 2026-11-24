/** Pure rules for the Scheduling calendar (week and month): which site days a visit covers and how blocks are laid out. No I/O. */
import { mondayOf, siteDay, visitDays, weekDays } from "@/lib/scheduling/logic";
import { SCHEDULE_TZ } from "@/lib/visits/logic";

export type CalendarMode = "week" | "month";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The first of the month holding this day. */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
/** The first of the month `n` months on. */
export function shiftMonth(first: string, n: number): string {
  const d = new Date(`${first.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7) + "-01";
}
/** The site days of the month, in order. */
export function daysOfMonth(first: string): string[] {
  const start = monthOf(first);
  const out: string[] = [];
  for (let d = start; d.slice(0, 7) === start.slice(0, 7); d = addDays(d, 1)) out.push(d);
  return out;
}
/** The week rows (Mon–Sun) a month grid shows: whole weeks from the one holding the 1st to the one holding the last day. */
export function monthGrid(first: string): string[][] {
  const days = daysOfMonth(first);
  const from = mondayOf(days[0]!);
  const to = addDays(mondayOf(days[days.length - 1]!), 6);
  const rows: string[][] = [];
  for (let m = from; m <= to; m = addDays(m, 7)) rows.push(weekDays(m));
  return rows;
}
export const daysOfWeek = weekDays;

/** Whether a visit touches this site day. */
export const visitSpansDay = (
  v: { starts_at: string; ends_at: string | null },
  day: string,
  tz = SCHEDULE_TZ,
) => visitDays(v, tz).includes(day);

/** The window of site days a mode shows around an anchor: `[from, to]` inclusive. */
export function calendarRange(mode: CalendarMode, anchor: string): { from: string; to: string } {
  if (mode === "week") {
    const m = mondayOf(anchor);
    return { from: m, to: addDays(m, 6) };
  }
  const rows = monthGrid(anchor);
  return { from: rows[0]![0]!, to: rows[rows.length - 1]![6]! };
}

export type Placed<V> = {
  visit: V;
  /** Column (0 = first day of the row) where the block starts in this row. */
  col: number;
  /** How many columns it spans in this row. */
  span: number;
  /** Continues from the previous row / into the next row. */
  fromPrev: boolean;
  toNext: boolean;
  /** Stacking slot inside the row (0 = top). */
  lane: number;
};

type Spanning = { id: string; starts_at: string; ends_at: string | null; project?: { project_number: string | null; name: string } | null };

/** Stable order: start time, then job number/name, then id. */
export function sortVisits<V extends Spanning>(visits: V[]): V[] {
  const key = (v: V) =>
    `${v.starts_at}\u0000${v.project?.project_number ?? ""}\u0000${v.project?.name ?? ""}\u0000${v.id}`;
  return [...visits].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * Lay the visits that touch a row of days out as blocks: each visit becomes one block per row, spanning the row's days it
 * covers, and takes the lowest lane free across those columns so blocks never overlap.
 */
export function placeVisits<V extends Spanning>(visits: V[], row: string[], tz = SCHEDULE_TZ): Placed<V>[] {
  if (!row.length) return [];
  const first = row[0]!;
  const last = row[row.length - 1]!;
  const out: Placed<V>[] = [];
  const lanes: number[][] = []; // lanes[lane][col] = 1 when taken
  for (const visit of sortVisits(visits)) {
    const days = visitDays(visit, tz);
    const from = days[0]!;
    const to = days[days.length - 1]!;
    if (to < first || from > last) continue;
    const start = from < first ? 0 : row.indexOf(from);
    const end = to > last ? row.length - 1 : row.indexOf(to);
    if (start < 0 || end < 0) continue;
    let lane = 0;
    while (lanes[lane]?.slice(start, end + 1).some(Boolean)) lane++;
    lanes[lane] ??= [];
    for (let c = start; c <= end; c++) lanes[lane]![c] = 1;
    out.push({ visit, col: start, span: end - start + 1, fromPrev: from < first, toNext: to > last, lane });
  }
  return out;
}

/** Visits on one day, in stable order (month cells and the mobile day list). */
export function visitsOn<V extends Spanning>(visits: V[], day: string, tz = SCHEDULE_TZ): V[] {
  return sortVisits(visits).filter((v) => visitSpansDay(v, day, tz));
}

/** Today's site day. */
export const today = (now: Date = new Date(), tz = SCHEDULE_TZ) => siteDay(now, tz);
export const isWeekend = (day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};
