import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, FileClock, MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { resolveHome, useAuth } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/jobs")({
  head: () => ({
    meta: [
      { title: "Choose a job — BMD Deficiency Tracker" },
      { name: "description", content: "Pick the job you want to work on." },
      { property: "og:title", content: "Choose a job — BMD Deficiency Tracker" },
      { property: "og:description", content: "Pick the job you want to work on." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobsPage,
});

function JobsPage() {
  const { jobs, jobsLoaded, projectId, setProjectId, canCreateJobs, user } = useAuth();
  const { data: drafts = [], refetch } = useQuery({
    queryKey: ["job-drafts", user?.id],
    enabled: canCreateJobs && !!user,
    queryFn: async () => {
      const { data } = await supabase.from("job_drafts").select("id,name,step,updated_at").order("updated_at", { ascending: false });
      return data ?? [];
    },
  });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const active = jobs.filter((j) => !j.archived_at);
  const archived = jobs.filter((j) => j.archived_at);

  const pick = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    setProjectId(id);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "project" });
    void resolveHome(job?.role ?? null, id).then((to) => navigate({ to }));
  };

  return (
    <div>
      <PageHeader
        title="Choose a job"
        subtitle="Everything you see is for one job at a time."
        actions={
          canCreateJobs ? (
            <Button asChild className="h-11">
              <Link to="/new-job">
                <Plus className="mr-1 h-4 w-4" /> Add new job
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="p-4 md:p-6">
        {drafts.length > 0 && (
          <div className="mb-6 rounded-lg border border-dashed border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Unfinished new jobs</h2>
            <ul className="divide-y divide-border">
              {drafts.map((dr) => (
                <li key={dr.id} className="flex items-center gap-2 py-2 text-sm">
                  <FileClock className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">
                    {dr.name} · step {dr.step} of 5 · saved {new Date(dr.updated_at).toLocaleDateString()}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/new-job" search={{ draft: dr.id }}>Continue</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete draft"
                    onClick={async () => {
                      if (!confirm("Delete this draft?")) return;
                      await supabase.from("job_drafts").delete().eq("id", dr.id);
                      void refetch();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!jobsLoaded ? (
          <p className="text-sm text-muted-foreground">Loading jobs…</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-6 text-sm">
            <p className="font-medium">You haven't been added to a job yet.</p>
            <p className="mt-1 text-muted-foreground">Ask your BMD admin to add you to a job in Settings → Users.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((j) => (
                <JobCard key={j.id} job={j} current={j.id === projectId} onPick={() => pick(j.id)} />
              ))}
            </div>
            {archived.length > 0 && (
              <>
                <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground">Archived jobs</h2>
                <div className="grid gap-3 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
                  {archived.map((j) => (
                    <JobCard key={j.id} job={j} current={j.id === projectId} onPick={() => pick(j.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function JobCard({
  job,
  current,
  onPick,
}: {
  job: ReturnType<typeof useAuth>["jobs"][number];
  current: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className={cn(
        "min-h-[120px] rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary",
        current ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Building2 className="h-4 w-4 text-primary" /> {job.name}
        </p>
        {current && <Check className="h-4 w-4 text-primary" />}
      </div>
      {job.address && (
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {job.address}
        </p>
      )}
      {job.client_name && <p className="mt-1 text-sm text-muted-foreground">Client: {job.client_name}</p>}
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="rounded bg-muted px-2 py-0.5 font-medium">{job.open_count} open items</span>
        <span className="text-muted-foreground">{roleLabel(job.role ?? "")}</span>
      </div>
    </button>
  );
}
