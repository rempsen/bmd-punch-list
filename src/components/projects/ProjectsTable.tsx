import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDown, ArrowRightLeft, ArrowUp, Hammer } from "lucide-react";
import { StageBadge } from "@/components/projects/StageBadge";
import { Button } from "@/components/ui/button";
import { holderOf, money, shortDate, staffName, type PipelineProject, type Staff } from "@/lib/projects/data";
import { sortProjects, type SortKey } from "@/lib/projects/pipeline";
import { daysInStage, isOverdue } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "project_number", label: "No." },
  { key: "name", label: "Project" },
  { key: "stage", label: "Stage" },
  { key: "bid_due_date", label: "Bid due" },
  { key: "estimated_value_cents", label: "Value" },
];

export function ProjectsTable({
  rows,
  staff,
  canEdit,
  onMove,
}: {
  rows: PipelineProject[];
  staff: Staff[];
  canEdit: boolean;
  onMove: (p: PipelineProject) => void;
}) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "project_number", dir: "desc" });
  const sorted = sortProjects(rows, sort.key, sort.dir);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-4 py-1 font-medium" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggle(c.key)} className="inline-flex min-h-9 items-center gap-1 uppercase tracking-wide hover:text-foreground">
                  {c.label}
                  {sort.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </th>
            ))}
            <th className="px-4 py-2.5 font-medium">Estimator</th>
            <th className="px-4 py-2.5 font-medium">Lead</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((p) => {
            const needsSite = (p.stage === "won" || p.stage === "in_progress") && p.floorCount === 0;
            return (
              <tr key={p.id} className="align-middle hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{p.project_number ?? "—"}</td>
                <td className="px-4 py-3">
                  <Link to="/projects/$id" params={{ id: p.id }} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{p.client_name ?? "No client"}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StageBadge stage={p.stage} />
                  <div className="mt-0.5 text-xs text-muted-foreground">{daysInStage(p.stage_entered_at)} d</div>
                </td>
                <td className={cn("whitespace-nowrap px-4 py-3", isOverdue(p.bid_due_date, p.stage) && "font-semibold text-destructive")}>
                  {shortDate(p.bid_due_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(p.estimated_value_cents)}</td>
                <td className="px-4 py-3">{staffName(staff, holderOf(p, "estimator")) ?? "—"}</td>
                <td className="px-4 py-3">{staffName(staff, holderOf(p, "project_lead")) ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {canEdit && needsSite && (
                    <Button size="sm" variant="outline" className="mr-2" onClick={() => void navigate({ to: "/new-job", search: { project: p.id } })}>
                      <Hammer className="mr-1.5 h-4 w-4" /> Set up site
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => onMove(p)}>
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
  );
}
