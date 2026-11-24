import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Briefcase, ChevronRight } from "lucide-react";
import { resolveHome, useAuth } from "@/lib/auth";
import { NAV_GROUP_KEYS, navGroupOpen } from "@/lib/nav";
import { useOpenJobs } from "@/lib/projects/data";
import { splitOpenJobs, type OpenJob } from "@/lib/projects/joblist";
import { cn } from "@/lib/utils";

/**
 * The open jobs, always to hand in the sidebar. Closed until the person opens it, and it stays the way they left it.
 * Nothing is fetched while it is closed; when open it is one small query kept for five minutes.
 */
export function OpenJobsNav() {
  const { jobs, projectId, setProjectId, canAny, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    try {
      setOpen(navGroupOpen(window.localStorage.getItem(NAV_GROUP_KEYS.openJobs), false));
    } catch {
      /* storage blocked */
    }
  }, []);
  const staff = canAny("view_pipeline");
  const { data = [], isLoading, error } = useOpenJobs(open && !!user);
  if (!user || (!staff && jobs.length === 0)) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(NAV_GROUP_KEYS.openJobs, next ? "open" : "closed");
    } catch {
      /* not remembered */
    }
  };
  // Office staff can open any job's page. Everyone else sees only the jobs whose site they are on.
  const mine = (id: string) => jobs.find((j) => j.id === id);
  const { internal, jobs: clientJobs } = splitOpenJobs(staff ? data : data.filter((j) => mine(j.id)), q);

  const pick = (job: OpenJob) => {
    const site = mine(job.id);
    if (site && job.id !== projectId) {
      setProjectId(job.id);
      // Screens for the job that was open must not show under the new one.
      qc.removeQueries({ predicate: (x) => x.queryKey[0] !== "project" && x.queryKey[0] !== "open-jobs" });
    }
    if (staff) void navigate({ to: "/projects/$id", params: { id: job.id } });
    else void resolveHome(site?.role ?? null, job.id).then((to) => navigate({ to }));
  };

  const row = (job: OpenJob) => (
    <li key={job.id}>
      <button
        type="button"
        onClick={() => pick(job)}
        aria-current={job.id === projectId ? "true" : undefined}
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-sm transition-colors",
          job.id === projectId ? "border-blush bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "border-transparent opacity-85 hover:bg-sidebar-accent/60",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{job.name}</span>
        {job.project_number && <span className="shrink-0 font-mono text-[10px] opacity-70">{job.project_number}</span>}
      </button>
    </li>
  );

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="nav-open-jobs"
        className="flex items-center gap-3 rounded-md border-l-2 border-transparent px-3 py-2.5 text-left text-sm font-medium opacity-80 transition-colors hover:bg-sidebar-accent/60"
      >
        <Briefcase className="h-4 w-4" />
        <span className="min-w-0 flex-1">Open jobs</span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      <div id="nav-open-jobs">
        {open && (
          <div className="ml-5 border-l border-sidebar-border pl-1">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a job…"
              aria-label="Find an open job"
              className="mb-1 h-9 w-full rounded-md border border-sidebar-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
            {isLoading ? (
              <p className="px-2 py-1.5 text-xs opacity-70">Loading…</p>
            ) : error ? (
              <p className="px-2 py-1.5 text-xs opacity-70">Could not load the open jobs.</p>
            ) : internal.length + clientJobs.length === 0 ? (
              <p className="px-2 py-1.5 text-xs opacity-70">{q.trim() ? "No open job matches." : "No open jobs. A job shows here once it is won."}</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {internal.length > 0 && (
                  <>
                    <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide opacity-60">Internal</p>
                    <ul>{internal.map(row)}</ul>
                    {clientJobs.length > 0 && <p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide opacity-60">Jobs</p>}
                  </>
                )}
                <ul>{clientJobs.map(row)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
