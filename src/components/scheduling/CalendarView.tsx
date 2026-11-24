/**
 * Scheduling → Calendar: every install visit laid out by site day, a week or a month at a time. Blocks span the days
 * a visit covers; clicking one opens the visit, clicking an empty day schedules a visit on it.
 */
import { useMemo, useState } from "react";
import type { DrawerTarget } from "@/components/scheduling/VisitDrawer";
import { ConfirmationMark } from "@/components/scheduling/schedule-bits";
import { useWorkCalendar, type SchedVisit } from "@/lib/scheduling/data";
import { runLabel } from "@/lib/scheduling/runs";
import { holidayName, isWorkday, type WorkCalendar } from "@/lib/scheduling/workdays";
import { chipTone, technicianOf, UNASSIGNED, type Technician } from "@/lib/scheduling/logic";
import {
  calendarRange,
  monthGrid,
  placeVisits,
  today as siteToday,
  visitsOn,
  type CalendarMode,
} from "@/lib/visits/calendar";

const TONE: Record<ReturnType<typeof chipTone>, string> = {
  scheduled: "border-border bg-muted/60 text-foreground",
  en_route: "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100",
  in_progress: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  complete: "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  cancelled: "border-dashed border-border bg-card text-muted-foreground line-through",
};
const MONTH_LIMIT = 3;

const jobLabel = (v: SchedVisit) =>
  [v.project?.project_number, v.project?.name].filter(Boolean).join(" ") || "Job";
const dayNumber = (d: string) => String(Number(d.slice(8, 10)));
const longDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const shortDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function techName(v: SchedVisit, techs: Technician[]): string | null {
  const id = technicianOf(v, techs);
  if (id === UNASSIGNED) return v.assigned_name ?? v.arriveping_assigned_to ?? null;
  return techs.find((t) => t.id === id)?.name ?? v.assigned_name ?? v.arriveping_assigned_to ?? null;
}

function Block({
  v,
  techs,
  open,
  compact,
  fromPrev,
  toNext,
}: {
  v: SchedVisit;
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  compact?: boolean;
  fromPrev?: boolean;
  toNext?: boolean;
}) {
  const who = techName(v, techs);
  const run = runLabel(v);
  const tentative = !!v.tentative && v.status !== "cancelled";
  const title = `${jobLabel(v)}${run ? ` · ${run}` : ""}${who ? ` — ${who}` : ""}${tentative ? " (Tentative)" : ""}${v.arriveping_job_id ? " (ArrivePing)" : ""}`;
  return (
    <button
      type="button"
      onClick={() => open({ visitId: v.id })}
      title={title}
      className={`flex w-full min-w-0 items-center gap-1 overflow-hidden border px-1.5 text-left text-xs leading-5 ${TONE[chipTone(v)]} ${
        fromPrev ? "rounded-l-none border-l-0" : "rounded-l"
      } ${toNext ? "rounded-r-none border-r-0" : "rounded-r"} ${compact ? "" : "py-0.5"} ${tentative ? "border-dashed opacity-70" : ""}`}
    >
      <ConfirmationMark v={v} />
      <span className="truncate font-medium">{jobLabel(v)}</span>
      {run && <span className="shrink-0 rounded bg-foreground/10 px-1 text-[9px] font-semibold">{run}</span>}
      {tentative && <span className="shrink-0 text-[10px] font-semibold">Tentative</span>}
      {who && !compact && <span className="truncate text-muted-foreground">· {who}</span>}
      {v.arriveping_job_id && (
        <span
          aria-label="Linked to ArrivePing"
          className="ml-auto shrink-0 rounded bg-foreground/10 px-1 text-[9px] font-semibold tracking-wide"
        >
          AP
        </span>
      )}
    </button>
  );
}

function AddButton({ day, open, label }: { day: string; open: (t: DrawerTarget) => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={`Schedule a visit on ${longDay(day)}`}
      onClick={() => open({ create: true, date: day })}
      className="mt-auto w-full rounded border border-dashed border-transparent py-0.5 text-xs text-muted-foreground opacity-0 focus:opacity-100 group-hover:border-border group-hover:opacity-100"
    >
      {label ?? "+"}
    </button>
  );
}

function WeekRow({
  days,
  visits,
  techs,
  open,
  canEdit,
  compact,
  todayDay,
  showNumbers,
  inMonth,
  expanded,
  setExpanded,
}: {
  days: string[];
  visits: SchedVisit[];
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  canEdit: boolean;
  compact: boolean;
  todayDay: string;
  showNumbers: boolean;
  inMonth?: (d: string) => boolean;
  expanded?: Set<string>;
  setExpanded?: (d: string) => void;
}) {
  const cal = useWorkCalendar();
  const closed = (d: string) => !isWorkday(d, cal);
  const placed = useMemo(() => placeVisits(visits, days), [visits, days]);
  const lanes = placed.reduce((m, p) => Math.max(m, p.lane + 1), 0);
  // In the month grid, a day with more than MONTH_LIMIT visits shows the first few and "+n more" unless expanded.
  const hiddenPerDay = new Map<string, number>();
  if (compact) {
    for (const d of days) {
      const n = visitsOn(visits, d).length;
      if (n > MONTH_LIMIT && !expanded?.has(d)) hiddenPerDay.set(d, n - MONTH_LIMIT);
    }
  }
  // A block past the limit stays visible wherever one of its days is not crowded (or is expanded): a visit is never
  // hidden on a day that has room for it. Each day's height then fits the blocks actually drawn across it.
  const shown = placed.filter((p) => {
    if (!compact || p.lane < MONTH_LIMIT) return true;
    const cols = days.slice(p.col, p.col + p.span);
    return cols.some((d) => expanded?.has(d) || !hiddenPerDay.has(d));
  });
  const lanesOn = (d: string) => {
    const i = days.indexOf(d);
    return shown.reduce((m, p) => (i >= p.col && i < p.col + p.span ? Math.max(m, p.lane + 1) : m), 0);
  };
  const anyExpanded = compact && days.some((d) => expanded?.has(d));
  return (
    <div
      className="relative grid grid-cols-7 border-b border-border"
      style={{ minHeight: compact ? (anyExpanded ? undefined : 7.5 * 16) : undefined }}
    >
      {days.map((d) => {
        const off = inMonth ? !inMonth(d) : false;
        const hidden = hiddenPerDay.get(d) ?? 0;
        return (
          <div
            key={d}
            title={holidayName(d, cal) ?? undefined}
            className={`group flex min-h-24 flex-col border-r border-border last:border-r-0 ${closed(d) ? "bg-muted/60" : ""} ${
              off ? "opacity-50" : ""
            }`}
          >
            {showNumbers && (
              <div className="flex items-center justify-between px-1.5 pt-1 text-xs">
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${
                    d === todayDay ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {dayNumber(d)}
                </span>
              </div>
            )}
            {/* Space for the lanes drawn in the overlay below. */}
            <div style={{ height: `${(compact ? Math.max(lanesOn(d), hidden > 0 ? MONTH_LIMIT : 0) : lanes) * 22}px` }} />
            {hidden > 0 && (
              <button
                type="button"
                className="mx-1 rounded px-1 text-left text-xs text-muted-foreground hover:bg-muted"
                onClick={() => setExpanded?.(d)}
              >
                +{hidden} more
              </button>
            )}
            {canEdit && <AddButton day={d} open={open} />}
          </div>
        );
      })}
      <div className="pointer-events-none absolute inset-x-0 grid grid-cols-7" style={{ top: showNumbers ? 28 : 4 }}>
        {shown.map((p) => {
          return (
            <div
              key={p.visit.id + p.col}
              className="pointer-events-auto px-0.5"
              style={{ gridColumn: `${p.col + 1} / span ${p.span}`, gridRow: 1, marginTop: p.lane * 22 }}
            >
              <Block v={p.visit} techs={techs} open={open} compact={compact} fromPrev={p.fromPrev} toNext={p.toNext} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarView({
  mode,
  anchor,
  visits,
  techs,
  open,
  canEdit,
}: {
  mode: CalendarMode;
  /** A site day inside the week or month shown. */
  anchor: string;
  visits: SchedVisit[];
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  canEdit: boolean;
}) {
  const todayDay = siteToday();
  const cal: WorkCalendar = useWorkCalendar();
  const closed = (d: string) => !isWorkday(d, cal);
  const [expanded, setExpandedState] = useState<Set<string>>(new Set());
  const toggle = (d: string) =>
    setExpandedState((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const { from, to } = calendarRange("week", anchor);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = from; d <= to; d = next(d)) out.push(d);
    return out;
  }, [from, to]);
  const rows = useMemo(() => monthGrid(anchor), [anchor]);

  if (mode === "week") {
    return (
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-7 border-b border-border text-xs font-medium text-muted-foreground">
            {days.map((d) => (
              <div
                key={d}
                className={`border-r border-border px-2 py-1.5 last:border-r-0 ${d === todayDay ? "text-foreground" : ""} ${closed(d) ? "bg-muted/60" : ""}`}
              >
                <span className={d === todayDay ? "rounded bg-primary px-1.5 py-0.5 text-primary-foreground" : ""}>{shortDay(d)}</span>
              </div>
            ))}
          </div>
          <WeekRow days={days} visits={visits} techs={techs} open={open} canEdit={canEdit} compact={false} todayDay={todayDay} showNumbers={false} />
        </div>
        {!visits.length && <p className="p-3 text-sm text-muted-foreground">No visits this week.</p>}
      </div>
    );
  }

  const month = anchor.slice(0, 7);
  const inMonth = (d: string) => d.slice(0, 7) === month;
  const monthDays = rows.flat().filter(inMonth);
  return (
    <>
      {/* Wide screens: the grid. */}
      <div className="hidden rounded-md border border-border bg-card md:block">
        <div className="grid grid-cols-7 border-b border-border text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`border-r border-border px-2 py-1.5 last:border-r-0 ${cal.workdays.length && !cal.workdays.includes((i + 1) % 7) ? "bg-muted/60" : ""}`}>
              {w}
            </div>
          ))}
        </div>
        {rows.map((days) => (
          <WeekRow
            key={days[0]}
            days={days}
            visits={visits}
            techs={techs}
            open={open}
            canEdit={canEdit}
            compact
            todayDay={todayDay}
            showNumbers
            inMonth={inMonth}
            expanded={expanded}
            setExpanded={toggle}
          />
        ))}
      </div>
      {/* Phones: the month as a list of days that have something on. */}
      <div className="space-y-2 md:hidden">
        {monthDays.map((d) => {
          const list = visitsOn(visits, d);
          if (!list.length && d !== todayDay) return null;
          return (
            <div key={d} className={`group rounded-md border border-border bg-card p-2 ${closed(d) ? "bg-muted/60" : ""}`}>
              <div className={`mb-1 text-xs font-medium ${d === todayDay ? "text-primary" : "text-muted-foreground"}`}>{longDay(d)}</div>
              <div className="space-y-1">
                {list.map((v) => (
                  <Block key={v.id} v={v} techs={techs} open={open} />
                ))}
                {!list.length && <p className="text-xs text-muted-foreground">Nothing scheduled.</p>}
                {canEdit && <AddButton day={d} open={open} label="+ Schedule a visit" />}
              </div>
            </div>
          );
        })}
        {!monthDays.some((d) => visitsOn(visits, d).length) && (
          <p className="text-sm text-muted-foreground">No visits this month.</p>
        )}
      </div>
    </>
  );
}

function next(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
