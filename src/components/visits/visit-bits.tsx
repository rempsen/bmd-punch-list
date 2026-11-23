import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { apWorkOrderUrl } from "@/lib/arriveping/core";
import { db } from "@/lib/platform/db";
import type { Visit, VisitStatus } from "@/lib/visits/logic";

/** What the crew calls each BMD visit status. */
export const VISIT_LABEL: Record<VisitStatus, string> = {
  scheduled: "Scheduled",
  en_route: "On the way",
  arrived: "On site",
  completed: "Completed",
  cancelled: "Cancelled",
};

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

/** The visit's own status, as a small grey tag. */
export function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{label}</span>
  );
}

/** What ArrivePing says about the visit, as an outlined pill. */
export function ArrivePingPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

/** Link to the work order in ArrivePing, opening in a new tab. */
export function OpenInArrivePing({ jobId }: { jobId: string }) {
  return (
    <a
      href={apWorkOrderUrl(jobId)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      Open in ArrivePing
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
