import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TechnicianPicker } from "@/components/scheduling/TechnicianPicker";
import { ArrivePingPill, OpenInArrivePing, StatusPill } from "@/components/visits/visit-bits";
import { cancelVisitPush, pushVisit, rescheduleVisitPush } from "@/lib/arriveping/arriveping.functions";
import { MAX_WORK_ORDER_MS } from "@/lib/arriveping/core";
import { useAuth } from "@/lib/auth";
import { db, errText } from "@/lib/platform/db";
import { usePipelineProjects } from "@/lib/projects/data";
import {
  useJobAreas,
  useRefreshSchedule,
  useTechnicians,
  useVisit,
  useVisitTasks,
  type SchedVisit,
} from "@/lib/scheduling/data";
import {
  areasFromSelection,
  assignmentFor,
  assignmentState,
  SUP,
  selectionFromAreas,
  toggleFloor,
} from "@/lib/scheduling/logic";
import {
  applyVisitEvent,
  arrivepingPill,
  SCHEDULE_TZ,
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
};
type DraftTask = { id?: string; title: string; done: boolean };

const wall = (iso: string, opt: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-CA", { ...opt, timeZone: SCHEDULE_TZ }).format(new Date(iso));
const dayOf = (iso: string) => wall(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
const timeOf = (iso: string) => wall(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const FREE = "__free__";

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
  };
}

/** Sends to ArrivePing and cancels there, reporting rather than throwing: the BMD visit always stands on its own. */
export function useVisitArrivePing() {
  const pushFn = useServerFn(pushVisit);
  const cancelFn = useServerFn(cancelVisitPush);
  const rescheduleFn = useServerFn(rescheduleVisitPush);
  const refresh = useRefreshSchedule();
  /** After an existing visit is saved: logs the move and, for a visit in ArrivePing, puts the new schedule on its work order. */
  const reschedule = async (v: { id: string; starts_at: string; ends_at: string | null; arriveping_job_id: string | null }) => {
    try {
      const r = await rescheduleFn({ data: { visitId: v.id, previousStartsAt: v.starts_at, previousEndsAt: v.ends_at } });
      if (r.push?.outcome === "sent") toast.success("Visit saved. ArrivePing updated.");
      else if (r.push?.outcome === "failed")
        toast.warning(`Visit saved. ArrivePing wasn't updated — ${SEE_SETTINGS}`, { description: r.push.error });
      else toast.success("Visit saved.");
    } catch (e) {
      if (v.arriveping_job_id) toast.warning(`Visit saved. ArrivePing wasn't updated — ${SEE_SETTINGS}`, { description: errText(e) });
      else toast.success("Visit saved.");
    } finally {
      refresh();
    }
  };
  const send = async (visitId: string, quiet = false) => {
    try {
      const r = await pushFn({ data: { visitId } });
      if (r.outcome === "failed")
        toast.warning(`Couldn't send to ArrivePing — ${SEE_SETTINGS}`, { description: r.error });
      else if (!quiet)
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
      toast.error("That visit is already past that point.");
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
        told ? "Visit cancelled. ArrivePing asked to cancel too." : "Marked cancelled.",
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
          <SheetTitle>{editId ? "Install visit" : "Schedule a visit"}</SheetTitle>
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
  const areas = useJobAreas(f.project || null);
  const savedTasks = useVisitTasks(visit ? [visit.id] : []);
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [newTask, setNewTask] = useState("");
  useEffect(() => {
    if (!visit) setF((x) => ({ ...x, rooms: new Set() }));
  }, [f.project, visit]);

  const jobs = useMemo(
    () =>
      (projects.data ?? []).filter(
        (p) => p.stage === "won" || p.stage === "in_progress" || p.id === f.project,
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

  const save = async () => {
    setErr(null);
    if (!f.project) return setErr("Choose a job.");
    if (f.tech && f.tech !== FREE && !(techs.data ?? []).some((t) => t.id === f.tech))
      return setErr("The technician list is still loading, or that technician is no longer active. Pick the technician again.");
    const times = visitTimes({ date: f.date, start: f.start, end: f.end });
    if ("error" in times) return setErr(times.error);
    if (times.endsAt && times.endsAt.getTime() - times.startsAt.getTime() > MAX_WORK_ORDER_MS)
      return setErr(ONE_DAY_MESSAGE);
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
    setBusy(true);
    try {
      if (visit) {
        const { project_id: _p, ...patch } = row;
        const u = await db.from("install_visits").update(patch).eq("id", visit.id);
        if (u.error) throw new Error(u.error.message);
        const sameTime = (a: string | null, b: string | null) => (a == null || b == null ? a == b : Date.parse(a) === Date.parse(b));
        const moved = !sameTime(patch.starts_at, visit.starts_at) || !sameTime(patch.ends_at, visit.ends_at);
        const retyped =
          (patch.site_contact ?? null) !== (visit.site_contact ?? null) ||
          (patch.notes ?? null) !== (visit.notes ?? null) ||
          (patch.crew ?? null) !== (visit.crew ?? null);
        refresh();
        onClose();
        // The schedule, contact and notes travel to ArrivePing; the saved visit stands whatever ArrivePing says.
        if (moved || (retyped && visit.arriveping_job_id)) {
          await ap.reschedule(visit);
          return;
        }
        toast.success(
          row.assigned_user_id || row.assigned_name
            ? assignmentState(
                { ...row, arriveping_assigned_to: visit.arriveping_assigned_to },
                techName,
              ) === "confirmed"
              ? "Visit saved."
              : "Visit saved. Technician pending in ArrivePing."
            : "Visit saved.",
        );
        return;
      }
      const { data, error } = await db.from("install_visits").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      const id = (data as { id: string }).id;
      onClose(); // saved: never schedule it twice
      const ev = await db.from("install_visit_events").insert({
        visit_id: id,
        project_id: f.project,
        status: "scheduled",
        note: `${visitNote("scheduled", techName)} for ${visitRange(row.starts_at, row.ends_at)}`,
      });
      if (ev.error) console.error(`install_visit_events: ${ev.error.message}`);
      if (draftTasks.length) {
        const t = await db.from("visit_tasks").insert(
          draftTasks.map((d, i) => ({
            visit_id: id,
            project_id: f.project,
            title: d.title,
            sort: i,
          })),
        );
        if (t.error) toast.error(`Visit saved, tasks not saved: ${t.error.message}`);
      }
      const sent = await ap.send(id, true);
      const pending =
        row.assigned_user_id || row.assigned_name ? " Technician pending in ArrivePing." : "";
      if (sent === "sent") toast.success(`Visit scheduled and sent to ArrivePing.${pending}`);
      else if (sent !== "failed") toast.success(`Visit scheduled.${pending}`);
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
        <p className="text-xs text-muted-foreground">
          One visit per day — ArrivePing takes up to 24 hours per work order.
        </p>
        <div className={label}>
          Technician
          <TechnicianPicker value={f.tech === FREE ? "" : f.tech} onChange={(id) => setF((x) => ({ ...x, tech: id, techName: "" }))} techs={techs.data ?? []} disabled={!canEdit || techs.isLoading} canAdd={canEdit} />
          {f.tech === FREE && f.techName && (
            <p className="mt-1 text-xs font-normal text-amber-700">
              Typed earlier: {f.techName}. Pick them above, or search the name to add them as a subcontractor.
            </p>
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
      </fieldset>

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
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs font-medium">ArrivePing</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={VISIT_LABEL[visit.status]} />
            {pill ? <ArrivePingPill label={pill} /> : <ArrivePingPill label="Not sent" />}
            {state === "pending" && (
              <ArrivePingPill label={`Pending in ArrivePing: ${techName ?? "technician"}`} />
            )}
            {visit.arriveping_job_id && <OpenInArrivePing jobId={visit.arriveping_job_id} />}
          </div>
          <p className="text-xs text-muted-foreground">
            Assigned in ArrivePing: {visit.arriveping_assigned_to ?? "nobody yet"}
          </p>
          {canEdit && visit.status !== "cancelled" && visit.status !== "completed" && (
            <div className="flex flex-wrap gap-2">
              {!visit.arriveping_job_id && visit.status === "scheduled" && (
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
                {visit.arriveping_job_id ? "Cancel in ArrivePing" : "Cancel visit"}
              </Button>
            </div>
          )}
        </div>
      )}

      {err && (
        <p role="alert" className="rounded bg-destructive/10 p-2 text-destructive">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        {!ro && (
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : visit ? "Save" : "Schedule"}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
