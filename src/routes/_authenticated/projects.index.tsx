import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { MoveStageDialog } from "@/components/projects/MoveStageDialog";
import { ProjectsTable } from "@/components/projects/ProjectsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { useBmdStaff, usePipelineProjects, useQboLinkedJobs, useRefreshPipeline, type PipelineProject } from "@/lib/projects/data";
import { DEFAULT_PREFS, LIST_PREFS_KEY, SORT_CHOICES, filterJobs, groupCounts, jobsExportRows, parsePrefs, sortChoice, type JobGroup, type ListPrefs } from "@/lib/projects/joblist";
import { sortProjects, toCsv } from "@/lib/projects/pipeline";
import { STAGE_GROUPS } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({ meta: [{ title: "Projects — BMD Projects" }] }),
  component: ProjectsPage,
});

const GROUP_BUTTONS: { value: JobGroup; label: string }[] = [...STAGE_GROUPS.map((g) => ({ value: g.value as JobGroup, label: g.label })), { value: "all", label: "All" }];
const EMPTY_HINT: Record<JobGroup, string> = {
  presale: "No jobs are being bid right now.",
  open: "No open jobs. A job shows here once it is won.",
  warranty: "No jobs in warranty. Move a finished job to Warranty from its Move button.",
  closed: "No closed or lost jobs.",
  all: "No projects yet. Start one with New project.",
};

function ProjectsPage() {
  const { canAny, user } = useAuth();
  const canSee = canAny("view_pipeline");
  const canEdit = canAny("manage_projects");
  const { data: projects = [], isLoading, error } = usePipelineProjects();
  const { data: staff = [] } = useBmdStaff();
  const { data: qboLinked } = useQboLinkedJobs(canSee);
  const refresh = useRefreshPipeline();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [moving, setMoving] = useState<PipelineProject | null>(null);
  // The last filter and sort are remembered in this browser. Read after mount so the first paint matches the server's.
  const [prefs, setPrefs] = useState<ListPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    try {
      setPrefs(parsePrefs(window.localStorage.getItem(LIST_PREFS_KEY)));
    } catch {
      /* storage blocked: defaults */
    }
  }, []);
  const remember = (p: Partial<ListPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try {
      window.localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  const counts = useMemo(() => groupCounts(projects), [projects]);
  const shown = useMemo(() => filterJobs(projects, { group: prefs.group, text: q, mineId: mine ? (user?.id ?? null) : null }), [projects, prefs.group, q, mine, user?.id]);

  if (!canSee) return <p className="p-6 text-sm text-muted-foreground">You don't have access to projects.</p>;

  const exportCsv = () => {
    const rows = jobsExportRows(sortProjects(shown, prefs.key, prefs.dir), staff, qboLinked ?? new Set());
    const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `bmd-jobs-${prefs.group}-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${shown.length} of ${projects.length} ${projects.length === 1 ? "job" : "jobs"}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            {canEdit && (
              <Button asChild>
                <Link to="/projects/new">
                  <Plus className="mr-2 h-4 w-4" /> New project
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <div role="group" aria-label="Show jobs that are" className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {GROUP_BUTTONS.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={prefs.group === g.value}
              onClick={() => remember({ group: g.value })}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                prefs.group === g.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
              )}
            >
              {g.label}
              <span className={cn("text-xs tabular-nums", prefs.group === g.value ? "opacity-80" : "text-muted-foreground")}>{counts[g.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, number or client…" aria-label="Search jobs" className="h-11 w-full sm:max-w-sm" />
          <select
            aria-label="Sort by"
            className="h-11 rounded-md border border-input bg-background px-3 text-sm"
            value={sortChoice(prefs)}
            onChange={(e) => {
              const c = SORT_CHOICES.find((x) => x.value === e.target.value);
              if (c) remember({ key: c.key, dir: c.dir });
            }}
          >
            {sortChoice(prefs) === "" && <option value="">Sorted by column</option>}
            {SORT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            My projects
          </label>
        </div>
        {error && <p className="text-sm text-destructive">Could not load projects: {errText(error)}</p>}
        {!isLoading && !error && shown.length === 0 && (
          <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {projects.length === 0 ? EMPTY_HINT.all : q.trim() || mine ? "No jobs match. Try another group or clear the search." : EMPTY_HINT[prefs.group]}
          </p>
        )}
        {shown.length > 0 && (
          <ProjectsTable rows={shown} staff={staff} canEdit={canEdit} onMove={setMoving} sort={{ key: prefs.key, dir: prefs.dir }} onSort={(s) => remember(s)} qboLinked={qboLinked} />
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
