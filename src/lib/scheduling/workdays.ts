/** Which days the company works: the weekdays ticked under Company settings → Scheduling, less its holidays. Pure; days are YYYY-MM-DD site days. */
export type Holiday = { day: string; name: string };
/** `workdays` are weekday numbers, 0 = Sunday … 6 = Saturday. */
export type WorkCalendar = { workdays: number[]; holidays: Holiday[] };
export const DEFAULT_CALENDAR: WorkCalendar = { workdays: [1, 2, 3, 4, 5], holidays: [] };
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const step = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** The holiday's name when the day is one, else null. */
export const holidayName = (day: string, cal: WorkCalendar): string | null => cal.holidays.find((h) => h.day === day)?.name ?? null;

/** Whether the company works that day. With no weekday ticked at all, every day counts (a settings slip must not stop scheduling). */
export function isWorkday(day: string, cal: WorkCalendar): boolean {
  if (cal.holidays.some((h) => h.day === day)) return false;
  return cal.workdays.length === 0 || cal.workdays.includes(weekday(day));
}

/** Why a day is not a workday, in a few words, or null when it is one: "Christmas Day", "a Saturday". */
export function nonWorkdayReason(day: string, cal: WorkCalendar): string | null {
  if (isWorkday(day, cal)) return null;
  const name = holidayName(day, cal);
  return name ? name : `a ${WEEKDAY_NAMES[weekday(day)]}`;
}

// A year of holidays in a row would be a settings mistake; stop looking rather than loop.
const LIMIT = 400;
const walk = (day: string, dir: 1 | -1, cal: WorkCalendar): string => {
  let d = step(day, dir);
  for (let i = 0; i < LIMIT && !isWorkday(d, cal); i++) d = step(d, dir);
  return d;
};

/** The first workday after this day. */
export const nextWorkday = (day: string, cal: WorkCalendar): string => walk(day, 1, cal);
/** This day when it is a workday, else the next one. */
export const onOrAfterWorkday = (day: string, cal: WorkCalendar): string => (isWorkday(day, cal) ? day : nextWorkday(day, cal));

/** The day `n` workdays on (or back, when negative). Zero leaves the day alone. */
export function addWorkdays(day: string, n: number, cal: WorkCalendar): string {
  let d = day;
  for (let i = 0; i < Math.min(Math.abs(n), 2000); i++) d = walk(d, n > 0 ? 1 : -1, cal);
  return d;
}

/** How many workdays lie after `from` up to and including `to`; negative when `to` is earlier. */
export function workdaysBetween(from: string, to: string, cal: WorkCalendar): number {
  if (from === to) return 0;
  const forward = to > from;
  const [a, b] = forward ? [from, to] : [to, from];
  let n = 0;
  for (let d = step(a, 1), i = 0; d <= b && i < 4000; d = step(d, 1), i++) if (isWorkday(d, cal)) n++;
  return forward ? n : -n;
}

/** The calendar from a settings row, tidied: weekday numbers 0–6 in order, holidays with a real date and a name. */
export function readCalendar(row: unknown): WorkCalendar {
  if (!row || typeof row !== "object") return DEFAULT_CALENDAR;
  const r = row as { workdays?: unknown; holidays?: unknown };
  const workdays = Array.isArray(r.workdays) ? [...new Set(r.workdays.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b) : DEFAULT_CALENDAR.workdays;
  const holidays = (Array.isArray(r.holidays) ? r.holidays : [])
    .flatMap((h): Holiday[] => {
      if (!h || typeof h !== "object") return [];
      const { day, name } = h as { day?: unknown; name?: unknown };
      if (typeof day !== "string" || !ISO_DAY.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return [];
      return [{ day, name: typeof name === "string" ? name.trim() : "" }];
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  return { workdays, holidays };
}
