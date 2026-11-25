import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TechnicianPicker } from "@/components/scheduling/TechnicianPicker";
import { ArrivePingPill, OpenInArrivePing, StatusPill } from "@/components/visits/visit-bits";
import { WorkItems } from "@/components/visits/WorkItems";
import { useProjectVisitLines } from "@/lib/visits/data";
import { linesChanged, num, type VisitLine } from "@/lib/visits/lines";
import { cancelVisitPush, pushVisit, rescheduleVisitPush } from "@/lib/arriveping/arriveping.functions";
import { MAX_WORK_ORDER_MS } from "@/lib/arriveping/core";
import { useAuth } from "@/lib/auth";
import { db, errText } from "@/lib/platform/db";
import { usePipelineProjects } from "@/lib/projects/data";
import {
  useAssignmentLink,
  useJobAreas,
  useRefreshSchedule,
  useRunVisits,
  useSuggestedCrews,
  useTechnicians,
  useVisit,
  useVisitsAround,
  useVisitTasks,
  useWorkCalendar,
  type SchedVisit,
} from "@/lib/scheduling/data";
import { confirmationOf, reportTimeLabel, type ReportTo } from "@/lib/scheduling/assignments";
import { ConfirmationPill } from "@/components/scheduling/schedule-bits";
import { MAX_RUN_DAYS, planRun, runLabel, shiftRun } from "@/lib/scheduling/runs";
import { nonWorkdayReason } from "@/lib/scheduling/workdays";
import {
  areasFromSelection,
  canSchedule,
  startingTasks,
  assignmentFor,
  assignmentState,
  clashesFor,
  suggestedCrews,
  SUP,
  selectionFromAreas,
  toggleFloor,
} from "@/lib/scheduling/logic";
import {
  applyVisitEvent,
  arrivepingPill,
  SCHEDULE_TZ,
  scheduleRange,
  visitNote,
  visitRange,
  visitTimes,
  VISIT_LABEL,
} from "@/lib/visits/logic";

export const SEE_SETTINGS = "see Company settings → Integrations.";
export const ONE_DAY_MESSAGE =
  "ArrivePing takes one day per work order, and this visit runs longer than 24 hours. Schedule one visit per day, then send each.";

type Form = {
  project: string;
  scope: string;
  date: string;
  start: string;
  end: string;
  tech: string;
  techName: string;
  contact: string;
  notes: string;
  rooms: Set<string>;
  /** How many days of work, when scheduling: more than one makes a run of one-day visits. */
  days: string;
  tentative: boolean;
  reportTo: ReportTo;
  reportOther: string;
  /** "" means the visit's start time. */
  reportTime: string;
};
type DraftTask = { id?: string; title: string; done: boolean };

const wall = (iso: string, opt: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-CA", { ...opt, timeZone: SCHEDULE_TZ }).format(new Date(iso));
const dayOf = (iso: string) => wall(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
const timeOf = (iso: string) => wall(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const FREE = "__free__";
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function formFor(
  v: SchedVisit | null | undefined,
  d: { project?: string | undefined; date?: string | undefined; tech?: string | undefined },
): Form {
  if (!v)
    return {
      project: d.project ?? "",
      scope: "",
      date: d.date ?? "",
      start: "08:00",
      end: "16:00",
      tech: d.tech && !d.tech.startsWith("ap:") ? d.tech : "",
      techName: "",
      contact: "",
      notes: "",
      rooms: new Set(),
      days: "1",
      tentative: false,
      reportTo: "site",
      reportOther: "",
      reportTime: "",
    };
  return {
    project: v.project_id,
    scope: v.scope ?? "",
    date: dayOf(v.starts_at),
    start: timeOf(v.starts_at),
    end: v.ends_at ? timeOf(v.ends_at) : "",
    // A name typed before technicians came from the catalogue is kept (FREE) until someone picks or adds the person.
    tech: v.assigned_user_id ?? (v.technician_supplier_id ? SUP + v.technician_supplier_id : v.assigned_name ? FREE : ""),
    techName: v.assigned_name ?? "",
    contact: v.site_contact ?? "",
    notes: v.notes ?? "",
    rooms: selectionFromAreas(v.areas),
    days: "1",
    tentative: !!v.tentative,
    reportTo: v.report_to === "shop" || v.report_to === "other" ? v.report_to : "site",
    reportOther: v.report_to_other ?? "",
    reportTime: (v.report_time ?? "").slice(0, 5),
  };
}

/** Sends to ArrivePing and cancels there, reporting rather than throwing: the BMD visit always stands on its own. */
export function useVisitArrivePing() {
  const pushFn = useServerFn(pushVisit);
  const cancelFn = useServerFn(cancelVisitPush);
  const rescheduleFn = useServerFn(rescheduleVisitPush);
  const refresh = useRefreshSchedule();
  /** After an existing visit is saved: logs the move and, for a visit in ArrivePing, puts the new schedule on its work order. */
  const reschedule = async (v: { id: string; starts_at: string; ends_at: string | null; arriveping_job_id: string | null }, quiet = false) => {
    try {
      const r = await rescheduleFn({ data: { visitId: v.id, previousStartsAt: v.starts_at, previousEndsAt: v.ends_at } });
      if (r.push?.outcome === "failed")
        toast.warning(`Work order saved. ArrivePing wasn't updated — ${SEE_SETTINGS}`, { description: r.push.error });
      else if (quiet) return;
      else if (r.push?.outcome === "sent") toast.success("Work order saved. ArrivePing updated.");
      else toast.success("Work order saved.");
    } catch (e) {
      if (v.arriveping_job_id) toast.warning(`Work order saved. ArrivePing wasn't updated — ${SEE_SETTINGS}`, { description: errText(e) });
      else if (!quiet) toast.success("Work order saved.");
    } finally {
      refresh();
    }
  };
  const send = async (visitId: string, quiet = false) => {
    try {
      const r = await pushFn({ data: { visitId } });
      if (r.outcome === "failed")
        toast.warning(`Couldn't send to ArrivePing — ${SEE_SETTINGS}`, { description: r.error });
      else if (r.outcome === "skipped" && r.reason === "tentative") {
        if (!quiet) toast.info("Tentative work orders are not sent to ArrivePing. Clear Tentative on the visit first.");
      } else if (!quiet)
        if (r.outcome === "sent") toast.success("Sent to ArrivePing.");
        else toast.info("Already in ArrivePing.");
      return r.outcome;
    } catch (e) {
      toast.warning(`Couldn't send to ArrivePing — ${SEE_SETTINGS}`, { description: errText(e) });
      return "failed" as const;
    } finally {
      refresh();
    }
  };
  const cancel = async (v: {
    id: string;
    project_id: string;
    status: SchedVisit["status"];
    crew: string | null;
    arriveping_job_id: string | null;
  }) => {
    const next = applyVisitEvent(v, "cancelled");
    if (!next) {
      toast.error("That work order is already past that point.");
      return false;
    }
    try {
      const u = await db.from("install_visits").update({ status: next.status }).eq("id", v.id);
      if (u.error) throw new Error(u.error.message);
      const ev = await db
        .from("install_visit_events")
        .insert({ visit_id: v.id, project_id: v.project_id, status: next.status, note: next.note });
      if (ev.error) console.error(`install_visit_events: ${ev.error.message}`);
    } catch (e) {
      toast.error(errText(e));
      refresh();
      return false;
    }
    let failure: string | null = null;
    let told = false;
    try {
      const r = await cancelFn({ data: { visitId: v.id } });
      if (r.outcome === "failed") failure = r.error;
      told = r.outcome === "sent";
    } catch (e) {
      if (v.arriveping_job_id) failure = errText(e);
    }
    if (failure)
      toast.warning(`Cancelled here. ArrivePing wasn't told — ${SEE_SETTINGS}`, {
        description: failure,
      });
    else
      toast.success(
        told ? "Work order cancelled. ArrivePing asked to cancel too." : "Marked cancelled.",
      );
    refresh();
    return true;
  };
  return { send, cancel, reschedule };
}

export type DrawerTarget =
  | { visitId: string }
  | {
      create: true;
      project?: string | undefined;
      date?: string | undefined;
      tech?: string | undefined;
    };

/** One visit, to create or edit. Used by Scheduling and by the job's Install visits panel. */
export function VisitDrawer({
  target,
  onClose,
  lockProject,
}: {
  target: DrawerTarget | null;
  onClose: () => void;
  lockProject?: boolean;
}) {
  const editId = target && "visitId" in target ? target.visitId : null;
  const visit = useVisit(editId);
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{editId ? "Work order" : "New work order"}</SheetTitle>
        </SheetHeader>
        {target &&
          (editId && !visit.data ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {visit.error ? errText(visit.error) : "Loading…"}
            </p>
          ) : (
            <DrawerBody
              key={editId ?? "new"}
              visit={editId ? visit.data! : null}
              defaults={"create" in target ? target : {}}
              lockProject={!!lockProject}
              onClose={onClose}
            />
          ))}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  visit,
  defaults,
  lockProject,
  onClose,
}: {
  visit: SchedVisit | null;
  defaults: { project?: string | undefined; date?: string | undefined; tech?: string | undefined };
  lockProject: boolean;
  onClose: () => void;
}) {
  const { canAny } = useAuth();
  const canEdit = canAny("manage_projects");
  const projects = usePipelineProjects();
  const techs = useTechnicians();
  const refresh = useRefreshSchedule();
  const ap = useVisitArrivePing();
  const [f, setF] = useState<Form>(() => formFor(visit, defaults));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A day of a run moved to another date: ask whether the following days move too.
  const [moveAsk, setMoveAsk] = useState(false);
  const cal = useWorkCalendar();
  const inRun = !!(visit?.run_id && runLabel(visit));
  const runVisits = useRunVisits(inRun ? visit!.run_id : null);
  const sentTo = useAssignmentLink(visit?.assignment_link_id, canEdit);
  const areas = useJobAreas(f.project || null);
  const savedTasks = useVisitTasks(visit ? [visit.id] : []);
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [newTask, setNewTask] = useState("");
  // The estimate items this work order covers. An existing work order's lines are read once; a new one starts empty.
  const allLines = useProjectVisitLines(visit?.project_id ?? f.project ?? "");
  const savedLines = useMemo(() => (visit ? (allLines.data ?? []).filter((l) => l.visit_id === visit.id) : []), [allLines.data, visit]);
  const [lines, setLines] = useState<VisitLine[]>([]);
  const linesSeeded = useRef(false);
  useEffect(() => {
    if (!visit || linesSeeded.current || !allLines.data) return;
    linesSeeded.current = true;
    setLines(savedLines);
  }, [visit, allLines.data, savedLines]);
  useEffect(() => {
    // A new work order's rooms and work items belong to the job picked; changing the job starts both over.
    if (!visit) {
      setF((x) => ({ ...x, rooms: new Set() }));
      setLines([]);
    }
  }, [f.project, visit]);
  // A new visit starts with the job's standard tasks; tasks the person typed are never replaced.
  const autoTasks = useRef<DraftTask[] | null>(null);
  const standardTasks = (projects.data ?? []).find((p) => p.id === f.project)?.standard_tasks;
  const standardKey = (standardTasks ?? []).join("\n");
  useEffect(() => {
    if (visit || !projects.data) return;
    setDraftTasks((cur) => {
      const next = startingTasks(cur, autoTasks.current, standardTasks ?? []);
      if (next.tasks === cur) return cur;
      autoTasks.current = next.filled ? next.tasks : null;
      return next.tasks;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.project, standardKey, visit, !!projects.data]);

  const jobs = useMemo(
    () =>
      (projects.data ?? []).filter(
        (p) => canSchedule(p.stage) || p.id === f.project,
      ),
    [projects.data, f.project],
  );
  const allRooms = useMemo(() => (areas.data ?? []).flatMap((fl) => fl.rooms), [areas.data]);
  const tasks: DraftTask[] = visit
    ? (savedTasks.data ?? []).map((t) => ({ id: t.id, title: t.title, done: t.done }))
    : draftTasks;
  const techName =
    f.tech === FREE
      ? f.techName.trim() || null
      : ((techs.data ?? []).find((t) => t.id === f.tech)?.name ?? null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  // Crews linked to this job's labour are offered first, and a crew already booked that day is pointed out (never blocked).
  const suggestions = useSuggestedCrews(f.project || null);
  const suggested = useMemo(() => suggestedCrews(techs.data ?? [], suggestions.data ?? []), [techs.data, suggestions.data]);
  const when = useMemo(() => {
    const t = visitTimes({ date: f.date, start: f.start, end: f.end });
    return "error" in t ? null : { starts_at: t.startsAt.toISOString(), ends_at: t.endsAt?.toISOString() ?? null };
  }, [f.date, f.start, f.end]);
  const around = useVisitsAround(f.tech && f.tech !== FREE ? (when?.starts_at ?? null) : null);
  const clashes = when && f.tech && f.tech !== FREE ? clashesFor(around.data ?? [], f.tech, techs.data ?? [], when, visit?.id ?? null) : [];

  const dayCount = Math.max(1, Math.min(MAX_RUN_DAYS, Math.floor(Number(f.days) || 1)));
  const plan = useMemo(() => (!visit && f.date ? planRun(f.date, dayCount, cal) : []), [visit, f.date, dayCount, cal]);
  const offDay = f.date ? nonWorkdayReason(f.date, cal) : null;
  const dateMoved = !!visit && !!f.date && f.date !== dayOf(visit.starts_at);

  const save = async (runMove?: "one" | "following") => {
    setErr(null);
    if (!f.project) return setErr("Choose a job.");
    if (f.tech && f.tech !== FREE && !(techs.data ?? []).some((t) => t.id === f.tech))
      return setErr("The crew list is still loading, or that crew is no longer active. Pick the crew again.");
    const times = visitTimes({ date: f.date, start: f.start, end: f.end });
    if ("error" in times) return setErr(times.error);
    if (times.endsAt && times.endsAt.getTime() - times.startsAt.getTime() > MAX_WORK_ORDER_MS)
      return setErr(ONE_DAY_MESSAGE);
    if (f.reportTo === "other" && !f.reportOther.trim()) return setErr("Say where the crew reports, or choose Site or Shop.");
    if (f.reportTime && !reportTimeLabel(f.reportTime)) return setErr("Choose a time to report at, or leave it empty for the start time.");
    // Moving one day of a run: ask first whether the following days move with it.
    if (inRun && dateMoved && !runMove) {
      if (runVisits.isLoading) return setErr("Still loading the other days of this run. Try again in a moment.");
      return setMoveAsk(true);
    }
    setMoveAsk(false);
    const row = {
      project_id: f.project,
      scope: f.scope.trim() || null,
      starts_at: times.startsAt.toISOString(),
      ends_at: times.endsAt?.toISOString() ?? null,
      ...(f.tech === FREE
        ? { assigned_user_id: null as string | null, assigned_name: f.techName.trim() || null, technician_supplier_id: null as string | null }
        : assignmentFor(f.tech, techs.data ?? [])),
      crew: techName ?? visit?.crew ?? null,
      site_contact: f.contact.trim() || null,
      notes: f.notes.trim() || null,
      areas: areasFromSelection(f.rooms, allRooms),
    };
    if (lines.some((l) => !Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0)) return setErr("Each work item needs a quantity of zero or more.");
    const cleanLines = lines.map((l, i) => ({ ...l, quantity: num(l.quantity), description: l.description.trim(), sort_order: i })).filter((l) => l.description || l.quantity > 0);
    const report = {
      tentative: f.tentative,
      report_to: f.reportTo,
      report_to_other: f.reportTo === "other" ? f.reportOther.trim() : null,
      report_time: f.reportTime ? `${f.reportTime}:00` : null,
    };
    setBusy(true);
    try {
      if (visit) {
        const { project_id: _p, ...base } = row;
        // Only what changed among the newer fields is written.
        const was = formFor(visit, {});
        const reportChanged = f.reportTo !== was.reportTo || report.report_to_other !== (visit.report_to_other ?? null) || f.reportTime !== was.reportTime;
        const patch = { ...base, ...(f.tentative !== was.tentative ? { tentative: f.tentative } : {}), ...(reportChanged ? { report_to: report.report_to, report_to_other: report.report_to_other, report_time: report.report_time } : {}) };
        const u = await db.from("install_visits").update(patch as never).eq("id", visit.id);
        if (u.error) throw new Error(u.error.message);
        // "This and the following days": each later day keeps its own times and shifts by the same number of workdays.
        const followers: SchedVisit[] = [];
        if (runMove === "following") {
          for (const m of shiftRun(runVisits.data ?? [], visit.id, f.date, "following", cal)) {
            const other = (runVisits.data ?? []).find((x) => x.id === m.id);
            if (!other || other.id === visit.id) continue;
            const t = visitTimes({ date: m.day, start: timeOf(other.starts_at), end: other.ends_at ? timeOf(other.ends_at) : "" });
            if ("error" in t) continue;
            const r = await db.from("install_visits").update({ starts_at: t.startsAt.toISOString(), ends_at: t.endsAt?.toISOString() ?? null }).eq("id", other.id);
            if (r.error) throw new Error(`This day was moved, but ${shortDay(dayOf(other.starts_at))} was not: ${r.error.message}`);
            followers.push(other);
          }
        }
        // The lines are replaced as a set; a change to them re-pushes the work order like a change to the notes.
        const linesEdited = linesSeeded.current && linesChanged(savedLines, cleanLines);
        if (linesEdited) {
          // One transaction: a refused line leaves the saved ones in place.
          const r = await db.rpc("install_visit_replace_lines" as never, { _visit: visit.id, _lines: cleanLines.map(({ id: _id, visit_id: _v, ...l }) => l) } as never);
          if (r.error) throw new Error(r.error.message);
        }
        const sameTime = (a: string | null, b: string | null) => (a == null || b == null ? a == b : Date.parse(a) === Date.parse(b));
        const moved = !sameTime(patch.starts_at, visit.starts_at) || !sameTime(patch.ends_at, visit.ends_at);
        const retyped =
          (patch.site_contact ?? null) !== (visit.site_contact ?? null) ||
          (patch.notes ?? null) !== (visit.notes ?? null) ||
          (patch.crew ?? null) !== (visit.crew ?? null) ||
          reportChanged ||
          linesEdited;
        refresh();
        onClose();
        for (const other of followers) await ap.reschedule(other, true);
        if (followers.length) toast.success(`Moved this day and the ${followers.length === 1 ? "day" : `${followers.length} days`} after it.`);
        // Clearing Tentative sends the visit as usual.
        if (was.tentative && !f.tentative && !visit.arriveping_job_id && visit.status === "scheduled") {
          if (moved) await ap.reschedule(visit, true);
          const sent = await ap.send(visit.id, true);
          if (sent === "sent") toast.success("Work order confirmed and sent to ArrivePing.");
          else if (sent !== "failed") toast.success("Work order saved.");
          return;
        }
        // The schedule, contact and notes travel to ArrivePing; the saved visit stands whatever ArrivePing says.
        if (moved || (retyped && visit.arriveping_job_id)) {
          await ap.reschedule(visit, followers.length > 0);
          return;
        }
        if (followers.length) return;
        toast.success(
          f.tentative
            ? "Work order saved as tentative. Not sent to ArrivePing."
            : row.assigned_user_id || row.assigned_name
              ? assignmentState(
                  { ...row, arriveping_assigned_to: visit.arriveping_assigned_to },
                  techName,
                ) === "confirmed"
                ? "Work order saved."
                : "Work order saved. Crew pending in ArrivePing."
              : "Work order saved.",
        );
        return;
      }
      // One visit per day: a run is that many visits on consecutive workdays, linked by run_id.
      const runId = plan.length > 1 ? crypto.randomUUID() : null;
      const extra = { ...(f.tentative ? { tentative: true } : {}), ...(f.reportTo !== "site" || report.report_time ? { report_to: report.report_to, report_to_other: report.report_to_other, report_time: report.report_time } : {}) };
      const rows: (typeof row & Record<string, unknown>)[] = [];
      for (const d of plan) {
        const t = visitTimes({ date: d.day, start: f.start, end: f.end });
        if ("error" in t) throw new Error(t.error);
        rows.push({ ...row, ...extra, starts_at: t.startsAt.toISOString(), ends_at: t.endsAt?.toISOString() ?? null, ...(runId ? { run_id: runId, run_day: d.run_day, run_total: d.run_total } : {}) });
      }
      const { data, error } = await db.from("install_visits").insert(rows as never).select("id,starts_at");
      if (error) throw new Error(error.message);
      const made = ((data ?? []) as { id: string; starts_at: string }[]).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      const id = made[0]!.id;
      onClose(); // saved: never schedule it twice
      const ev = await db.from("install_visit_events").insert(
        made.map((m, i) => ({
          visit_id: m.id,
          project_id: f.project,
          status: "scheduled",
          note: `${visitNote("scheduled", techName)} for ${visitRange(rows[i]!.starts_at, rows[i]!.ends_at)}${made.length > 1 ? ` (Day ${i + 1} of ${made.length})` : ""}${f.tentative ? " — tentative" : ""}`,
        })),
      );
      if (ev.error) console.error(`install_visit_events: ${ev.error.message}`);
      // The lines go on the first day of a run: one work order's worth of work, however many days it takes.
      if (cleanLines.length) {
        const l = await db.from("install_visit_lines" as never).insert(cleanLines.map((x) => ({ ...x, visit_id: id, project_id: f.project })) as never);
        if (l.error) toast.error(`Work order saved, work items not saved: ${l.error.message}`);
      }
      if (draftTasks.length) {
        const t = await db.from("visit_tasks").insert(
          draftTasks.map((d, i) => ({
            visit_id: id,
            project_id: f.project,
            title: d.title,
            sort: i,
          })),
        );
        if (t.error) toast.error(`Work order saved, tasks not saved: ${t.error.message}`);
      }
      const what = made.length > 1 ? `${made.length} days scheduled` : "Work order created";
      if (f.tentative) {
        toast.success(`${what} as tentative. Not sent to ArrivePing until Tentative is cleared.`);
        return;
      }
      let sentCount = 0;
      let failed = false;
      for (const m of made) {
        const sent = await ap.send(m.id, true);
        if (sent === "sent") sentCount++;
        if (sent === "failed") failed = true;
      }
      const pending =
        row.assigned_user_id || row.assigned_name ? " Crew pending in ArrivePing." : "";
      if (sentCount === made.length) toast.success(`${what} and sent to ArrivePing.${pending}`);
      else if (!failed) toast.success(`${what}.${pending}`);
      else if (sentCount > 0) toast.info(`${what}. ${sentCount} of ${made.length} sent to ArrivePing.`);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const addTask = async () => {
    const title = newTask.trim();
    if (!title) return;
    setNewTask("");
    if (!visit) return setDraftTasks((t) => [...t, { title, done: false }]);
    const r = await db
      .from("visit_tasks")
      .insert({ visit_id: visit.id, project_id: visit.project_id, title, sort: tasks.length });
    if (r.error) toast.error(r.error.message);
    refresh();
  };
  const toggleTask = async (t: DraftTask, i: number) => {
    if (!visit || !t.id)
      return setDraftTasks((d) => d.map((x, j) => (j === i ? { ...x, done: !x.done } : x)));
    const r = await db
      .from("visit_tasks")
      .update({
        done: !t.done,
        done_at: t.done ? null : new Date().toISOString(),
        done_by: t.done ? null : ((await db.auth.getUser()).data.user?.id ?? null),
      })
      .eq("id", t.id);
    if (r.error) toast.error(r.error.message);
    refresh();
  };
  const removeTask = async (t: DraftTask, i: number) => {
    if (!visit || !t.id) return setDraftTasks((d) => d.filter((_, j) => j !== i));
    const r = await db.from("visit_tasks").delete().eq("id", t.id);
    if (r.error) toast.error(r.error.message);
    refresh();
  };

  const label = "block space-y-1 text-xs font-medium";
  const field = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
  const ro = !canEdit || visit?.status === "cancelled" || visit?.status === "completed";
  const state = visit ? assignmentState(visit, techName) : "none";
  const pill = visit ? arrivepingPill(visit) : null;

  return (
    <div className="mt-4 space-y-4 text-sm">
      {visit && (inRun || visit.tentative) && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {inRun && <span className="font-semibold">{runLabel(visit)}</span>}
          {inRun && <span className="text-muted-foreground">One of a run of days. Each day is its own visit.</span>}
          {visit.tentative && <span className="rounded border border-dashed border-foreground/50 px-1.5 text-xs font-semibold">Tentative</span>}
        </p>
      )}
      <fieldset disabled={ro || busy} className="space-y-3">
        <label className={label}>
          Job
          <select
            className={field}
            value={f.project}
            disabled={lockProject || !!visit}
            onChange={(e) => set("project", e.target.value)}
          >
            <option value="">Choose a job</option>
            {jobs.map((p) => (
              <option key={p.id} value={p.id}>
                {[p.project_number, p.name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Scope
          <Input
            value={f.scope}
            onChange={(e) => set("scope", e.target.value)}
            placeholder="e.g. Corridor LVT, Floor 3"
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className={label}>
            Date
            <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          <label className={label}>
            Start
            <Input type="time" value={f.start} onChange={(e) => set("start", e.target.value)} />
          </label>
          <label className={label}>
            End
            <Input type="time" value={f.end} onChange={(e) => set("end", e.target.value)} />
          </label>
        </div>
        {!visit && (
          <label className={`${label} max-w-[11rem]`}>
            Number of days
            <Input type="number" inputMode="numeric" min={1} max={MAX_RUN_DAYS} value={f.days} onChange={(e) => set("days", e.target.value)} />
          </label>
        )}
        {plan.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            {plan.length} work orders, one per workday: {plan.map((d) => shortDay(d.day)).join(", ")}. Each can be changed on its own afterwards.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            One work order per day — ArrivePing takes up to 24 hours per work order.
          </p>
        )}
        {offDay && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            Heads-up: {shortDay(f.date)} is not a workday ({offDay}). You can still schedule it.
          </p>
        )}
        <div className={label}>
          Crew
          <TechnicianPicker value={f.tech === FREE ? "" : f.tech} onChange={(id) => setF((x) => ({ ...x, tech: id, techName: "" }))} techs={techs.data ?? []} disabled={!canEdit || techs.isLoading} canAdd={canEdit} suggested={suggested} />
          {clashes.length > 0 && (
            <p role="status" className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-normal text-amber-900">
              Already booked that day:{" "}
              {clashes.map((c) => `${[c.project?.project_number, c.project?.name].filter(Boolean).join(" ") || "another job"}, ${scheduleRange(c.starts_at, c.ends_at)}`).join("; ")}
              <span className="block">This is only a heads-up; you can still schedule the visit.</span>
            </p>
          )}
          {f.tech === FREE && f.techName && (
            <p className="mt-1 text-xs font-normal text-amber-700">
              Typed earlier: {f.techName}. Pick them above, or search the name to add them as a subcontractor.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Report to
            <select className={field} value={f.reportTo} onChange={(e) => set("reportTo", e.target.value as ReportTo)}>
              <option value="site">Site</option>
              <option value="shop">Shop</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className={label}>
            Report at
            <Input type="time" value={f.reportTime || f.start} onChange={(e) => set("reportTime", e.target.value === f.start ? "" : e.target.value)} />
          </label>
          {f.reportTo === "other" && (
            <label className={`${label} col-span-2`}>
              Where
              <Input value={f.reportOther} maxLength={120} onChange={(e) => set("reportOther", e.target.value)} placeholder="e.g. Supplier yard, 55 King St" />
            </label>
          )}
        </div>
        <label className={label}>
          Site contact
          <Input
            value={f.contact}
            onChange={(e) => set("contact", e.target.value)}
            placeholder="Name and phone"
          />
        </label>

        <div className="space-y-2">
          <p className="text-xs font-medium">
            Areas covered{" "}
            <span className="font-normal text-muted-foreground">({f.rooms.size} selected)</span>
          </p>
          {!f.project ? (
            <p className="text-xs text-muted-foreground">Choose a job first.</p>
          ) : areas.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading floors…</p>
          ) : (areas.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">This job has no floors or rooms set up.</p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border p-2">
              {(areas.data ?? []).map((fl) => {
                const all = fl.rooms.length > 0 && fl.rooms.every((r) => f.rooms.has(r.id));
                return (
                  <div key={fl.id}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{fl.label}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={!fl.rooms.length}
                        onClick={() => set("rooms", toggleFloor(f.rooms, fl.id, fl.rooms))}
                      >
                        {all ? "Clear floor" : "Whole floor"}
                      </Button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {fl.rooms.map((r) => (
                        <label
                          key={r.id}
                          className={`cursor-pointer rounded border px-2 py-1 text-xs ${f.rooms.has(r.id) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={f.rooms.has(r.id)}
                            onChange={() => {
                              const n = new Set(f.rooms);
                              if (n.has(r.id)) n.delete(r.id);
                              else n.add(r.id);
                              set("rooms", n);
                            }}
                          />
                          {r.name}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <label className={label}>
          Notes for the crew
          <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={f.tentative} disabled={!!visit?.arriveping_job_id} onChange={(e) => set("tentative", e.target.checked)} />
          <span>
            <span className="font-medium">Tentative</span>
            <span className="block text-xs text-muted-foreground">
              {visit?.arriveping_job_id
                ? "Already in ArrivePing, so it can't be made tentative."
                : "Not sent to ArrivePing and the crew is not told until this is cleared."}
            </span>
          </span>
        </label>
      </fieldset>

      <WorkItems projectId={f.project || null} visitId={visit?.id ?? null} lines={lines} onChange={setLines} canEdit={canEdit && !ro} />

      <div className="space-y-2">
        <p className="text-xs font-medium">
          Tasks{" "}
          <span className="font-normal text-muted-foreground">
            ({tasks.filter((t) => t.done).length}/{tasks.length} done)
          </span>
        </p>
        <ul className="space-y-1">
          {tasks.map((t, i) => (
            <li key={t.id ?? i} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Done: ${t.title}`}
                checked={t.done}
                disabled={!canEdit}
                onChange={() => void toggleTask(t, i)}
              />
              <span className={`flex-1 ${t.done ? "text-muted-foreground line-through" : ""}`}>
                {t.title}
              </span>
              {canEdit && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label={`Remove ${t.title}`}
                  onClick={() => void removeTask(t, i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addTask();
            }}
          >
            <Input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Add a task"
            />
            <Button type="submit" variant="outline" size="sm" className="h-10">
              Add
            </Button>
          </form>
        )}
      </div>

      {visit && (
        <Link to="/daily-log" search={{ job: visit.project_id }} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
          Add today's log for this job →
        </Link>
      )}

      {visit && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs font-medium">ArrivePing</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={VISIT_LABEL[visit.status]} jobId={visit.arriveping_job_id} />
            {pill ? <ArrivePingPill label={pill} /> : <ArrivePingPill label={visit.tentative ? "Tentative — not sent" : "Not sent"} />}
            {state === "pending" && (
              <ArrivePingPill label={`Pending in ArrivePing: ${techName ?? "crew"}`} />
            )}
            {visit.arriveping_job_id && <OpenInArrivePing jobId={visit.arriveping_job_id} />}
          </div>
          <p className="text-xs text-muted-foreground">
            Assigned in ArrivePing: {visit.arriveping_assigned_to ?? "nobody yet"}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">Crew confirmation</span>
            <ConfirmationPill v={visit} />
            {confirmationOf(visit).state === "declined" && visit.decline_reason && <span className="text-muted-foreground">“{visit.decline_reason}”</span>}
          </p>
          {sentTo.data?.sent_at && (
            <p className="text-xs text-muted-foreground">
              Assignment emailed to {sentTo.data.email} on {scheduleRange(sentTo.data.sent_at, null)} by {sentTo.data.sent_by_name || "staff"}
              {sentTo.data.cc.length ? `, copied to ${sentTo.data.cc.join(", ")}` : ""}.
            </p>
          )}
          {canEdit && visit.status !== "cancelled" && visit.status !== "completed" && (
            <div className="flex flex-wrap gap-2">
              {!visit.arriveping_job_id && visit.status === "scheduled" && !visit.tentative && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await ap.send(visit.id);
                    setBusy(false);
                  }}
                >
                  Send to ArrivePing
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Cancel this visit?")) return;
                  setBusy(true);
                  if (await ap.cancel(visit)) onClose();
                  setBusy(false);
                }}
              >
                {visit.arriveping_job_id ? "Cancel in ArrivePing" : inRun ? "Remove this day" : "Cancel visit"}
              </Button>
            </div>
          )}
          {inRun && canEdit && visit.status === "scheduled" && <p className="text-xs text-muted-foreground">Removing a day renumbers the days that are left.</p>}
        </div>
      )}

      {err && (
        <p role="alert" className="rounded bg-destructive/10 p-2 text-destructive">
          {err}
        </p>
      )}
      {moveAsk && visit && (
        <div role="alertdialog" aria-label="Move a day of a run" className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="font-medium">
            This is {runLabel(visit)}. You are moving it from {shortDay(dayOf(visit.starts_at))} to {shortDay(f.date)}.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void save("one")}>
              Move just this day
            </Button>
            <Button className="min-h-11" disabled={busy} onClick={() => void save("following")}>
              Move this and the following days
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Following days shift by the same number of workdays, skipping non-workdays.</p>
        </div>
      )}
      <div className="flex gap-2">
        {!ro && (
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : visit ? "Save" : "Create work order"}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
