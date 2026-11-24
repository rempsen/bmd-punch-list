import { Link } from "@tanstack/react-router";
import { useJobSiteCounts } from "@/lib/dailylog/data";

/** Two numbers on the job Overview: daily logs this week and open requests. Shows nothing until they can be read. */
export function SiteCounts({ projectId }: { projectId: string }) {
  const { data } = useJobSiteCounts(projectId);
  if (!data) return null;
  const tile = "flex min-h-[64px] flex-1 flex-col justify-center rounded-lg border border-border bg-card px-4 py-2 hover:border-primary";
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <Link to="/projects/$id" params={{ id: projectId }} search={{ tab: "log" }} className={tile}>
        <span className="text-xs text-muted-foreground">Daily logs this week</span>
        <span className="text-sm">
          <span className="text-xl font-semibold">{data.logs_this_week_job}</span> on this job · {data.logs_this_week_all} across all jobs
        </span>
      </Link>
      <Link to="/projects/$id" params={{ id: projectId }} search={{ tab: "requests" }} className={tile}>
        <span className="text-xs text-muted-foreground">Open requests</span>
        <span className="text-xl font-semibold">{data.open_requests}</span>
      </Link>
    </div>
  );
}
