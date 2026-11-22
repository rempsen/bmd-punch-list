import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { MoveStageDialog } from "@/components/projects/MoveStageDialog";
import { ProjectsTable } from "@/components/projects/ProjectsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { useBmdStaff, usePipelineProjects, useRefreshPipeline, type PipelineProject } from "@/lib/projects/data";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — BMD Projects" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { canAny, user } = useAuth();
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
        {shown.length > 0 && <ProjectsTable rows={shown} staff={staff} canEdit={canEdit} onMove={setMoving} />}
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
