import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { InspectionKind, ItemResult, Outcome, SignMethod } from "./logic";

export type Inspection = {
  id: string; project_id: string; kind: InspectionKind; scheduled_for: string | null; held_at: string | null; held_by: string | null;
  attendees: string | null; outcome: Outcome; notes: string | null; created_at: string;
  inspection_items: { result: ItemResult; deficiency_id: string | null }[];
};
export type InspectionItem = { id: string; inspection_id: string; project_id: string; room_id: string | null; scope: string | null; description: string; result: ItemResult; note: string | null; deficiency_id: string | null; sort: number };
export type Signoff = {
  id: string; project_id: string; inspection_id: string | null; signed_by_name: string; signed_by_email: string | null; signed_at: string | null;
  method: SignMethod; signature_data: string | null; notes: string | null; link_expires_at: string | null; document_id: string | null;
  holdback_released: boolean; holdback_bill_id: string | null; holdback_released_at: string | null; created_at: string;
};

export function useInspections(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["inspections", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("inspections").select("*,inspection_items(result,deficiency_id)").eq("project_id", projectId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Inspection[];
    },
  });
}

export function useInspectionItems(inspectionId: string | null) {
  return useQuery({
    queryKey: ["inspection-items", inspectionId],
    enabled: !!inspectionId,
    queryFn: async () => {
      const { data, error } = await db.from("inspection_items").select("*").eq("inspection_id", inspectionId!).order("sort");
      if (error) throw error;
      return (data ?? []) as InspectionItem[];
    },
  });
}

export function useSignoffs(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["signoffs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("signoffs").select("*").eq("project_id", projectId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Signoff[];
    },
  });
}

export function useRefreshSignoff() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["inspections", "inspection-items", "signoffs", "signoff-activity"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}
