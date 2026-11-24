import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { Visit } from "./logic";

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
