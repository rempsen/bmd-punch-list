import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRightLeft, Hammer, Plus } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { MoveStageDialog } from "@/components/projects/MoveStageDialog";
import { StageBadge } from "@/components/projects/StageBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { holderOf, staffName, useBmdStaff, usePipelineProjects, useRefreshPipeline, type PipelineProject } from "@/lib/projects/data";
import { daysInStage, isOverdue } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — BMD Projects" }] }),
  component: ProjectsPage,
});

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—";

function ProjectsPage() {
  const { canAny, user } = useAuth();
  const navigate = useNavigate();
  const canSee = canAny("view_pipeline");
  const canEdit = canAny("manage_projects");
  const { data: projects = [], isLoading, error } = usePipelineProjects();
  const { data: staff = [] } = useBmdStaff();
  const refresh = useRefreshPipeline();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [moving, setMoving] = useState<PipelineProject | null>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (!s || `${p.project_number ?? ""} ${p.name} ${p.client_name ?? ""}`.toLowerCase().includes(s)) &&
        (!mine || p.members.some((m) => m.user_id === user?.id && m.job_roles.length > 0)),
    );
  }, [projects, q, mine, user?.id]);

  if (!canSee) return <p className="p-6 text-sm text-muted-foreground">You don't have access to projects.</p>;

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
        actions={
          canEdit ? (
            <Button asChild>
              <Link to="/projects/new">
                <Plus className="mr-2 h-4 w-4" /> New project
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" className="h-11 max-w-md" />
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            My projects
          </label>
        </div>
        {error && <p className="text-sm text-destructive">Could not load projects: {errText(error)}</p>}
        {!isLoading && !error && shown.length === 0 && (
          <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {projects.length === 0 ? "No projects yet. Start one with New project." : "No projects match."}
          </p>
        )}
        {shown.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">No.</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium">Bid due</th>
                  <th className="px-4 py-2.5 font-medium">Estimator</th>
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((p) => {
                  const needsSite = (p.stage === "won" || p.stage === "in_progress") && p.floorCount === 0;
                  return (
                    <tr key={p.id} className="align-middle">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{p.project_number ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.client_name ?? "No client"}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StageBadge stage={p.stage} />
                        <div className="mt-0.5 text-xs text-muted-foreground">{daysInStage(p.stage_entered_at)} d</div>
                      </td>
                      <td className={cn("whitespace-nowrap px-4 py-3", isOverdue(p.bid_due_date, p.stage) && "font-semibold text-destructive")}>
                        {fmtDate(p.bid_due_date)}
                      </td>
                      <td className="px-4 py-3">{staffName(staff, holderOf(p, "estimator")) ?? "—"}</td>
                      <td className="px-4 py-3">{staffName(staff, holderOf(p, "project_lead")) ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {canEdit && needsSite && (
                          <Button size="sm" variant="outline" className="mr-2" onClick={() => void navigate({ to: "/new-job", search: { project: p.id } })}>
                            <Hammer className="mr-1.5 h-4 w-4" /> Set up site
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="sm" variant="ghost" onClick={() => setMoving(p)}>
                            <ArrowRightLeft className="mr-1.5 h-4 w-4" /> Move
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {moving && (
        <MoveStageDialog
          project={moving}
          onClose={() => setMoving(null)}
          onMoved={() => {
            refresh();
            setMoving(null);
          }}
        />
      )}
    </div>
  );
}
