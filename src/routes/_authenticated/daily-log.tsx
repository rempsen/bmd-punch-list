import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, NotebookPen } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { DailyLogPanel } from "@/components/dailylog/DailyLogPanel";
import { RequestsListsPanel } from "@/components/dailylog/RequestsListsPanel";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

type View = "log" | "lists";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/daily-log")({
  head: () => ({ meta: [{ title: "Daily log & requests — BMD Projects" }] }),
  validateSearch: (s: Record<string, unknown>): { job?: string | undefined; view?: View | undefined } => ({
    job: typeof s["job"] === "string" && UUID.test(s["job"]) ? s["job"] : undefined,
    view: s["view"] === "lists" ? "lists" : undefined,
  }),
  component: DailyLogPage,
});

type JobRow = { id: string; name: string; archived_at: string | null };

/** The crew's page, made for a phone: pick the job, then add today's log, ask for things, tick the lists. */
function DailyLogPage() {
  const { job, view = "log" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { currentJob, user } = useAuth();
  // Every job the person is on, including ones with no floors and rooms set up yet.
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["my-jobs-for-log", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("my_projects");
      if (error) throw new Error(error.message);
      return ((data ?? []) as JobRow[]).filter((j) => !j.archived_at).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const chosen = jobs.find((j) => j.id === job) ?? jobs.find((j) => j.id === currentJob?.id) ?? (jobs.length === 1 ? jobs[0] : undefined);
  const go = (patch: { job?: string; view?: View }) => void navigate({ search: (prev) => ({ ...prev, ...patch, ...(patch.view === "log" ? { view: undefined } : {}) }), replace: true });

  const seg = (v: View, label: string, Icon: typeof NotebookPen) => (
    <button
      type="button"
      onClick={() => go({ view: v })}
      aria-pressed={view === v}
      className={cn("flex h-12 flex-1 items-center justify-center gap-2 rounded-md text-sm font-semibold", view === v ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <div>
      <PageHeader title="Daily log & requests" subtitle={chosen?.name ?? "Choose a job"} />
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        {jobs.length > 1 && (
          <label className="block text-xs text-muted-foreground">
            Job
            <select className="mt-1 block h-12 w-full rounded-md border border-input bg-background px-3 text-base text-foreground" value={chosen?.id ?? ""} onChange={(e) => e.target.value && go({ job: e.target.value })}>
              {!chosen && <option value="">Choose a job…</option>}
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">You aren't on any job yet. Ask the office to add you to one.</p>
        ) : !chosen ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Choose the job you are on today.</p>
        ) : (
          <>
            <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
              {seg("log", "Daily log", NotebookPen)}
              {seg("lists", "Requests & lists", ClipboardList)}
            </div>
            {view === "log" ? <DailyLogPanel key={chosen.id} projectId={chosen.id} /> : <RequestsListsPanel key={chosen.id} projectId={chosen.id} />}
          </>
        )}
      </div>
    </div>
  );
}
