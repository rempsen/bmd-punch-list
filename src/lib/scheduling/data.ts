import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { Visit } from "@/lib/visits/logic";
import { mergeTechnicians, monthOf, shiftWeek, siteDay, SUP, type Area, type Subcontractor, type Technician } from "./logic";
import { cleanEmail, type Confirmation, type ReportTo } from "./assignments";
import { DEFAULT_CALENDAR, readCalendar, type WorkCalendar } from "./workdays";

export type SchedVisit = Visit & {
  project_id: string;
  assigned_user_id: string | null;
  assigned_name: string | null;
  /** The catalogue vendor (Labour or Both) this visit is assigned to, when it is a subcontractor. */
  technician_supplier_id: string | null;
  areas: Area[];
  scope: string | null;
  /** Where the visit began: 'bmd' (scheduled here) or 'arriveping' (scheduled there and brought in). */
  source: "bmd" | "arriveping";
  project: { id: string; name: string; project_number: string | null } | null;
  tasks: { id: string; done: boolean }[];
  /** A run of days: the same `run_id` on each day's visit, numbered `run_day` of `run_total`. All null for a single visit. */
  run_id?: string | null;
  run_day?: number | null;
  run_total?: number | null;
  /** Not yet firm: shown dashed, never sent to ArrivePing or emailed to the crew. */
  tentative?: boolean | null;
  report_to?: ReportTo | null;
  report_to_other?: string | null;
  /** "07:00:00"; null means the visit's start time. */
  report_time?: string | null;
  confirmation?: Confirmation | null;
  confirmation_at?: string | null;
  decline_reason?: string | null;
  assignment_sent_at?: string | null;
  assignment_link_id?: string | null;
};
/** Adds a crew to Catalogue → Suppliers & subcontractors as Labour (or reuses the vendor of that name) and returns its technician id. */
export async function addSubcontractor(name: string): Promise<string> {
  const { data, error } = await db.rpc("add_subcontractor", { _name: name });
  if (error) throw new Error(error.message);
  return `${SUP}${data as string}`;
}
export type VisitTask = {
  id: string;
  visit_id: string;
  project_id: string;
  title: string;
  details: string | null;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  sort: number;
};

// "*" so the run, tentative, report-to and confirmation columns are read once migration 0083 is applied, and nothing breaks before.
const COLS = "*,project:projects(id,name,project_number),tasks:visit_tasks(id,done)";

/** BMD field staff, the catalogue's active Labour and Both vendors, and any other crew name ArrivePing has reported on a visit. */
export function useTechnicians() {
  return useQuery({
    queryKey: ["technicians"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Technician[]> => {
      const [staff, subs, ap] = await Promise.all([
        db.rpc("bmd_technicians"),
        db.rpc("bmd_subcontractors"),
        db
          .from("install_visits")
          .select("arriveping_assigned_to")
          .not("arriveping_assigned_to", "is", null)
          .order("starts_at", { ascending: false })
          .limit(500),
      ]);
      if (staff.error) throw staff.error;
      if (subs.error) throw subs.error;
      if (ap.error) throw ap.error;
      return mergeTechnicians(
        (staff.data ?? []) as never,
        ((ap.data ?? []) as { arriveping_assigned_to: string | null }[]).map(
          (r) => r.arriveping_assigned_to,
        ),
        (subs.data ?? []) as Subcontractor[],
      );
    },
  });
}

/**
 * Visits for the Scheduling screens. A week (starting Monday) reads a day either side so visits spanning midnight in Winnipeg are kept;
 * with a job and `upcoming`, every visit for that job from the week's Monday on.
 */
export function useScheduledVisits(
  monday: string,
  opts: { job?: string | undefined; upcoming?: boolean } = {},
) {
  return useQuery({
    queryKey: ["sched-visits", monday, opts.job ?? null, !!opts.upcoming],
    queryFn: async () => {
      let q = db
        .from("install_visits")
        .select(COLS)
        .gte("starts_at", `${shiftWeek(monday, -1)}T00:00:00Z`);
      if (!(opts.upcoming && opts.job)) q = q.lt("starts_at", `${shiftWeek(monday, 1)}T12:00:00Z`);
      if (opts.job) q = q.eq("project_id", opts.job);
      const { data, error } = await q.order("starts_at");
      if (error) throw error;
      return (data ?? []) as unknown as SchedVisit[];
    },
  });
}

/** Visits touching any site day from `from` to `to` (YYYY-MM-DD, inclusive), for the calendar. Reads a day either side for Winnipeg midnight. */
export function useVisitsBetween(from: string, to: string, opts: { job?: string | undefined; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["sched-visits-range", from, to, opts.job ?? null],
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      const before = new Date(`${from}T00:00:00Z`);
      before.setUTCDate(before.getUTCDate() - 1);
      const after = new Date(`${to}T00:00:00Z`);
      after.setUTCDate(after.getUTCDate() + 2);
      // A visit started up to two months earlier can still be running (visitDays caps at 62 days).
      const earliest = new Date(before);
      earliest.setUTCDate(earliest.getUTCDate() - 62);
      let q = db
        .from("install_visits")
        .select(COLS)
        .gte("starts_at", earliest.toISOString())
        .lt("starts_at", after.toISOString())
        .or(`ends_at.is.null,ends_at.gte.${before.toISOString()}`);
      if (opts.job) q = q.eq("project_id", opts.job);
      const { data, error } = await q.order("starts_at");
      if (error) throw error;
      return (data ?? []) as unknown as SchedVisit[];
    },
  });
}

export function useVisit(id: string | null) {
  return useQuery({
    queryKey: ["sched-visit", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db.from("install_visits").select(COLS).eq("id", id!).single();
      if (error) throw error;
      return data as unknown as SchedVisit;
    },
  });
}

export function useVisitTasks(visitIds: string[]) {
  const key = [...visitIds].sort().join(",");
  return useQuery({
    queryKey: ["visit-tasks", key],
    enabled: visitIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("visit_tasks")
        .select("id,visit_id,project_id,title,details,done,done_at,done_by,sort")
        .in("visit_id", visitIds)
        .order("sort")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as VisitTask[];
    },
  });
}

export type JobFloor = {
  id: string;
  label: string;
  sort_order: number;
  rooms: { id: string; floor_id: string; name: string; sort_order: number }[];
};

/** A job's floors with their rooms and common areas, in building order. */
export function useJobAreas(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["job-areas", projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("floors")
        .select("id,label,sort_order,rooms:locations(id,floor_id,name,sort_order)")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as JobFloor[]).map((f) => ({
        ...f,
        rooms: [...f.rooms].sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.name.localeCompare(b.name, undefined, { numeric: true }),
        ),
      }));
    },
  });
}

/** Everything a scheduling change can affect, across the Scheduling screens and the job's own visit list. */
export function useRefreshSchedule() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      "sched-visits",
      "sched-visits-range",
      "sched-visit",
      "visit-tasks",
      "visit-lines",
      "visits",
      "visit-events",
      "technicians",
      "run-visits",
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Every visit starting in the current month (a day either side, for visits near midnight in Winnipeg), for the Technicians page counts. */
export function useMonthVisits() {
  const { from, to } = monthOf(siteDay(new Date()));
  return useQuery({
    queryKey: ["sched-visits", "month", from],
    queryFn: async () => {
      const { data, error } = await db
        .from("install_visits")
        .select("id,starts_at,ends_at,status,assigned_user_id,assigned_name,technician_supplier_id,arriveping_assigned_to")
        .gte("starts_at", `${from}T00:00:00Z`)
        .lt("starts_at", `${to}T12:00:00Z`);
      if (error) throw error;
      return (data ?? []) as Pick<SchedVisit, "id" | "starts_at" | "ends_at" | "status" | "assigned_user_id" | "assigned_name" | "technician_supplier_id" | "arriveping_assigned_to">[];
    },
  });
}

/** One technician's visits, newest first: a subcontractor ("sup:<vendor id>") by its vendor link, staff by their login. */
export function useTechnicianVisits(techId: string | null) {
  return useQuery({
    queryKey: ["sched-visits", "of", techId],
    enabled: !!techId,
    queryFn: async () => {
      const q = db.from("install_visits").select(COLS);
      const { data, error } = await (techId!.startsWith(SUP) ? q.eq("technician_supplier_id", techId!.slice(SUP.length)) : q.eq("assigned_user_id", techId!))
        .order("starts_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SchedVisit[];
    },
  });
}

/** The crews linked to the labour on a job's estimate. Vendor ids and labour names only. */
export function useSuggestedCrews(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["suggested-crews", projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("project_suggested_crews", { _project: projectId! });
      if (error) throw error;
      return (data ?? []) as { supplier_id: string; work: string }[];
    },
  });
}

/** Visits starting within a day either side of a time, for warning when a crew is already booked. */
export function useVisitsAround(startsAt: string | null) {
  const day = startsAt ? siteDay(startsAt) : null;
  return useQuery({
    queryKey: ["sched-visits", "around", day],
    enabled: !!day,
    queryFn: async () => {
      const at = Date.parse(startsAt!);
      const { data, error } = await db
        .from("install_visits")
        .select(COLS)
        .gte("starts_at", new Date(at - 36 * 3600_000).toISOString())
        .lt("starts_at", new Date(at + 36 * 3600_000).toISOString());
      if (error) throw error;
      return (data ?? []) as unknown as SchedVisit[];
    },
  });
}

/** Which crews (vendor ids) are linked to each labour item, and the reverse, for the catalogue. */
export function useLabourCrews(enabled = true) {
  return useQuery({
    queryKey: ["catalogue", "labour-crews"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("labour_crews").select("labour_rate_id,supplier_id");
      if (error) throw error;
      return (data ?? []) as { labour_rate_id: string; supplier_id: string }[];
    },
  });
}

/** Saves the crews ticked on a labour item: adds the new links and removes the unticked ones. */
export async function saveLabourCrews(labourRateId: string, changes: { add: string[]; remove: string[] }) {
  if (changes.remove.length) {
    const { error } = await db.from("labour_crews").delete().eq("labour_rate_id", labourRateId).in("supplier_id", changes.remove);
    if (error) throw new Error(error.message);
  }
  if (changes.add.length) {
    const { error } = await db.from("labour_crews").insert(changes.add.map((supplier_id) => ({ labour_rate_id: labourRateId, supplier_id })));
    if (error) throw new Error(error.message);
  }
}

// ── Company settings → Scheduling ────────────────────────────────────────────────────────────────────────────
export type ScheduleSettings = { calendar: WorkCalendar; assignmentCc: string[] };
const NO_SETTINGS: ScheduleSettings = { calendar: DEFAULT_CALENDAR, assignmentCc: [] };
// schedule_settings is newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settingsTable = () => (db as unknown as { from: (t: string) => any }).from("schedule_settings");

/** The company's workdays, holidays and copy-to list. Until they can be read, Monday to Friday with no holidays. */
export function useScheduleSettings() {
  return useQuery({
    queryKey: ["schedule-settings"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ScheduleSettings> => {
      const { data, error } = await settingsTable().select("workdays,holidays,assignment_cc").eq("id", 1).maybeSingle();
      if (error || !data) return NO_SETTINGS;
      const cc = Array.isArray(data.assignment_cc) ? (data.assignment_cc as unknown[]).map((e) => cleanEmail(typeof e === "string" ? e : null)).filter((e): e is string => !!e) : [];
      return { calendar: readCalendar(data), assignmentCc: cc };
    },
  });
}
/** The work calendar for shading and run arithmetic; the default while loading. */
export function useWorkCalendar(): WorkCalendar {
  return useScheduleSettings().data?.calendar ?? DEFAULT_CALENDAR;
}

export async function saveScheduleSettings(s: ScheduleSettings) {
  const { data, error } = await settingsTable()
    .update({ workdays: s.calendar.workdays, holidays: s.calendar.holidays, assignment_cc: s.assignmentCc })
    .eq("id", 1)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("You don't have permission to change these settings.");
}

/** Every visit of a run, in date order. */
export function useRunVisits(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["run-visits", runId],
    enabled: !!runId,
    queryFn: async () => {
      const { data, error } = await db.from("install_visits").select(COLS).eq("run_id" as never, runId!).order("starts_at");
      if (error) throw error;
      return (data ?? []) as unknown as SchedVisit[];
    },
  });
}

export type AssignmentLink = { id: string; email: string; cc: string[]; sent_at: string | null; sent_by_name: string; response: string | null; responded_at: string | null };
/** Where a visit's assignment email went and when. Only the office can read this. */
export function useAssignmentLink(id: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["sched-visit", "assignment-link", id],
    enabled: !!id && enabled,
    queryFn: async (): Promise<AssignmentLink | null> => {
      // crew_assignment_links is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as unknown as { from: (t: string) => any }).from("crew_assignment_links").select("id,email,cc,sent_at,sent_by_name,response,responded_at").eq("id", id!).maybeSingle();
      if (error) return null;
      return (data ?? null) as AssignmentLink | null;
    },
  });
}
