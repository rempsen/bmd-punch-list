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
        .select("id,visit_id,estimate_line_id,finish_id,description,quantity,uom,cost_code,sort_order,labour_rate_source,labour_rate_id")
        .eq("project_id", projectId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as (VisitLine & { id: string; visit_id: string })[];
    },
  });
}

export type WorkOrderValue = { visit_id: string; line_id: string | null; unit_labour_cost_cents: number | null; labour_rate_source: "estimate" | "catalogue" | "manual" | null; labour_rate_id: string | null; line_value_cents: number | null; uncosted: number };
export type WorkOrderValues = {
  /** By work-order line id: its rate and value. */
  lines: Map<string, WorkOrderValue>;
  /** By work order: what it pays the installer and how many of its lines have no rate. */
  visits: Map<string, { total_cents: number; uncosted: number }>;
};

/**
 * What each work order on a job is worth (quantity × the rate each line was created with), for people with
 * view_pricing on the job; pass `canPrice` from that. Empty maps for anyone else.
 */
export function useWorkOrderValues(projectId: string, canPrice: boolean) {
  return useQuery({
    queryKey: ["work-order-values", projectId, canPrice],
    enabled: !!projectId && canPrice,
    queryFn: async (): Promise<WorkOrderValues> => {
      // work_order_values is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (db as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any }).rpc("work_order_values", { _project: projectId });
      if (error) throw error;
      const lines = new Map<string, WorkOrderValue>();
      const visits = new Map<string, { total_cents: number; uncosted: number }>();
      type Raw = { visit_id: string; line_id: string | null; unit_labour_cost_cents: number | string | null; labour_rate_source: WorkOrderValue["labour_rate_source"]; labour_rate_id: string | null; line_value_cents: number | string | null; uncosted: number | string | null };
      for (const raw of (data ?? []) as Raw[]) {
        const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        const r: WorkOrderValue = {
          visit_id: String(raw.visit_id),
          line_id: raw.line_id ? String(raw.line_id) : null,
          unit_labour_cost_cents: n(raw.unit_labour_cost_cents),
          labour_rate_source: raw.labour_rate_source ?? null,
          labour_rate_id: raw.labour_rate_id ? String(raw.labour_rate_id) : null,
          line_value_cents: n(raw.line_value_cents),
          uncosted: Number(raw.uncosted ?? 0),
        };
        if (r.line_id) lines.set(r.line_id, r);
        else visits.set(r.visit_id, { total_cents: r.line_value_cents ?? 0, uncosted: r.uncosted });
      }
      return { lines, visits };
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
