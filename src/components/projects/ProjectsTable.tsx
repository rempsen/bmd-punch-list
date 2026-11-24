import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDown, ArrowRightLeft, ArrowUp, Hammer } from "lucide-react";
import { OpenBookValue, useOpenBookValue } from "@/components/billing/ContractType";
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

export type TableSort = { key: SortKey; dir: "asc" | "desc" };

/** Small labels beside a job's name: Internal for BMD's own time, QuickBooks when the job is linked there. */
export function JobBadges({ p, qboLinked }: { p: PipelineProject; qboLinked?: Set<string> | undefined }) {
  return (
    <>
      {p.kind === "internal" && <span className="ml-2 inline-flex rounded-full bg-slate-200 px-2 py-0.5 align-middle text-[11px] font-medium text-slate-800">Internal</span>}
      {qboLinked?.has(p.id) && (
        <span title="Linked to QuickBooks" className="ml-2 inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 align-middle text-[11px] font-medium text-emerald-900">
          QuickBooks
        </span>
      )}
    </>
  );
}

export function ProjectsTable({
  rows,
  staff,
  canEdit,
  onMove,
  sort: sortProp,
  onSort,
  qboLinked,
}: {
  rows: PipelineProject[];
  staff: Staff[];
  canEdit: boolean;
  onMove: (p: PipelineProject) => void;
  /** When given, the page owns the sort (so it can remember it); otherwise the table keeps its own. */
  sort?: TableSort | undefined;
  onSort?: ((s: TableSort) => void) | undefined;
  qboLinked?: Set<string> | undefined;
}) {
  const navigate = useNavigate();
  const [own, setOwn] = useState<TableSort>({ key: "project_number", dir: "desc" });
  const sort = sortProp ?? own;
  const openBook = useOpenBookValue();
  const sorted = sortProjects(rows, sort.key, sort.dir);
  const toggle = (key: SortKey) => {
    const next: TableSort = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
    if (onSort) onSort(next);
    else setOwn(next);
  };

  return (
    <>
    {/* Phone: one card per job. */}
    <ul className="space-y-2 md:hidden">
      {sorted.map((p) => (
        <li key={p.id} className="rounded-lg border border-border bg-card">
          <Link to="/projects/$id" params={{ id: p.id }} className="block min-h-11 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {p.name}
                  <JobBadges p={p} qboLinked={qboLinked} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {[p.project_number, p.kind === "internal" ? null : (p.client_name ?? "No client")].filter(Boolean).join(" · ")}
                </p>
              </div>
              <StageBadge stage={p.stage} className="shrink-0" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
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
            const needsSite = p.kind !== "internal" && (p.stage === "won" || p.stage === "in_progress") && p.floorCount === 0;
            return (
              <tr key={p.id} className="align-middle hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{p.project_number ?? "—"}</td>
                <td className="px-4 py-3">
                  <Link to="/projects/$id" params={{ id: p.id }} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <JobBadges p={p} qboLinked={qboLinked} />
                  <div className="text-xs text-muted-foreground">{p.kind === "internal" ? "BMD internal" : (p.client_name ?? "No client")}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StageBadge stage={p.stage} />
                  <div className="mt-0.5 text-xs text-muted-foreground">{daysInStage(p.stage_entered_at)} d</div>
                </td>
                <td className={cn("whitespace-nowrap px-4 py-3", isOverdue(p.bid_due_date, p.stage) && "font-semibold text-destructive")}>
                  {shortDate(p.bid_due_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{openBook(p.id) ? <OpenBookValue billedCents={openBook(p.id)!.billedCents} /> : money(p.estimated_value_cents)}</td>
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
    </>
  );
}
