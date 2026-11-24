export type ProjectStage = "opportunity" | "estimating" | "quote_out" | "won" | "in_progress" | "warranty" | "closed" | "lost";
/** A client job is work for a customer; an internal job holds BMD's own time (shop, quoting, equipment repairs). */
export type ProjectKind = "client" | "internal";
export type LostReason = "price" | "scope" | "timing" | "no_decision" | "other";
export type JobRole = "estimator" | "project_lead" | "site_lead" | "other";

export const STAGES: { value: ProjectStage; label: string }[] = [
  { value: "opportunity", label: "Opportunity" },
  { value: "estimating", label: "Estimating" },
  { value: "quote_out", label: "Quote out" },
  { value: "won", label: "Won" },
  { value: "in_progress", label: "In progress" },
  { value: "warranty", label: "Warranty" },
  { value: "closed", label: "Closed" },
  { value: "lost", label: "Lost" },
];

/** The four plain groups the job list is filtered by. */
export type StageGroup = "presale" | "open" | "warranty" | "closed";
export const STAGE_GROUPS: { value: StageGroup; label: string; stages: ProjectStage[] }[] = [
  { value: "presale", label: "Presale", stages: ["opportunity", "estimating", "quote_out"] },
  { value: "open", label: "Open", stages: ["won", "in_progress"] },
  { value: "warranty", label: "Warranty", stages: ["warranty"] },
  { value: "closed", label: "Closed", stages: ["closed", "lost"] },
];
export const stageGroup = (s: ProjectStage): StageGroup => STAGE_GROUPS.find((g) => g.stages.includes(s))?.value ?? "closed";
/** Open work is a job that is won or under way. A job in Warranty is finished work and is not counted as open. */
export const isOpenStage = (s: ProjectStage): boolean => stageGroup(s) === "open";

export const LOST_REASONS: { value: LostReason; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "scope", label: "Scope" },
  { value: "timing", label: "Timing" },
  { value: "no_decision", label: "No decision" },
  { value: "other", label: "Other" },
];

export const JOB_ROLES: { value: JobRole; label: string }[] = [
  { value: "estimator", label: "Estimator" },
  { value: "project_lead", label: "Project lead" },
  { value: "site_lead", label: "Site lead" },
  { value: "other", label: "Other" },
];

export const JOB_TYPES = ["Hotel", "Multi-family", "Office", "Retail", "Healthcare", "Education", "Other"];

export const stageLabel = (s: ProjectStage) => STAGES.find((x) => x.value === s)?.label ?? s;

/** Mirrors the database rule: a lost project must carry one of the listed reasons. */
export function validateMove(to: ProjectStage, reason: string | null | undefined): string | null {
  if (to === "lost" && !LOST_REASONS.some((r) => r.value === reason)) return "Choose a reason for marking this project lost";
  return null;
}

export function formatProjectNumber(year: number, seq: number): string {
  return `${String(year % 100).padStart(2, "0")}-${String(seq).padStart(3, "0")}`;
}

export function daysInStage(enteredAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(enteredAt).getTime()) / 86_400_000));
}

const BID_OPEN: ProjectStage[] = ["opportunity", "estimating"];

/** A bid is overdue when its due date has passed and the quote has not gone out yet. */
export function isOverdue(bidDue: string | null, stage: ProjectStage, now: Date = new Date()): boolean {
  if (!bidDue || !BID_OPEN.includes(stage)) return false;
  return bidDue < now.toISOString().slice(0, 10);
}
