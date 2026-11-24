import { Link } from "@tanstack/react-router";
import { ConfirmationPill, VisitTags } from "@/components/scheduling/schedule-bits";
import { StatusPill } from "@/components/visits/visit-bits";
import { reportLine } from "@/lib/scheduling/assignments";
import { useTechnicianVisits } from "@/lib/scheduling/data";
import { scheduleRange } from "@/lib/visits/logic";

const STATUS: Record<string, string> = { scheduled: "Scheduled", en_route: "On the way", arrived: "On site", completed: "Complete", cancelled: "Cancelled" };

/** The visits a technician or subcontractor has been given, newest first. `techId` is a staff id or "sup:<vendor id>". */
export function TechnicianVisits({ techId, linkJobs = true }: { techId: string; linkJobs?: boolean }) {
  const { data, isLoading, error } = useTechnicianVisits(techId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading visits…</p>;
  if (error) return <p className="text-sm text-destructive">The visits could not be loaded.</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No visits yet. Assign them from Scheduling → Schedule a visit.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {data.map((v) => {
        const job = [v.project?.project_number, v.project?.name].filter(Boolean).join(" · ") || "Job";
        return (
          <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {linkJobs && v.project ? (
                <Link to="/projects/$id" params={{ id: v.project.id }} search={{ tab: "site" }} className="font-medium text-primary underline-offset-4 hover:underline">
                  {job}
                </Link>
              ) : (
                <span className="font-medium">{job}</span>
              )}
              {v.scope && <span className="ml-2 text-muted-foreground">{v.scope}</span>}
              <VisitTags v={v} className="ml-2 align-middle" />
              <span className="block text-xs text-muted-foreground">{reportLine(v)}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">{scheduleRange(v.starts_at, v.ends_at)}</span>
            {v.status === "scheduled" && !v.tentative && <ConfirmationPill v={v} />}
            <StatusPill label={STATUS[v.arriveping_status || v.status] ?? STATUS[v.status] ?? v.status} />
          </li>
        );
      })}
    </ul>
  );
}
