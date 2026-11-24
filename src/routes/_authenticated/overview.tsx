import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/platform/db";
import { money, shortDate, usePipelineProjects } from "@/lib/projects/data";
import { clientJobs } from "@/lib/projects/joblist";
import { STAGES } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";
import { useUnreviewedScopeByProject } from "@/lib/documents/scope-data";
import { useScopeBackfillOnce } from "@/components/projects/ScopeReview";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Overview · BMD Materials" },
      { name: "description", content: "Every BMD job and where it stands: stages, bids due, installs this week, open deficiencies and billing." },
      { property: "og:title", content: "Overview · BMD Materials" },
      { property: "og:description", content: "Every BMD job and where it stands." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverviewPage,
});

const DAY = 86_400_000;
const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const weekRange = () => {
  const s = todayStart();
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  const e = new Date(s.getTime() + 7 * DAY);
  return { start: s, end: e };
};

function Card({ title, loading, children, className }: { title: string; loading?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-4 text-sm", className)}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {loading ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-muted" />)}</div> : children}
    </section>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className="text-muted-foreground">{children}</p>;

function OverviewPage() {
  const { canAny } = useAuth();
  if (!canAny("view_pipeline")) return <Navigate to="/" replace />;
  return (
    <div>
      <PageHeader title="Overview" subtitle="Every job, where it stands" />
      <div className="grid gap-4 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-3">
        <JobsByStage />
        <BidsDue />
        <InstallingThisWeek />
        {canAny("view_dashboard") && <OpenDeficiencies />}
        {canAny("view_pricing") && <BillsNeedingAttention />}
        {canAny("manage_projects") && <NoSiteYet />}
        <ScopeHitsToReview />
      </div>
    </div>
  );
}

function JobsByStage() {
  const { canAny } = useAuth();
  const { data, isLoading } = usePipelineProjects();
  const pricing = canAny("view_pricing");
  return (
    <Card title="Jobs by stage" loading={isLoading} className="md:col-span-2 xl:col-span-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {STAGES.map((s) => {
          const rows = clientJobs(data ?? []).filter((p) => p.stage === s.value);
          const total = rows.reduce((t, p) => t + (p.estimated_value_cents ?? 0), 0);
          return (
            <Link key={s.value} to="/pipeline" className="rounded-md border border-border p-3 hover:bg-muted">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-semibold">{rows.length}</p>
              {pricing && <p className="text-xs text-muted-foreground">{money(total)}</p>}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function BidsDue() {
  const { data, isLoading } = usePipelineProjects();
  const limit = todayStart().getTime() + 15 * DAY;
  const today = todayStart().getTime();
  const rows = (data ?? [])
    .filter((p) => ["opportunity", "estimating", "quote_out"].includes(p.stage) && p.bid_due_date && new Date(`${p.bid_due_date}T00:00:00`).getTime() < limit)
    .sort((a, b) => a.bid_due_date!.localeCompare(b.bid_due_date!));
  return (
    <Card title="Bids due" loading={isLoading}>
      {rows.length === 0 ? (
        <Empty>Nothing due in the next two weeks.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => {
            const overdue = new Date(`${p.bid_due_date}T00:00:00`).getTime() < today;
            return (
              <li key={p.id}>
                <Link to="/projects/$id" params={{ id: p.id }} className="flex justify-between gap-2 py-2 hover:underline">
                  <span className="truncate">{p.name}</span>
                  <span className={cn("shrink-0", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>{overdue ? "Overdue · " : ""}{shortDate(p.bid_due_date)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

type Visit = { id: string; project_id: string; starts_at: string; crew: string | null; notes: string | null; arriveping_status: string | null; arriveping_assigned_to: string | null; projects: { name: string } | null };
function InstallingThisWeek() {
  const { start, end } = weekRange();
  const { data, isLoading } = useQuery({
    queryKey: ["overview-visits", start.toISOString()],
    queryFn: async () => {
      const { data, error } = await db
        .from("install_visits")
        .select("id,project_id,starts_at,crew,notes,arriveping_status,arriveping_assigned_to,projects(name)")
        .gte("starts_at", start.toISOString())
        .lt("starts_at", end.toISOString())
        .order("starts_at");
      if (error) throw error;
      return (data ?? []) as unknown as Visit[];
    },
  });
  const days = new Map<string, Visit[]>();
  for (const v of data ?? []) {
    const k = new Date(v.starts_at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    days.set(k, [...(days.get(k) ?? []), v]);
  }
  return (
    <Card title="Installing this week" loading={isLoading}>
      {days.size === 0 ? (
        <Empty>No installs scheduled this week.</Empty>
      ) : (
        <div className="space-y-3">
          {[...days].map(([day, vs]) => (
            <div key={day}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</p>
              <ul>
                {vs.map((v) => (
                  <li key={v.id}>
                    <Link to="/projects/$id" params={{ id: v.project_id }} search={{ tab: "overview" }} className="block py-1.5 hover:underline">
                      <span className="font-medium">{v.projects?.name ?? "Job"}</span>
                      {(v.notes || v.crew) && <span className="text-muted-foreground"> · {v.notes || v.crew}</span>}
                      {(v.arriveping_assigned_to || v.arriveping_status) && (
                        <span className="block text-xs text-muted-foreground">ArrivePing: {[v.arriveping_assigned_to, v.arriveping_status].filter(Boolean).join(" · ")}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OpenDeficiencies() {
  const { setProjectId, projectId } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: projects } = usePipelineProjects();
  const { data, isLoading } = useQuery({
    queryKey: ["overview-must-fix"],
    queryFn: async () => {
      const { data, error } = await db.from("deficiencies").select("project_id").eq("assessment", "must_fix").not("status", "in", "(fixed,verified,accepted_as_is)");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of data ?? []) counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1]);
    },
  });
  const nameOf = (id: string) => projects?.find((p) => p.id === id)?.name ?? "Job";
  const open = (id: string) => {
    if (id !== projectId) {
      setProjectId(id);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "project" });
    }
    void navigate({ to: "/board" });
  };
  return (
    <Card title="Open deficiencies (must fix)" loading={isLoading}>
      {!data?.length ? (
        <Empty>No open must-fix items.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.map(([id, n]) => (
            <li key={id}>
              <button type="button" onClick={() => open(id)} className="flex w-full justify-between gap-2 py-2 text-left hover:underline">
                <span className="truncate">{nameOf(id)}</span>
                <span className="font-semibold">{n}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Bill = { id: string; project_id: string; number: string | null; total_cents: number; projects: { name: string } | null };
function BillsNeedingAttention() {
  const { data, isLoading } = useQuery({
    queryKey: ["overview-draft-bills"],
    queryFn: async () => {
      const { data, error } = await db.from("progress_bills").select("id,project_id,number,total_cents,projects(name)").eq("status", "draft").order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Bill[];
    },
  });
  return (
    <Card title="Bills needing attention" loading={isLoading}>
      {!data?.length ? (
        <Empty>No draft bills waiting.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((b) => (
            <li key={b.id}>
              <Link to="/projects/$id" params={{ id: b.project_id }} search={{ tab: "billing" }} className="flex justify-between gap-2 py-2 hover:underline">
                <span className="truncate">{b.projects?.name ?? "Job"}{b.number ? ` · ${b.number}` : ""} <span className="text-muted-foreground">· Draft</span></span>
                <span className="shrink-0">{money(b.total_cents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NoSiteYet() {
  const { data, isLoading } = usePipelineProjects();
  const rows = clientJobs(data ?? []).filter((p) => (p.stage === "won" || p.stage === "in_progress") && p.floorCount === 0);
  return (
    <Card title="Won but no site set up" loading={isLoading}>
      {rows.length === 0 ? (
        <Empty>Every won job has its site set up.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id}>
              <Link to="/new-job" search={{ project: p.id }} className="flex justify-between gap-2 py-2 hover:underline">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-primary">Set up site →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScopeHitsToReview() {
  useScopeBackfillOnce(true);
  const { data, isLoading } = useUnreviewedScopeByProject(true);
  const { data: projects } = usePipelineProjects();
  const name = new Map((projects ?? []).map((p) => [p.id, p.name]));
  return (
    <Card title="Scope hits to review" loading={isLoading}>
      {!data?.length ? (
        <Empty>No scope hits waiting for review.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((p) => (
            <li key={p.id}>
              <Link to="/projects/$id" params={{ id: p.id }} search={{ tab: "documents" }} className="flex justify-between gap-2 py-2 hover:underline">
                <span className="truncate">{name.get(p.id) ?? "Project"}</span>
                <span className="shrink-0 text-muted-foreground">{p.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
