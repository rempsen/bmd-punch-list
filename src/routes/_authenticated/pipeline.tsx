import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRightLeft, Download, KanbanSquare, List, Plus } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { MoveStageDialog } from "@/components/projects/MoveStageDialog";
import { ProjectsTable } from "@/components/projects/ProjectsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useClients } from "@/lib/clients/data";
import { errText } from "@/lib/platform/db";
import {
  holderOf,
  initials,
  money,
  shortDate,
  staffName,
  useBmdStaff,
  usePipelineProjects,
  useRefreshPipeline,
  type PipelineProject,
  type Staff,
} from "@/lib/projects/data";
import { NO_FILTERS, applyFilters, columnSummary, toCsv, winRate, type DueWindow, type Filters } from "@/lib/projects/pipeline";
import { JOB_TYPES, STAGES, daysInStage, isOverdue, stageLabel, type ProjectStage } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline — BMD Projects" }] }),
  component: PipelinePage,
});

const selectCls = "h-11 rounded-md border border-input bg-background px-3 text-sm";

function PipelinePage() {
  const { canAny, user } = useAuth();
  const canSee = canAny("view_pipeline");
  const canEdit = canAny("manage_projects");
  const { data: projects = [], isLoading, error } = usePipelineProjects();
  const { data: staff = [] } = useBmdStaff();
  const { data: clients = [] } = useClients();
  const refresh = useRefreshPipeline();
  const [view, setView] = useState<"board" | "list">("board");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [period, setPeriod] = useState(90);
  const [move, setMove] = useState<{ project: PipelineProject; to?: ProjectStage } | null>(null);
  const setF = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const shown = useMemo(() => applyFilters(projects, filters), [projects, filters]);
  const summary = useMemo(() => columnSummary(shown), [shown]);
  const rate = useMemo(() => winRate(shown, period), [shown, period]);
  const clientsInUse = useMemo(() => clients.filter((c) => projects.some((p) => p.client_id === c.id)), [clients, projects]);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  if (!canSee) return <p className="p-6 text-sm text-muted-foreground">You don't have access to the pipeline.</p>;

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      ["No.", "Project", "Client", "Stage", "Days in stage", "Bid due", "Value", "Job type", "Estimator", "Project lead", "Lost reason"],
      ...shown.map((p) => [
        p.project_number,
        p.name,
        p.client_name,
        stageLabel(p.stage),
        daysInStage(p.stage_entered_at),
        p.bid_due_date,
        p.estimated_value_cents == null ? null : p.estimated_value_cents / 100,
        p.job_type,
        staffName(staff, holderOf(p, "estimator")),
        staffName(staff, holderOf(p, "project_lead")),
        p.lost_reason,
      ]),
    ];
    const url = URL.createObjectURL(new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `bmd-pipeline-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Pipeline"
        subtitle={`${shown.length} of ${projects.length} projects`}
        actions={
          <div className="flex gap-2">
            <div className="flex rounded-md border border-border" role="group" aria-label="View">
              <ViewButton on={view === "board"} onClick={() => setView("board")} icon={KanbanSquare} label="Board" />
              <ViewButton on={view === "list"} onClick={() => setView("list")} icon={List} label="List" />
            </div>
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
        <div className="flex flex-wrap items-center gap-2">
          <Input value={filters.text} onChange={(e) => setF({ text: e.target.value })} placeholder="Search…" className="h-11 w-full sm:w-52" />
          <select aria-label="Assigned to" className={selectCls} value={filters.assignee} onChange={(e) => setF({ assignee: e.target.value })}>
            <option value="">Anyone</option>
            {user && <option value={user.id}>My projects</option>}
            {staff.filter((s) => s.id !== user?.id).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name || s.email}
              </option>
            ))}
          </select>
          <select aria-label="Client" className={cn(selectCls, "max-w-52")} value={filters.clientId} onChange={(e) => setF({ clientId: e.target.value })}>
            <option value="">All clients</option>
            {clientsInUse.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="Job type" className={selectCls} value={filters.jobType} onChange={(e) => setF({ jobType: e.target.value })}>
            <option value="">All job types</option>
            {JOB_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select aria-label="Bid due" className={selectCls} value={filters.due} onChange={(e) => setF({ due: e.target.value as DueWindow })}>
            <option value="any">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="week">Due in 7 days</option>
            <option value="month">Due in 30 days</option>
          </select>
          {filtered && (
            <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
              Clear
            </Button>
          )}
          {view === "list" && (
            <Button variant="outline" className="ml-auto" onClick={exportCsv} disabled={shown.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
          <span>
            <span className="text-muted-foreground">Open bids </span>
            <strong>{summary.opportunity.count + summary.estimating.count + summary.quote_out.count}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Quoted value out </span>
            <strong>{money(summary.quote_out.valueCents)}</strong>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Win rate</span>
            <strong>{rate.pct == null ? "—" : `${rate.pct}%`}</strong>
            <span className="text-xs text-muted-foreground">
              ({rate.won} won, {rate.lost} lost)
            </span>
            <select aria-label="Win rate period" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>12 months</option>
            </select>
          </span>
        </div>

        {error && <p className="text-sm text-destructive">Could not load the pipeline: {errText(error)}</p>}
        {!isLoading && !error && projects.length === 0 && (
          <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No projects yet. Start one with New project.
          </p>
        )}
        {view === "board" ? (
          <Board rows={shown} staff={staff} summary={summary} canEdit={canEdit} onMove={(project, to) => setMove(to ? { project, to } : { project })} />
        ) : (
          shown.length > 0 && <ProjectsTable rows={shown} staff={staff} canEdit={canEdit} onMove={(project) => setMove({ project })} />
        )}
      </div>
      {move && (
        <MoveStageDialog
          project={move.project}
          {...(move.to ? { to: move.to } : {})}
          onClose={() => setMove(null)}
          onMoved={() => {
            refresh();
            setMove(null);
          }}
        />
      )}
    </div>
  );
}

function ViewButton({ on, onClick, icon: Icon, label }: { on: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex h-10 items-center gap-1.5 px-3 text-sm first:rounded-l-md last:rounded-r-md", on ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
    >
      <Icon className="h-4 w-4" /> <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Board({
  rows,
  staff,
  summary,
  canEdit,
  onMove,
}: {
  rows: PipelineProject[];
  staff: Staff[];
  summary: ReturnType<typeof columnSummary>;
  canEdit: boolean;
  onMove: (p: PipelineProject, to?: ProjectStage) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<ProjectStage | null>(null);

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      {STAGES.map((s) => {
        const cards = rows.filter((p) => p.stage === s.value);
        const t = summary[s.value];
        return (
          <section
            key={s.value}
            aria-label={s.label}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOver(s.value);
            }}
            onDragLeave={() => setOver((o) => (o === s.value ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const p = rows.find((r) => r.id === dragId);
              setDragId(null);
              setOver(null);
              if (p && p.stage !== s.value) onMove(p, s.value);
            }}
            className={cn(
              "flex w-[272px] shrink-0 snap-start flex-col rounded-lg border bg-muted/40 transition-colors",
              over === s.value ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <header className="border-b border-border px-3 py-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{s.label}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">{t.count}</span>
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {t.count === 0 ? " " : t.unvalued === t.count ? "No values yet" : `${money(t.valueCents)}${t.unvalued ? ` · ${t.unvalued} unpriced` : ""}`}
              </p>
            </header>
            <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2">
              {cards.map((p) => (
                <Card key={p.id} p={p} staff={staff} canEdit={canEdit} dragging={dragId === p.id} onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)} onMove={() => onMove(p)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Card({
  p,
  staff,
  canEdit,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  p: PipelineProject;
  staff: Staff[];
  canEdit: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: () => void;
}) {
  const overdue = isOverdue(p.bid_due_date, p.stage);
  const people = p.members.filter((m) => m.job_roles.length > 0);
  return (
    <li
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", p.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn("rounded-md border border-border bg-card p-3 shadow-sm", canEdit && "cursor-grab active:cursor-grabbing", dragging && "opacity-50")}
    >
      <Link to="/projects/$id" params={{ id: p.id }} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <p className="font-mono text-[11px] text-muted-foreground">{p.project_number}</p>
        <p className="text-sm font-medium leading-snug hover:underline">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">{p.client_name ?? "No client"}</p>
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={cn(overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {p.bid_due_date ? `${overdue ? "Overdue " : "Due "}${shortDate(p.bid_due_date)}` : "No due date"}
        </span>
        {p.estimated_value_cents != null && <span className="font-medium tabular-nums">{money(p.estimated_value_cents)}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          Since {shortDate(p.stage_entered_at)} · {daysInStage(p.stage_entered_at)} d
        </span>
        <span className="flex items-center gap-1">
          {people.map((m) => {
            const name = staffName(staff, m.user_id);
            return (
              <span key={m.user_id} title={name ?? undefined} className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                {initials(name)}
              </span>
            );
          })}
          {canEdit && (
            <button
              type="button"
              onClick={onMove}
              aria-label={`Move ${p.name}`}
              className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
