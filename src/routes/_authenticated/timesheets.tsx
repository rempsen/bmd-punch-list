import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { EntrySheet } from "@/components/time/EntrySheet";
import { SendToQuickBooks } from "@/components/time/SendToQuickBooks";
import { TimeSettingsSheet } from "@/components/time/TimeSettingsSheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { isIsoDay, mondayOf, shiftWeek, siteDay, thisMonday, weekDays } from "@/lib/scheduling/logic";
import { useClockJobs, useRates, useRefreshTime, useTimePeople, useTimeSettings, useWeekEntries, type EntryWithJob } from "@/lib/time/data";
import { adjustedLine, centsText, dayText, DEFAULT_TIME_SETTINGS, entryDay, exportRows, hoursText, jobLabel, labourCostCents, mapLink, summariseWeek, timeText, type PersonRate, type PersonWeek } from "@/lib/time/logic";
import { timeApprove } from "@/lib/time/time.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/timesheets")({
  head: () => ({ meta: [{ title: "Timesheets · BMD Materials" }] }),
  validateSearch: (s: Record<string, unknown>): { week?: string } => (isIsoDay(s["week"]) ? { week: mondayOf(s["week"]) } : {}),
  component: TimesheetsPage,
});

function TimesheetsPage() {
  const { canAny, loading } = useAuth();
  if (loading) return null;
  if (!canAny("manage_projects")) return <Navigate to="/" replace />;
  return <Timesheets />;
}

const weekTitle = (monday: string) => {
  const f = (d: string, year: boolean) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return `${f(monday, false)} – ${f(weekDays(monday)[6]!, true)}`;
};

function Timesheets() {
  const { canAny } = useAuth();
  const pricing = canAny("view_pricing");
  const canSend = canAny("manage_integrations");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const monday = search.week ?? thisMonday();
  const days = weekDays(monday);
  const week = useWeekEntries(monday);
  const people = useTimePeople();
  const settings = useTimeSettings();
  const jobs = useClockJobs();
  const rates = useRates(pricing);
  const approve = useServerFn(timeApprove);
  const refresh = useRefreshTime();
  const [editing, setEditing] = useState<EntryWithJob | null>(null);
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const s = settings.data ?? DEFAULT_TIME_SETTINGS;
  const entries = week.data ?? [];
  const names = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name || p.email || "No name"])), [people.data]);
  const summary = useMemo(() => summariseWeek(entries, monday, { dailyMinutes: s.overtime_daily_minutes, weeklyMinutes: s.overtime_weekly_minutes }), [entries, monday, s.overtime_daily_minutes, s.overtime_weekly_minutes]);
  const rows = [...summary.people].sort((a, b) => (names.get(a.userId) ?? "").localeCompare(names.get(b.userId) ?? ""));
  const name = (id: string) => names.get(id) ?? "Someone";
  const canApprove = (list: EntryWithJob[]) => list.filter((e) => e.clock_out_at && !e.approved_at).map((e) => e.id);

  const setApproval = async (ids: string[], on: boolean) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await approve({ data: { ids, approve: on } });
      const left = r.skipped.length ? ` ${r.skipped.length} left as they are (${r.skipped[0]!.reason.toLowerCase()}).` : "";
      toast.success(on ? `${r.changed} approved.${left}` : `Approval removed from ${r.changed}.${left}`);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const download = async (kind: "excel" | "csv") => {
    const jobNames = new Map(entries.map((e) => [e.project_id, jobLabel(e.project)]));
    const sorted = [...entries].sort((a, b) => name(a.user_id).localeCompare(name(b.user_id)) || a.clock_in_at.localeCompare(b.clock_in_at));
    const data = exportRows(sorted, names, jobNames, pricing ? (rates.data ?? new Map<string, PersonRate>()) : null);
    if (!data.length) return void toast.error("There is nothing to export for this week.");
    const x = await import("@/lib/exporting");
    if (kind === "excel") x.exportTableExcel(data, "Timesheet", `timesheet-${monday}`);
    else x.exportTableCsv(data, `timesheet-${monday}`);
  };
  const go = (m: string) => void navigate({ search: m === thisMonday() ? {} : { week: m } });
  const todayInWeek = days.includes(siteDay(new Date())) ? siteDay(new Date()) : monday;

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle="Check the week, adjust what is wrong, approve, then send to QuickBooks."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => setAdding(true)}>
              Add missed entry
            </Button>
            <Button variant="outline" className="h-11" onClick={() => void download("excel")}>
              Excel
            </Button>
            <Button variant="outline" className="h-11" onClick={() => void download("csv")}>
              CSV
            </Button>
            {canSend && (
              <Button className="h-11" onClick={() => setSending(true)}>
                Send to QuickBooks
              </Button>
            )}
            <Button variant="outline" className="h-11 w-11 p-0" aria-label="Time clock settings" onClick={() => setShowSettings(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="Previous week" onClick={() => go(shiftWeek(monday, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-40 text-center text-base font-semibold">{weekTitle(monday)}</p>
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="Next week" onClick={() => go(shiftWeek(monday, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {monday !== thisMonday() && (
            <Button variant="ghost" className="h-11" onClick={() => go(thisMonday())}>
              This week
            </Button>
          )}
          <span className="grow" />
          <p className="text-sm text-muted-foreground">
            Week total <span className="font-semibold text-foreground tabular-nums">{hoursText(summary.totalMinutes)} h</span>
          </p>
          {canApprove(entries).length > 0 && (
            <Button className="h-11" disabled={busy} onClick={() => void setApproval(canApprove(entries), true)}>
              Approve whole week ({canApprove(entries).length})
            </Button>
          )}
        </div>

        {summary.overtime.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> Overtime heads-up
            </p>
            <ul className="mt-1 space-y-0.5">
              {summary.overtime.map((o) => {
                const p = summary.people.find((x) => x.userId === o.userId)!;
                const parts = [...o.days.map((d) => `${dayText(d)} (${hoursText(p.days[d])} h)`), ...(o.week ? [`the week (${hoursText(p.weekMinutes)} h)`] : [])];
                return (
                  <li key={o.userId}>
                    {name(o.userId)} has reached overtime: {parts.join(", ")}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-xs opacity-80">Over {s.overtime_daily_minutes / 60} h in a day or {s.overtime_weekly_minutes / 60} h in the week. A heads-up only: hours and pay are not changed.</p>
          </div>
        )}

        {week.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : week.error ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Timesheets could not be loaded: {errText(week.error)}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            Nobody clocked in this week. Crews clock in from Time clock on their phone. If someone forgot, use Add missed entry.
          </p>
        ) : (
          rows.map((p) => (
            <PersonCard
              key={p.userId}
              person={p}
              name={name(p.userId)}
              days={days}
              entries={entries.filter((e) => e.user_id === p.userId)}
              rate={pricing ? (rates.data?.get(p.userId) ?? null) : undefined}
              nameOf={name}
              busy={busy}
              onAdjust={setEditing}
              onApprove={setApproval}
            />
          ))
        )}
      </div>
      <EntrySheet entry={editing} adding={adding} defaultDay={todayInWeek} onClose={() => { setEditing(null); setAdding(false); }} people={people.data ?? []} jobs={jobs.data ?? []} increment={s.rounding_minutes} />
      <SendToQuickBooks open={sending} onClose={() => setSending(false)} />
      <TimeSettingsSheet open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}

/** One person's week: days across, the total, then each entry. `rate` is undefined for people who do not see pricing. */
function PersonCard({ person, name, days, entries, rate, nameOf, busy, onAdjust, onApprove }: { person: PersonWeek; name: string; days: string[]; entries: EntryWithJob[]; rate: PersonRate | null | undefined; nameOf: (id: string) => string; busy: boolean; onAdjust: (e: EntryWithJob) => void; onApprove: (ids: string[], on: boolean) => Promise<void> }) {
  const toApprove = entries.filter((e) => e.clock_out_at && !e.approved_at).map((e) => e.id);
  const cost = rate === undefined ? undefined : labourCostCents(person.weekMinutes, rate?.hourly_cost_cents);
  const over = person.overDays.length > 0 || person.overWeek;
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{name}</h2>
        {over && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">Overtime</span>}
        {person.clockedIn && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">Clocked in now</span>}
        <span className="grow" />
        <p className="text-sm">
          <span className={cn("font-semibold tabular-nums", person.overWeek && "text-amber-700 dark:text-amber-300")}>{hoursText(person.weekMinutes)} h</span>
          {cost !== undefined && <span className="ml-3 text-muted-foreground">Labour cost {centsText(cost)}</span>}
        </p>
        {toApprove.length > 0 && (
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => void onApprove(toApprove, true)}>
            Approve week ({toApprove.length})
          </Button>
        )}
      </div>
      <div className="grid grid-cols-7 border-b border-border text-center text-xs">
        {days.map((d) => {
          const isOver = person.overDays.includes(d);
          return (
            <div key={d} className={cn("border-r border-border px-0.5 py-2 last:border-r-0", isOver && "bg-amber-50 dark:bg-amber-950")} title={isOver ? "Over the daily overtime limit" : undefined}>
              <p className="text-muted-foreground">{dayText(d).slice(0, 3)}</p>
              <p className={cn("mt-0.5 text-sm font-medium tabular-nums", isOver && "text-amber-700 dark:text-amber-300", person.days[d] == null && "font-normal text-muted-foreground")}>{person.days[d] == null ? "–" : hoursText(person.days[d])}</p>
            </div>
          );
        })}
      </div>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <EntryRow key={e.id} entry={e} rate={rate} nameOf={nameOf} busy={busy} onAdjust={onAdjust} onApprove={onApprove} />
        ))}
      </ul>
    </section>
  );
}

const Where = ({ label, lat, lng }: { label: string; lat: number | null; lng: number | null }) =>
  lat != null && lng != null ? (
    <a className="underline underline-offset-2" href={mapLink(lat, lng)} target="_blank" rel="noreferrer">
      {label} map
    </a>
  ) : (
    <span>{label}: no location</span>
  );

function EntryRow({ entry: e, rate, nameOf, busy, onAdjust, onApprove }: { entry: EntryWithJob; rate: PersonRate | null | undefined; nameOf: (id: string) => string; busy: boolean; onAdjust: (e: EntryWithJob) => void; onApprove: (ids: string[], on: boolean) => Promise<void> }) {
  const sent = !!e.qbo_time_activity_id;
  const adjusted = adjustedLine(e, e.adjusted_by ? nameOf(e.adjusted_by) : null);
  const cost = rate === undefined ? undefined : labourCostCents(e.rounded_minutes, rate?.hourly_cost_cents);
  const status = sent ? "In QuickBooks" : e.approved_at ? "Approved" : e.clock_out_at ? "Not approved" : "Clocked in";
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1 basis-64">
        <p>
          <span className="font-medium">{dayText(entryDay(e))}</span> · {jobLabel(e.project)}
        </p>
        <p className="text-muted-foreground">
          {timeText(e.clock_in_at)}–{e.clock_out_at ? timeText(e.clock_out_at) : "still clocked in"}
          <span className="mx-2">·</span>
          <Where label="In" lat={e.in_lat} lng={e.in_lng} />
          {e.clock_out_at && (
            <>
              <span className="mx-2">·</span>
              <Where label="Out" lat={e.out_lat} lng={e.out_lng} />
            </>
          )}
        </p>
        {(e.note_in || e.note_out) && <p className="text-muted-foreground">Note: {[e.note_in, e.note_out].filter(Boolean).join("; ")}</p>}
        {adjusted && <p className="text-xs text-amber-700 dark:text-amber-300">{adjusted}</p>}
        {e.qbo_error && !sent && <p className="text-xs text-destructive">QuickBooks: {e.qbo_error}</p>}
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums">{e.clock_out_at ? `${hoursText(e.rounded_minutes)} h` : "—"}</p>
        {cost !== undefined && e.clock_out_at && <p className="text-xs text-muted-foreground">{centsText(cost)}</p>}
        <p className={cn("text-xs", sent || e.approved_at ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{status}</p>
      </div>
      <div className="flex gap-2">
        {!sent && !e.approved_at && (
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => onAdjust(e)}>
            Adjust
          </Button>
        )}
        {!sent && e.clock_out_at && !e.approved_at && (
          <Button className="h-11" disabled={busy} onClick={() => void onApprove([e.id], true)}>
            Approve
          </Button>
        )}
        {!sent && e.approved_at && (
          <Button variant="ghost" className="h-11" disabled={busy} onClick={() => void onApprove([e.id], false)}>
            Remove approval
          </Button>
        )}
      </div>
    </li>
  );
}
