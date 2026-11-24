// Pure rules for Inspections & Sign-off.
import { scopeLabel } from "@/lib/job-wizard";
import type { ProgressStatus } from "@/lib/installation/logic";

export type InspectionKind = "walkthrough" | "deficiency_review" | "final";
export type Outcome = "pending" | "passed" | "passed_with_items" | "failed";
export type ItemResult = "ok" | "deficient" | "not_inspected";
export type SignMethod = "in_app" | "emailed_link" | "on_paper";

export const KIND_LABEL: Record<InspectionKind, string> = { walkthrough: "Walkthrough", deficiency_review: "Deficiency review", final: "Final inspection" };
export const OUTCOME_LABEL: Record<Outcome, string> = { pending: "Pending", passed: "Passed", passed_with_items: "Passed with items", failed: "Failed" };
export const RESULT_LABEL: Record<ItemResult, string> = { ok: "OK", deficient: "Deficient", not_inspected: "Not inspected" };
export const METHOD_LABEL: Record<SignMethod, string> = { in_app: "Signed in the app", emailed_link: "Signed by emailed link", on_paper: "Signed on paper" };

export const LINK_DAYS = 14;

type ChecklistRoom = { id: string; name: string; floorLabel: string; status: Record<string, ProgressStatus | undefined> };

/** One item per room × scope that is required (not marked Not required), in the given room order. */
export function buildChecklist(rooms: ChecklistRoom[], scopes: string[]) {
  const out: { room_id: string; scope: string; description: string; sort: number }[] = [];
  for (const r of rooms)
    for (const s of scopes) {
      if (r.status[s] === "not_required") continue;
      out.push({ room_id: r.id, scope: s, description: `${r.floorLabel} · ${r.name} — ${scopeLabel(s)}`, sort: out.length });
    }
  return out;
}

/** The outcome a closed inspection gets, unless the user marks it failed. */
export function deriveOutcome(items: { result: ItemResult; deficiency_id: string | null }[], markFailed = false): Outcome {
  if (markFailed) return "failed";
  const deficient = items.filter((i) => i.result === "deficient");
  if (!deficient.length) return "passed";
  return deficient.every((i) => i.deficiency_id) ? "passed_with_items" : "failed";
}

/** Why closing is not possible yet, or null. */
export function closeBlock(items: { result: ItemResult; deficiency_id: string | null }[], markFailed: boolean): string | null {
  if (markFailed) return null;
  const missing = items.filter((i) => i.result === "deficient" && !i.deficiency_id).length;
  return missing ? `${missing} deficient item${missing === 1 ? " has" : "s have"} no deficiency yet. Create them, or close as failed.` : null;
}

/** Whether a sign-off can be recorded: the latest closed inspection must have passed. */
export function signoffEligibility(inspections: { outcome: Outcome; held_at: string | null; created_at: string }[]): { ok: true } | { ok: false; reason: string } {
  const closed = inspections.filter((i) => i.held_at).sort((a, b) => (a.held_at! < b.held_at! ? 1 : -1));
  const latest = closed[0];
  if (!latest) return { ok: false, reason: "Close an inspection first — sign-off needs a passed inspection." };
  if (latest.outcome === "passed" || latest.outcome === "passed_with_items") return { ok: true };
  return { ok: false, reason: `The latest inspection ${latest.outcome === "failed" ? "failed" : "is not passed"}. Hold another inspection that passes before sign-off.` };
}

/** An emailed link's state. */
export function linkState(s: { signed_at: string | null; link_expires_at: string | null }, now = new Date()): "signed" | "open" | "expired" {
  if (s.signed_at) return "signed";
  return s.link_expires_at && new Date(s.link_expires_at) > now ? "open" : "expired";
}
