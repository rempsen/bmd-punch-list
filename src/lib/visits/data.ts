import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { Visit } from "./logic";
import type { VisitLine, WorkOrderItem } from "./lines";

/** One query for a project's visits, shared by the Overview panel and the Site tab so both stay in step. */
export function useProjectVisits(projectId: string) {
  return useQuery({
    queryKey: ["visits", projectId],
    queryFn: async () => {
      const { data, error } = await db
        .from("install_visits")
        // "*" so the run, tentative, report-to and confirmation columns are read once they exist, and nothing breaks before.
        .select("*")
        .eq("project_id", projectId)
        .order("starts_at");
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
  });
}

export type VisitPhoto = {
  id: string;
  visit_id: string;
  storage_path: string;
  caption: string | null;
  taken_at: string | null;
  taken_by: string | null;
};

/** The photos copied from ArrivePing for a project's visits, oldest first within each visit. */
export function useProjectVisitPhotos(projectId: string) {
  return useQuery({
    queryKey: ["visit-photos", projectId],
    queryFn: async () => {
      // install_visit_photos is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as unknown as { from: (t: string) => any })
        .from("install_visit_photos")
        .select("id,visit_id,storage_path,caption,taken_at,taken_by")
        .eq("project_id", projectId)
        .order("taken_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as VisitPhoto[];
    },
  });
}

/** Every work-order line on a project, so each card can say what it covers and the form can say what is left of each estimate item. */
export function useProjectVisitLines(projectId: string) {
  return useQuery({
    queryKey: ["visit-lines", projectId],
    queryFn: async () => {
      // install_visit_lines is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as unknown as { from: (t: string) => any })
        .from("install_visit_lines")
        .select("id,visit_id,estimate_line_id,finish_id,description,quantity,uom,cost_code,sort_order")
        .eq("project_id", projectId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as (VisitLine & { id: string; visit_id: string })[];
    },
  });
}

/** The items of the job's approved estimate (without costs), for the work-order form; empty while no estimate exists. */
export function useWorkOrderItems(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["work-order-items", projectId],
    enabled,
    queryFn: async () => {
      // work_order_items is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any }).rpc("work_order_items", { _project: projectId });
      if (error) throw error;
      return (data ?? []) as WorkOrderItem[];
    },
  });
}

/** The visits of a project with a push to ArrivePing still pending in the outbox, so "Resend" waits for it. */
export function usePendingVisitPushes(projectId: string) {
  return useQuery({
    queryKey: ["visit-pushes-pending", projectId],
    refetchInterval: 15_000,
    queryFn: async () => {
      // sync_events is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as unknown as { from: (t: string) => any })
        .from("sync_events")
        .select("entity_id")
        .eq("project_id", projectId)
        .eq("entity_type", "visit")
        .eq("direction", "out")
        .eq("status", "pending");
      if (error) throw error;
      return new Set(((data ?? []) as { entity_id: string | null }[]).map((r) => r.entity_id).filter((x): x is string => !!x));
    },
  });
}
