// Pure rules for Installation Progress: per-room, per-scope status, readiness and the ArrivePing pre-fill.
import { scopeLabel } from "@/lib/job-wizard";

export const PROGRESS_STATUSES = ["not_started", "in_progress", "complete", "not_required"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export const isProgressStatus = (v: unknown): v is ProgressStatus =>
  typeof v === "string" && (PROGRESS_STATUSES as readonly string[]).includes(v);
export const PROGRESS_LABEL: Record<ProgressStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  not_required: "Not required",
};

export const BLOCKER_KINDS = ["material", "access", "prep", "other"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];
export const BLOCKER_LABEL: Record<BlockerKind, string> = {
  material: "Material",
  access: "Access",
  prep: "Prep",
  other: "Other",
};

/** Estimate categories that are consumables or prep, not something a crew "installs" in a room. */
const NOT_INSTALL = new Set(["adhesive", "underlay", "prep", "other"]);

/** The job's scopes: wizard scopes first, then install categories from the estimate, then flooring. */
export function jobScopes(wizard: string[], estimateCategories: string[]): string[] {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const w = uniq(wizard);
  if (w.length) return w;
  const e = uniq(estimateCategories.filter((c) => !NOT_INSTALL.has(c)));
  return e.length ? e : ["flooring"];
}

/** Which job scope a visit's free-text scope means. Null when it can't be told. */
export function scopeForVisit(visitScope: string | null | undefined, scopes: string[]): string | null {
  const s = (visitScope ?? "").trim().toLowerCase();
  if (s) {
    const exact = scopes.find((k) => k === s || scopeLabel(k).toLowerCase() === s);
    if (exact) return exact;
    const loose = scopes.find(
      (k) => s.includes(scopeLabel(k).toLowerCase()) || s.includes(k.replace(/_/g, " ")),
    );
    if (loose) return loose;
  }
  return scopes.length === 1 ? scopes[0]! : null;
}

export type ArrivePingIncoming = "in_progress" | "complete";

/** What ArrivePing's news does to a room×scope: the new status, or null to leave it. Never downgrades, never touches complete / not required. */
export function mergeArrivePingStatus(
  current: ProgressStatus | null | undefined,
  incoming: ArrivePingIncoming,
): ProgressStatus | null {
  const cur = current ?? "not_started";
  if (cur === "complete" || cur === "not_required") return null;
  if (incoming === "complete") return "complete";
  return cur === "not_started" ? "in_progress" : null;
}

/** The ArrivePing visit status that moves rooms, if any. */
export function incomingFromVisit(status: string | null | undefined): ArrivePingIncoming | null {
  if (status === "completed") return "complete";
  if (status === "en_route" || status === "arrived" || status === "in_progress") return "in_progress";
  return null;
}

export type Readiness = "blocked" | "installed" | "in_progress" | "not_ready";
export const READINESS_LABEL: Record<Readiness, string> = {
  blocked: "Blocked",
  installed: "Installed",
  in_progress: "In progress",
  not_ready: "Not ready",
};

export type RoomProgress = {
  scopes: string[];
  status: Record<string, ProgressStatus | undefined>;
  blockers: { scope: string; text: string | null; kind: BlockerKind | null }[];
  /** The job has material not yet on site. */
  awaitingMaterial: boolean;
};

export type RoomReadiness = {
  state: Readiness;
  blocker: { text: string; kind: BlockerKind | null; auto: boolean } | null;
};

export function readiness(room: RoomProgress): RoomReadiness {
  const st = (s: string) => room.status[s] ?? "not_started";
  const required = room.scopes.filter((s) => st(s) !== "not_required");
  const allDone = required.every((s) => st(s) === "complete");
  const stored = room.blockers.find((b) => b.text?.trim() || b.kind);
  if (stored)
    return {
      state: "blocked",
      blocker: { text: stored.text?.trim() || BLOCKER_LABEL[stored.kind ?? "other"], kind: stored.kind, auto: false },
    };
  if (room.awaitingMaterial && !allDone)
    return { state: "blocked", blocker: { text: "Awaiting material", kind: "material", auto: true } };
  if (allDone) return { state: "installed", blocker: null };
  if (required.some((s) => st(s) === "in_progress")) return { state: "in_progress", blocker: null };
  return { state: "not_ready", blocker: null };
}

/** The three tiles: Ready to install = nothing blocking and not started; In progress; Blocked. */
export function tileCounts(states: Readiness[]) {
  return {
    ready: states.filter((s) => s === "not_ready").length,
    inProgress: states.filter((s) => s === "in_progress").length,
    blocked: states.filter((s) => s === "blocked").length,
  };
}
