import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { transitionPatch, type MaterialStatus } from "./logic";

export type MaterialOrder = {
  id: string;
  project_id: string;
  estimate_line_id: string | null;
  catalogue_item_id: string | null;
  supplier_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_cost_cents: number | null;
  status: MaterialStatus;
  ordered_at: string | null;
  source_version_id: string | null;
  po_number: string | null;
  qbo_po_id: string | null;
  qbo_po_sent_at: string | null;
  received_at: string | null;
  received_by: string | null;
  received_qty: number | null;
  received_note: string | null;
  on_site_at: string | null;
  on_site_by: string | null;
  notes: string | null;
  created_at: string;
};

const KEY = ["material-orders"] as const;

/** Every material order line the signed-in person may see, across all jobs. */
export function useMaterialOrders() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await db.from("material_orders").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaterialOrder[];
    },
  });
}

/** One job's material that has not reached site yet — what Installation Progress shows as "Awaiting material". */
export function useAwaitingMaterial(projectId: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, "awaiting", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("material_orders").select("*").eq("project_id", projectId!).neq("status", "on_site").order("created_at");
      if (error) throw error;
      return (data ?? []) as MaterialOrder[];
    },
  });
}

export function useRefreshMaterials() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

/** Moves lines one step, recording who and when. */
export function useMoveMaterials() {
  const refresh = useRefreshMaterials();
  return useMutation({
    mutationFn: async (a: { rows: MaterialOrder[]; to: MaterialStatus; at?: string; by?: string | null; qty?: number | null; note?: string | null; po?: string | null }) => {
      for (const r of a.rows) {
        const patch = transitionPatch(r.status, a.to, { ...(a.at ? { at: a.at } : {}), by: a.by ?? null, qty: a.to === "received" ? (a.qty ?? r.quantity) : null, note: a.note ?? null, po: a.po ?? null });
        const { error } = await db.from("material_orders").update(patch).eq("id", r.id).eq("status", r.status);
        if (error) throw new Error(error.message);
      }
    },
    onSettled: refresh,
  });
}

export function useAddMaterial() {
  const refresh = useRefreshMaterials();
  return useMutation({
    mutationFn: async (row: { project_id: string; description: string; quantity: number; unit: string; supplier_id: string | null; unit_cost_cents: number | null; catalogue_item_id?: string | null }) => {
      const { error } = await db.from("material_orders").insert(row);
      if (error) throw new Error(error.message);
    },
    onSettled: refresh,
  });
}
