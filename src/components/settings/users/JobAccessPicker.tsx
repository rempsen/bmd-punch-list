import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ROLES, roleLabel, type AppRole } from "@/lib/roles";
import { levelsFor, type JobPick } from "@/lib/users/logic";
import { cn } from "@/lib/utils";
import type { JobOption } from "./data";

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/**
 * Job access: all jobs, or a chosen list. Each job follows the company level unless a different role is picked for it.
 * With all jobs, only the jobs that differ are kept as picks.
 */
export function JobAccessPicker({
  level,
  allJobs,
  onAllJobs,
  picks,
  onPicks,
  jobs,
  actorIsSuper,
  disabled,
}: {
  level: AppRole;
  allJobs: boolean;
  onAllJobs: (v: boolean) => void;
  picks: JobPick[];
  onPicks: (p: JobPick[]) => void;
  jobs: JobOption[];
  actorIsSuper: boolean;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const byId = useMemo(() => new Map(picks.map((p) => [p.projectId, p])), [picks]);
  const shown = jobs.filter((j) => (showArchived || !j.archived_at || byId.has(j.id)) && j.name.toLowerCase().includes(q.trim().toLowerCase()));
  const roles = levelsFor(actorIsSuper).filter((r) => r !== "super_admin");
  if (level === "super_admin") return <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">Super admins can open every job.</p>;

  const toggle = (id: string, on: boolean) => onPicks(on ? [...picks, { projectId: id, role: null }] : picks.filter((p) => p.projectId !== id));
  const setRole = (id: string, role: AppRole | null) => {
    const next = picks.filter((p) => p.projectId !== id);
    // With all jobs, a job that follows the level needs no entry at all.
    if (!(allJobs && role === null)) next.push({ projectId: id, role });
    onPicks(next);
  };

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Job access" className="grid grid-cols-2 gap-2">
        {([[true, "All jobs", "Every job, including new ones"], [false, "Selected jobs", "Only the jobs you pick"]] as const).map(([v, label, hint]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={allJobs === v}
            disabled={disabled}
            onClick={() => {
              onAllJobs(v);
              // Switching to all jobs keeps only the jobs with a different role.
              if (v) onPicks(picks.filter((p) => p.role !== null));
            }}
            className={cn("min-h-14 rounded-lg border p-3 text-left", allJobs === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")}
          >
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="h-9 pl-8" placeholder="Find a job" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a job" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} /> Show archived
          </label>
        </div>
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          {allJobs ? `${roleLabel(level)} on every job. Pick a different role only where it should differ.` : `Tick the jobs. Each one uses ${roleLabel(level)} unless you choose otherwise.`}
        </p>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">No jobs match.</li>}
          {shown.map((j) => {
            const pick = byId.get(j.id);
            const on = allJobs || !!pick;
            return (
              <li key={j.id} className="flex min-h-12 flex-wrap items-center gap-3 px-3 py-1.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  {!allJobs && <Checkbox checked={on} disabled={disabled} onCheckedChange={(v) => toggle(j.id, v === true)} aria-label={`Access to ${j.name}`} />}
                  <span className="min-w-0 truncate text-sm">
                    {j.name}
                    {j.archived_at && <span className="ml-1 text-xs text-muted-foreground">(archived)</span>}
                  </span>
                </label>
                {on && (
                  <select
                    className={selectCls}
                    aria-label={`Role on ${j.name}`}
                    disabled={disabled}
                    value={pick?.role ?? ""}
                    onChange={(e) => setRole(j.id, (e.target.value || null) as AppRole | null)}
                  >
                    <option value="">Company level ({roleLabel(level)})</option>
                    {roles
                      .filter((r) => r !== level)
                      .map((r) => (
                        <option key={r} value={r}>
                          {ROLES.find((x) => x.value === r)?.label}
                        </option>
                      ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
