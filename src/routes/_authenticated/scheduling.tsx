import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import {
  VisitDrawer,
  useVisitArrivePing,
  type DrawerTarget,
} from "@/components/scheduling/VisitDrawer";
import { ArrivePingPill } from "@/components/visits/visit-bits";
import { ArrivePingInbox, useArrivePingInbox } from "@/components/scheduling/ArrivePingInbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { db, errText } from "@/lib/platform/db";
import { usePipelineProjects } from "@/lib/projects/data";
import {
  useJobAreas,
  useRefreshSchedule,
  useScheduledVisits,
  useTechnicians,
  useVisitTasks,
  type SchedVisit,
} from "@/lib/scheduling/data";
import {
  areasSummary,
  assignmentState,
  bucketWeek,
  chipTone,
  inWeek,
  isIsoDay,
  mondayOf,
  shiftWeek,
  rowsToShow,
  technicianOf,
  thisMonday,
  UNASSIGNED,
  weekDays,
  type Technician,
} from "@/lib/scheduling/logic";
import { arrivepingBadge, scheduleRange, SCHEDULE_TZ } from "@/lib/visits/logic";
import { CalendarView } from "@/components/scheduling/CalendarView";
import { useVisitsBetween } from "@/lib/scheduling/data";
import { calendarRange, monthOf, shiftMonth, today as calendarToday, type CalendarMode } from "@/lib/visits/calendar";
import { Assignments } from "@/components/scheduling/Assignments";
import { ConfirmationMark, ConfirmationPill, VisitTags } from "@/components/scheduling/schedule-bits";
import { defaultAssignmentDay } from "@/lib/scheduling/assignments";
import { useWorkCalendar } from "@/lib/scheduling/data";
import { isWorkday } from "@/lib/scheduling/workdays";

const VIEWS = ["technicians", "workorders", "tasks", "calendar", "assignments"] as const;
type View = (typeof VIEWS)[number];
type Search = { view?: View | undefined; week?: string | undefined; job?: string | undefined; cal?: CalendarMode | undefined; new?: string | undefined; day?: string | undefined };

export const Route = createFileRoute("/_authenticated/scheduling")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    view: (VIEWS as readonly unknown[]).includes(s["view"]) ? (s["view"] as View) : undefined,
    week: isIsoDay(s["week"]) ? mondayOf(s["week"]) : undefined,
    job: typeof s["job"] === "string" && s["job"] ? s["job"] : undefined,
    cal: s["cal"] === "month" ? "month" : undefined,
    // "Schedule a visit" from Crews and Subcontractors: opens the form with that crew picked.
    new: typeof s["new"] === "string" && s["new"] ? s["new"] : undefined,
    // Assignments: the day shown. With none, the next workday.
    day: isIsoDay(s["day"]) ? s["day"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Scheduling · BMD Materials" },
      {
        name: "description",
        content:
          "Install visits by crew, work orders sent to ArrivePing, and visit tasks — this week and next.",
      },
      { property: "og:title", content: "Scheduling · BMD Materials" },
      { property: "og:description", content: "Who's where, this week and next." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SchedulingPage,
});

const TONE: Record<ReturnType<typeof chipTone>, string> = {
  scheduled: "border-border bg-card",
  en_route: "border-primary/40 bg-primary/10",
  in_progress: "border-primary bg-primary text-primary-foreground",
  complete: "border-border bg-muted text-muted-foreground",
  cancelled: "border-dashed border-border bg-card text-muted-foreground line-through",
};
const VIEW_LABEL: Record<View, string> = {
  technicians: "Crews",
  workorders: "Work orders",
  tasks: "Tasks",
  calendar: "Calendar",
  assignments: "Assignments",
};
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone: SCHEDULE_TZ }).format(
    new Date(iso),
  );
const jobName = (v: SchedVisit) =>
  [v.project?.project_number, v.project?.name].filter(Boolean).join(" · ") || "Job";

function SchedulingPage() {
  const { canAny } = useAuth();
  if (!canAny("view_pipeline")) return <Navigate to="/" replace />;
  return <Scheduling />;
}

function Scheduling() {
  const { canAny } = useAuth();
  const canEdit = canAny("manage_projects");
  const search = Route.useSearch();
  const view = search.view ?? "technicians";
  const monday = search.week ?? thisMonday();
  const navigate = useNavigate({ from: "/scheduling" });
  const set = (patch: Partial<Search>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!search.new) return;
    if (canEdit) setDrawer({ create: true, tech: search.new });
    set({ new: undefined });
  }, [search.new]); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = usePipelineProjects();
  const jobs = useMemo(
    () => (projects.data ?? []).filter((p) => p.stage === "won" || p.stage === "in_progress"),
    [projects.data],
  );
  const techs = useTechnicians();
  const cal = useWorkCalendar();
  const inbox = useArrivePingInbox();
  const upcoming = view === "workorders" && !!search.job;
  const visits = useScheduledVisits(monday, { job: search.job, upcoming });
  const week = useMemo(
    () => (visits.data ?? []).filter((v) => upcoming || inWeek(v, monday)),
    [visits.data, upcoming, monday],
  );
  const calMode: CalendarMode = view === "calendar" && search.cal === "month" ? "month" : "week";
  // The month shown is the one holding the week's Sunday (the 1st is never later than its week's Sunday); with no week chosen, today's.
  const monthAnchor = search.week ? weekDays(monday)[6]! : calendarToday();
  const month = useMemo(() => (calMode === "month" ? calendarRange("month", monthAnchor) : null), [calMode, monthAnchor]);
  const monthVisits = useVisitsBetween(month?.from ?? monday, month?.to ?? monday, { job: search.job, enabled: !!month });
  // The week calendar reads by overlap too, so a visit that began more than a week ago still shows its continuation.
  const weekCal = useVisitsBetween(monday, shiftWeek(monday, 1), { job: search.job, enabled: !month && view === "calendar" });
  const monthText = new Date(`${monthOf(monthAnchor)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
  const current = thisMonday();
  const weekText =
    monday === current
      ? "This week"
      : monday === shiftWeek(current, 1)
        ? "Next week"
        : monday === shiftWeek(current, -1)
          ? "Last week"
          : `Week of ${dayLabel(monday)}`;

  return (
    <div>
      <PageHeader
        title="Scheduling"
        subtitle="Who's where, this week and next"
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setDrawer({ create: true, project: search.job })}>
              <Plus className="mr-1 h-4 w-4" />
              Schedule a visit
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => set({ view: v })}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${view === "assignments" ? "hidden" : ""}`}>
          <div className="flex items-center gap-1 rounded-md border border-border bg-card">
            <Button
              size="icon"
              variant="ghost"
              aria-label={calMode === "month" ? "Previous month" : "Previous week"}
              onClick={() => set({ week: calMode === "month" ? mondayOf(shiftMonth(monthAnchor, -1)) : shiftWeek(monday, -1) })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              className="min-w-32 px-2 text-sm font-medium"
              onClick={() => set({ week: undefined })}
              title={calMode === "month" ? "Back to this month" : "Back to this week"}
            >
              {calMode === "month" ? monthText : weekText}
            </button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={calMode === "month" ? "Next month" : "Next week"}
              onClick={() => set({ week: calMode === "month" ? mondayOf(shiftMonth(monthAnchor, 1)) : shiftWeek(monday, 1) })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <select
            aria-label="Job"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={search.job ?? ""}
            onChange={(e) => set({ job: e.target.value || undefined })}
          >
            <option value="">All jobs</option>
            {jobs.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.project_number, p.name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
          {view === "calendar" && (
            <div role="group" aria-label="Calendar view" className="flex rounded-md border border-border bg-card p-0.5 text-sm">
              {(["week", "month"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={calMode === m}
                  onClick={() => set({ cal: m === "month" ? "month" : undefined })}
                  className={`rounded px-2 py-1 ${calMode === m ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >
                  {m === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          )}
          {view === "technicians" && (
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show everyone
            </label>
          )}
          {upcoming && (
            <span className="text-xs text-muted-foreground">
              Showing every upcoming visit for this job.
            </span>
          )}
        </div>
        {view === "assignments" ? (
          <Assignments
            day={search.day ?? defaultAssignmentDay(calendarToday(), cal)}
            today={calendarToday()}
            setDay={(d) => set({ day: d })}
            techs={techs.data ?? []}
            open={setDrawer}
            canEdit={canEdit}
          />
        ) : view === "calendar" && calMode === "month" ? (
          monthVisits.isLoading || techs.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : monthVisits.error ? (
            <p className="text-sm text-destructive">{errText(monthVisits.error)}</p>
          ) : (
            <CalendarView mode="month" anchor={monthAnchor} visits={monthVisits.data ?? []} techs={techs.data ?? []} open={setDrawer} canEdit={canEdit} />
          )
        ) : visits.isLoading || techs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visits.error ? (
          <p className="text-sm text-destructive">{errText(visits.error)}</p>
        ) : view === "calendar" ? (
          weekCal.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : weekCal.error ? (
            <p className="text-sm text-destructive">{errText(weekCal.error)}</p>
          ) : (
            <CalendarView mode="week" anchor={monday} visits={weekCal.data ?? week} techs={techs.data ?? []} open={setDrawer} canEdit={canEdit} />
          )
        ) : view === "technicians" ? (
          <TechGrid
            visits={week}
            monday={monday}
            techs={techs.data ?? []}
            open={setDrawer}
            canEdit={canEdit}
            showAll={showAll}
          />
        ) : view === "workorders" ? (
          <>
            <ArrivePingInbox rows={inbox.data ?? []} jobs={jobs} canEdit={canEdit} />
            <WorkOrders visits={week} techs={techs.data ?? []} open={setDrawer} canEdit={canEdit} />
          </>
        ) : (
          <Tasks visits={week} techs={techs.data ?? []} open={setDrawer} canEdit={canEdit} />
        )}
      </div>
      <VisitDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

const techLabel = (v: SchedVisit, techs: Technician[]) => {
  const id = technicianOf(v, techs);
  return id === UNASSIGNED
    ? "Unassigned"
    : (techs.find((t) => t.id === id)?.name ??
        v.assigned_name ??
        v.arriveping_assigned_to ??
        "Unassigned");
};

function TechGrid({
  visits,
  monday,
  techs,
  open,
  canEdit,
  showAll,
}: {
  visits: SchedVisit[];
  monday: string;
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  canEdit: boolean;
  showAll: boolean;
}) {
  const days = weekDays(monday);
  const cal = useWorkCalendar();
  const off = new Set(days.filter((d) => !isWorkday(d, cal)));
  const grid = bucketWeek(visits, monday, techs);
  // Only crews with a visit this week have a row, unless "Show everyone" is ticked.
  const shown = rowsToShow(techs, new Set(grid.keys()), showAll);
  // Free-text names (subcontractors) that are on a visit this week but not in the list get their own row.
  const extra = [...grid.keys()].filter((k) => k !== UNASSIGNED && !techs.some((t) => t.id === k));
  const rows: { id: string; name: string; source?: string }[] = [
    ...shown,
    ...extra.map((id) => {
      const v = [...grid.get(id)!.values()][0]![0]!;
      return {
        id,
        name: v.assigned_name ?? v.arriveping_assigned_to ?? id.slice(3),
        source: "free",
      };
    }),
    { id: UNASSIGNED, name: "Unassigned" },
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      {!showAll && shown.length < techs.length && (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          Showing the {shown.length === 1 ? "1 crew" : `${shown.length} crews`} with a visit this week. Tick Show everyone to see all {techs.length} and who is free.
        </p>
      )}
      <table className="w-full min-w-[980px] table-fixed text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-40 p-2">Crew</th>
            {days.map((d) => (
              <th key={d} className={`p-2 ${off.has(d) ? "bg-muted" : ""}`} title={off.has(d) ? "Not a workday" : undefined}>
                {dayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="p-2">
                <div className="font-medium">{r.name}</div>
                {r.source === "supplier" && (
                  <div className="truncate text-xs text-muted-foreground">Subcontractor{(r as Technician).detail ? ` · ${(r as Technician).detail}` : ""}</div>
                )}
                {r.source === "arriveping" && (
                  <div className="text-xs text-muted-foreground">ArrivePing crew</div>
                )}
                {r.source === "free" && (
                  <div className="text-xs text-muted-foreground">Typed name, not in the catalogue</div>
                )}
              </td>
              {days.map((d) => (
                <td key={d} className={`group p-1 ${off.has(d) ? "bg-muted/60" : ""}`}>
                  <div className="space-y-1">
                    {(grid.get(r.id)?.get(d) ?? []).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => open({ visitId: v.id })}
                        className={`block w-full rounded border px-1.5 py-1 text-left text-xs ${TONE[chipTone(v)]} ${v.tentative && v.status !== "cancelled" ? "border-dashed opacity-70" : ""}`}
                      >
                        <span className="flex items-center gap-1">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {jobName(v)}
                            {v.source === "arriveping" && <span className="ml-1 text-[10px] font-normal text-muted-foreground">· ArrivePing</span>}
                          </span>
                          <ConfirmationMark v={v} />
                        </span>
                        <VisitTags v={v} />
                        {v.scope && <span className="block truncate">{v.scope}</span>}
                        <span className="block opacity-80">
                          {timeLabel(v.starts_at)}
                          {v.ends_at ? `–${timeLabel(v.ends_at)}` : ""}
                        </span>
                      </button>
                    ))}
                    {canEdit && (
                      <button
                        aria-label={`Schedule ${r.name} on ${dayLabel(d)}`}
                        onClick={() =>
                          open({
                            create: true,
                            date: d,
                            tech: r.id === UNASSIGNED ? undefined : r.id,
                          })
                        }
                        className="w-full rounded border border-dashed border-transparent py-0.5 text-xs text-muted-foreground opacity-0 focus:opacity-100 group-hover:border-border group-hover:opacity-100"
                      >
                        +
                      </button>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2 border-t border-border p-2 text-xs">
        {(["scheduled", "en_route", "in_progress", "complete", "cancelled"] as const).map((t) => (
          <span key={t} className={`rounded border px-1.5 py-0.5 ${TONE[t]}`}>
            {
              {
                scheduled: "Scheduled",
                en_route: "On the way",
                in_progress: "On site",
                complete: "Complete",
                cancelled: "Cancelled",
              }[t]
            }
          </span>
        ))}
        <span className="rounded border border-dashed border-border px-1.5 py-0.5 opacity-70">Tentative</span>
        <span className="rounded bg-muted px-1.5 py-0.5">Not a workday</span>
      </div>
    </div>
  );
}

function FloorName({ v }: { v: SchedVisit }) {
  const areas = useJobAreas(v.areas.length ? v.project_id : null);
  return <>{areasSummary(v.areas, (id) => areas.data?.find((f) => f.id === id)?.label)}</>;
}

function WorkOrders({
  visits,
  techs,
  open,
  canEdit,
}: {
  visits: SchedVisit[];
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  canEdit: boolean;
}) {
  const ap = useVisitArrivePing();
  const [busy, setBusy] = useState<string | null>(null);
  if (!visits.length)
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No visits scheduled.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Date / time</th>
            <th className="p-2">Job</th>
            <th className="p-2">Scope</th>
            <th className="p-2">Crew</th>
            <th className="p-2">Areas</th>
            <th className="p-2">ArrivePing</th>
            <th className="p-2">Crew confirmed</th>
            <th className="p-2">Tasks</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {visits.map((v) => {
            const tech = techLabel(v, techs);
            const pending = !v.tentative && assignmentState(v, tech === "Unassigned" ? null : tech) === "pending";
            const live = v.status !== "cancelled" && v.status !== "completed";
            return (
              <tr
                key={v.id}
                className={`border-t border-border ${v.status === "cancelled" ? "opacity-60" : ""}`}
              >
                <td className="p-2 whitespace-nowrap">{scheduleRange(v.starts_at, v.ends_at)}</td>
                <td className="p-2">
                  <Link
                    to="/projects/$id"
                    params={{ id: v.project_id }}
                    className="hover:underline"
                  >
                    {jobName(v)}
                  </Link>{" "}
                  <VisitTags v={v} />
                  {v.source === "arriveping" && (
                    <div>
                      <ArrivePingPill label="From ArrivePing" />
                    </div>
                  )}
                </td>
                <td className="p-2">{v.scope ?? "—"}</td>
                <td className="p-2">
                  {tech}
                  {pending && (
                    <div>
                      <ArrivePingPill label="Pending in ArrivePing" />
                    </div>
                  )}
                </td>
                <td className="p-2">
                  <FloorName v={v} />
                </td>
                <td className="p-2">
                  {v.arriveping_job_id ? (
                    <ArrivePingPill label={arrivepingBadge(v) ?? "In ArrivePing"} />
                  ) : (
                    <span className="text-muted-foreground">{v.tentative ? "Tentative — not sent" : "Not sent"}</span>
                  )}
                </td>
                <td className="p-2">{live && !v.tentative ? <ConfirmationPill v={v} /> : <span className="text-muted-foreground">—</span>}</td>
                <td className="p-2">
                  {v.tasks.filter((t) => t.done).length}/{v.tasks.length}
                </td>
                <td className="p-2 whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => open({ visitId: v.id })}>
                    Open
                  </Button>
                  {canEdit && live && !v.arriveping_job_id && v.status === "scheduled" && !v.tentative && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === v.id}
                      onClick={async () => {
                        setBusy(v.id);
                        await ap.send(v.id);
                        setBusy(null);
                      }}
                    >
                      Send to ArrivePing
                    </Button>
                  )}
                  {canEdit && live && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === v.id}
                      onClick={async () => {
                        if (!window.confirm("Cancel this visit?")) return;
                        setBusy(v.id);
                        await ap.cancel(v);
                        setBusy(null);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tasks({
  visits,
  techs,
  open,
  canEdit,
}: {
  visits: SchedVisit[];
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  canEdit: boolean;
}) {
  const live = visits.filter((v) => v.status !== "cancelled");
  const tasks = useVisitTasks(live.map((v) => v.id));
  const refresh = useRefreshSchedule();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!live.length)
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No visits this week.
      </p>
    );
  const mark = async (id: string, done: boolean) => {
    const me = (await db.auth.getUser()).data.user?.id ?? null;
    const r = await db
      .from("visit_tasks")
      .update({ done, done_at: done ? new Date().toISOString() : null, done_by: done ? me : null })
      .eq("id", id);
    if (r.error) toast.error(r.error.message);
    refresh();
  };
  const add = async (v: SchedVisit) => {
    const title = (drafts[v.id] ?? "").trim();
    if (!title) return;
    const r = await db
      .from("visit_tasks")
      .insert({ visit_id: v.id, project_id: v.project_id, title, sort: v.tasks.length });
    if (r.error) return void toast.error(r.error.message);
    setDrafts((d) => ({ ...d, [v.id]: "" }));
    refresh();
  };
  return (
    <div className="space-y-3">
      {live.map((v) => {
        const open_ = (tasks.data ?? []).filter((t) => t.visit_id === v.id && !t.done);
        return (
          <section key={v.id} className="rounded-md border border-border bg-card p-3">
            <button
              className="text-left font-semibold hover:underline"
              onClick={() => open({ visitId: v.id })}
            >
              {jobName(v)} · {scheduleRange(v.starts_at, v.ends_at)} · {techLabel(v, techs)}
            </button>{" "}
            <VisitTags v={v} />
            {v.scope && <p className="text-xs text-muted-foreground">{v.scope}</p>}
            <ul className="mt-2 space-y-1 text-sm">
              {open_.length === 0 && (
                <li className="text-xs text-muted-foreground">No open tasks.</li>
              )}
              {open_.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Done: ${t.title}`}
                    disabled={!canEdit}
                    onChange={() => void mark(t.id, true)}
                  />
                  {t.title}
                </li>
              ))}
            </ul>
            {canEdit && (
              <form
                className="mt-2 flex max-w-md gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(v);
                }}
              >
                <Input
                  className="h-9"
                  placeholder="+ Add task"
                  value={drafts[v.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
                />
                <Button type="submit" size="sm" variant="outline">
                  Add
                </Button>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
