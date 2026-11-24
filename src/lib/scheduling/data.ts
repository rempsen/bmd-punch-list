import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { Visit } from "@/lib/visits/logic";
import { mergeTechnicians, monthOf, shiftWeek, siteDay, SUP, type Area, type Subcontractor, type Technician } from "./logic";

export type SchedVisit = Visit & {
  project_id: string;
  assigned_user_id: string | null;
  assigned_name: string | null;
  /** The catalogue vendor (Labour or Both) this visit is assigned to, when it is a subcontractor. */
  technician_supplier_id: string | null;
  areas: Area[];
  scope: string | null;
  project: { id: string; name: string; project_number: string | null } | null;
  tasks: { id: string; done: boolean }[];
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

const COLS =
  "id,project_id,starts_at,ends_at,crew,notes,site_contact,arriveping_job_id,arriveping_status,arriveping_assigned_to,arriveping_last_event_at,status,assigned_user_id,assigned_name,technician_supplier_id,areas,scope,project:projects(id,name,project_number),tasks:visit_tasks(id,done)";

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
      "sched-visit",
      "visit-tasks",
      "visits",
      "visit-events",
      "technicians",
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
