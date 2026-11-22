import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";

export type PlanSheet = { id: string; project_id: string; document_id: string; page_number: number; sheet_number: string | null; title: string | null; discipline: string | null; floor_label: string | null; width_pt: number | null; height_pt: number | null; rotation: number };
const COLS = "id,project_id,document_id,page_number,sheet_number,title,discipline,floor_label,width_pt,height_pt,rotation";

export function useSheets(documentId: string | null) {
  return useQuery({
    queryKey: ["plan-sheets", documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await db.from("plan_sheets").select(COLS).eq("document_id", documentId!).order("page_number");
      if (error) throw error;
      return ((data ?? []) as PlanSheet[]).map((s) => ({ ...s, width_pt: s.width_pt == null ? null : Number(s.width_pt), height_pt: s.height_pt == null ? null : Number(s.height_pt) }));
    },
  });
}
export function useRefreshSheets(documentId: string | null) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["plan-sheets", documentId] });
}

/** Makes sure every page of the PDF has a sheet row. Safe to call again: existing rows are left alone. */
export async function ensureSheets(projectId: string, documentId: string, pageCount: number, have: number[]) {
  const missing = Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => !have.includes(n));
  for (let i = 0; i < missing.length; i += 200) {
    const { error } = await db.from("plan_sheets").upsert(missing.slice(i, i + 200).map((n) => ({ project_id: projectId, document_id: documentId, page_number: n })), { onConflict: "document_id,page_number", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return missing.length;
}
export async function updateSheet(id: string, patch: Partial<Pick<PlanSheet, "sheet_number" | "title" | "discipline" | "floor_label" | "width_pt" | "height_pt" | "rotation">>) {
  const { error } = await db.from("plan_sheets").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
