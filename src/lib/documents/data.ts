import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { DocRow } from "./logic";

const COLS = "id,project_id,section,file_name,storage_path,size_bytes,mime,version,uploaded_by,note,mirror_status,mirror_error,text_status,text_pages,text_error,created_at";

export function useProjectDocuments(projectId: string | null) {
  return useQuery({
    queryKey: ["project-documents", projectId],
    enabled: !!projectId,
    refetchInterval: (q) => (q.state.data as DocRow[] | undefined)?.some((d) => d.text_status === "pending") ? 2000 : false,
    queryFn: async () => {
      const { data, error } = await db.from("project_documents").select(COLS).eq("project_id", projectId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
  });
}

export function useRefreshDocuments(projectId: string | null) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["project-documents", projectId] });
}
