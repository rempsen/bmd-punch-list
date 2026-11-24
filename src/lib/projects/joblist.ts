// Pure rules for the job list: the stage-group filter, the sidebar's open-jobs list, remembered choices and the export.
import type { PipelineProject, Staff } from "./data";
import type { SortKey } from "./pipeline";
import { STAGE_GROUPS, isOpenStage, stageGroup, stageLabel, type ProjectKind, type ProjectStage, type StageGroup } from "./stages";

export type JobGroup = StageGroup | "all";
export type ListPrefs = { group: JobGroup; key: SortKey; dir: "asc" | "desc" };
export const DEFAULT_PREFS: ListPrefs = { group: "open", key: "created_at", dir: "desc" };
/** Where this browser remembers the person's last filter and sort on the Projects page. */
export const LIST_PREFS_KEY = "bmd:projects:list";

const GROUPS: JobGroup[] = [...STAGE_GROUPS.map((g) => g.value), "all"];
const KEYS: SortKey[] = ["project_number", "name", "client_name", "stage", "bid_due_date", "estimated_value_cents", "created_at"];

export function parsePrefs(stored: string | null): ListPrefs {
  let v: unknown = null;
  try {
    v = stored ? JSON.parse(stored) : null;
  } catch {
    /* unreadable: start fresh */
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return DEFAULT_PREFS;
  const o = v as Record<string, unknown>;
  return {
    group: GROUPS.includes(o["group"] as JobGroup) ? (o["group"] as JobGroup) : DEFAULT_PREFS.group,
    key: KEYS.includes(o["key"] as SortKey) ? (o["key"] as SortKey) : DEFAULT_PREFS.key,
    dir: o["dir"] === "asc" || o["dir"] === "desc" ? o["dir"] : DEFAULT_PREFS.dir,
  };
}

export type SortChoice = "newest" | "number" | "name";
export const SORT_CHOICES: { value: SortChoice; label: string; key: SortKey; dir: "asc" | "desc" }[] = [
  { value: "newest", label: "Newest first", key: "created_at", dir: "desc" },
  { value: "number", label: "Job number", key: "project_number", dir: "asc" },
  { value: "name", label: "Name", key: "name", dir: "asc" },
];
/** Which of the three plain sorts is showing; "" when the person sorted by a table column instead. */
export const sortChoice = (s: { key: SortKey; dir: "asc" | "desc" }): SortChoice | "" => SORT_CHOICES.find((c) => c.key === s.key)?.value ?? "";

const isInternal = (p: { kind?: ProjectKind | null }) => p.kind === "internal";
/** Internal jobs are BMD's own time, so they stay out of the pipeline, its value totals and the estimates list. */
export const clientJobs = <T extends { kind?: ProjectKind | null }>(rows: T[]): T[] => rows.filter((p) => !isInternal(p));

export function filterJobs(rows: PipelineProject[], f: { group: JobGroup; text: string; mineId: string | null }): PipelineProject[] {
  const s = f.text.trim().toLowerCase();
  return rows.filter(
    (p) =>
      (f.group === "all" || stageGroup(p.stage) === f.group) &&
      (!s || `${p.project_number ?? ""} ${p.name} ${p.client_name ?? ""}`.toLowerCase().includes(s)) &&
      (!f.mineId || p.members.some((m) => m.user_id === f.mineId && m.job_roles.length > 0)),
  );
}

export function groupCounts(rows: { stage: ProjectStage }[]): Record<JobGroup, number> {
  const out: Record<JobGroup, number> = { presale: 0, open: 0, warranty: 0, closed: 0, all: rows.length };
  for (const p of rows) out[stageGroup(p.stage)] += 1;
  return out;
}

export type OpenJob = { id: string; name: string; project_number: string | null; stage: ProjectStage; kind: ProjectKind };

/** The sidebar list: open jobs only, internal ones first under their own heading, each by name. */
export function splitOpenJobs<T extends OpenJob>(rows: T[], text: string): { internal: T[]; jobs: T[] } {
  const s = text.trim().toLowerCase();
  const open = rows
    .filter((p) => isOpenStage(p.stage) && (!s || `${p.project_number ?? ""} ${p.name}`.toLowerCase().includes(s)))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { internal: open.filter(isInternal), jobs: open.filter((p) => !isInternal(p)) };
}

const groupLabel = (s: ProjectStage) => STAGE_GROUPS.find((g) => g.value === stageGroup(s))!.label;
const holder = (p: PipelineProject, staff: Staff[], role: "estimator" | "project_lead") => {
  const s = staff.find((x) => x.id === p.members.find((m) => m.job_roles.includes(role))?.user_id);
  return s ? s.full_name || s.email || "Unknown" : null;
};

/** Rows for the Projects export: a header, then one row per job as it is listed. Unknown values stay blank. */
export function jobsExportRows(rows: PipelineProject[], staff: Staff[], qboLinked: Set<string>): (string | number | null)[][] {
  return [
    ["No.", "Job", "Client", "Kind", "Group", "Stage", "Bid due", "Value", "Job type", "Estimator", "Project lead", "QuickBooks", "Created"],
    ...rows.map((p) => [
      p.project_number,
      p.name,
      p.client_name,
      isInternal(p) ? "Internal" : "Client",
      groupLabel(p.stage),
      stageLabel(p.stage),
      p.bid_due_date,
      p.estimated_value_cents == null ? null : p.estimated_value_cents / 100,
      p.job_type,
      holder(p, staff, "estimator"),
      holder(p, staff, "project_lead"),
      qboLinked.has(p.id) ? "Linked" : "",
      p.created_at.slice(0, 10),
    ]),
  ];
}
