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
        .select(
          "id,starts_at,ends_at,crew,notes,site_contact,arriveping_job_id,arriveping_status,arriveping_assigned_to,arriveping_last_event_at,status",
        )
        .eq("project_id", projectId)
        .order("starts_at");
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
  });
}
