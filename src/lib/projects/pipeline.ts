import type { PipelineProject } from "./data";
import { STAGES, type ProjectStage } from "./stages";

export type DueWindow = "any" | "overdue" | "week" | "month";
export type Filters = { assignee: string; clientId: string; jobType: string; due: DueWindow; text: string };
export const NO_FILTERS: Filters = { assignee: "", clientId: "", jobType: "", due: "any", text: "" };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function applyFilters(rows: PipelineProject[], f: Filters, now: Date = new Date()): PipelineProject[] {
  const today = isoDay(now);
  const text = f.text.trim().toLowerCase();
  const until = f.due === "week" ? isoDay(addDays(now, 7)) : f.due === "month" ? isoDay(addDays(now, 30)) : null;
  return rows.filter((p) => {
    if (f.assignee && !p.members.some((m) => m.user_id === f.assignee && m.job_roles.length > 0)) return false;
    if (f.clientId && p.client_id !== f.clientId) return false;
    if (f.jobType && p.job_type !== f.jobType) return false;
    if (f.due === "overdue" && !(p.bid_due_date && p.bid_due_date < today)) return false;
    if (until && !(p.bid_due_date && p.bid_due_date >= today && p.bid_due_date <= until)) return false;
    if (text && !`${p.project_number ?? ""} ${p.name} ${p.client_name ?? ""}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

export type ColumnTotals = { count: number; valueCents: number; unvalued: number };

/** Per-stage count and value. Projects with no value yet are counted separately, never treated as zero dollars. */
export function columnSummary(rows: PipelineProject[]): Record<ProjectStage, ColumnTotals> {
  const out = Object.fromEntries(STAGES.map((s) => [s.value, { count: 0, valueCents: 0, unvalued: 0 }])) as Record<ProjectStage, ColumnTotals>;
  for (const p of rows) {
    const c = out[p.stage];
    c.count += 1;
    if (p.estimated_value_cents == null) c.unvalued += 1;
    else c.valueCents += p.estimated_value_cents;
  }
  return out;
}

const WIN_STAGES: ProjectStage[] = ["won", "in_progress", "closed"];

/** Wins against losses among projects decided in the last `days` days. */
export function winRate(rows: PipelineProject[], days: number, now: Date = new Date()): { won: number; lost: number; pct: number | null } {
  const since = addDays(now, -days).getTime();
  const recent = rows.filter((p) => new Date(p.stage_entered_at).getTime() >= since);
  const won = recent.filter((p) => WIN_STAGES.includes(p.stage)).length;
  const lost = recent.filter((p) => p.stage === "lost").length;
  return { won, lost, pct: won + lost === 0 ? null : Math.round((won / (won + lost)) * 100) };
}

export type SortKey = "project_number" | "name" | "client_name" | "stage" | "bid_due_date" | "estimated_value_cents";

export function sortProjects(rows: PipelineProject[], key: SortKey, dir: "asc" | "desc"): PipelineProject[] {
  const order = (s: ProjectStage) => STAGES.findIndex((x) => x.value === s);
  const val = (p: PipelineProject): string | number | null =>
    key === "stage" ? order(p.stage) : key === "estimated_value_cents" ? p.estimated_value_cents : (p[key]?.toLowerCase() ?? null);
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // blanks last either way
    const c = x < y ? -1 : x > y ? 1 : 0;
    return dir === "asc" ? c : -c;
  });
}

export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
