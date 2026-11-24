/** One list of what has happened on a project, drawn from the records each part of the app already keeps. */
import { sectionLabel, type DocSection } from "@/lib/documents/logic";
import { money } from "@/lib/quotes/logic";
import type { StageEvent } from "./data";
import { stageLabel } from "./stages";

export type TimelineEntry = { id: string; at: string; kind: "stage" | "document" | "quote" | "bill" | "visit" | "inspection" | "signoff"; text: string; by: string | null };
type Input = {
  stages: StageEvent[];
  documents: { id: string; file_name: string; section: DocSection; version: number; created_at: string; uploaded_by: string | null }[];
  quotes: { id: string; number: string; status: string; sent_at: string | null; accepted_at: string | null; accepted_value_cents: number | null; decision_note: string | null; recipients: string[] }[];
  bills: { id: string; number: string; kind: string; status: string; issued_at: string | null; total_cents: number }[];
  visits?: { id: string; note: string; at: string; source: string }[];
  inspections?: { id: string; kind: string; held_at: string | null; held_by: string | null; outcome: string }[];
  signoffs?: { id: string; signed_by_name: string; signed_at: string | null; method: string; recorded_by: string | null; holdback_released_at: string | null }[];
};

const INSPECTION_KIND: Record<string, string> = { walkthrough: "Walkthrough", deficiency_review: "Deficiency review", final: "Final inspection" };
const OUTCOME: Record<string, string> = { passed: "passed", passed_with_items: "passed with items", failed: "failed", pending: "pending" };
const SIGN_METHOD: Record<string, string> = { in_app: "in the app", emailed_link: "by emailed link", on_paper: "on paper" };

/** Where a visit entry came from, when that is worth saying: ArrivePing reported it, or BMD sent it to ArrivePing. */
const VISIT_SOURCE_SUFFIX: Record<string, string> = { arriveping: " · reported by ArrivePing", sync: " · sent to ArrivePing" };

/** Newest first. Without pricing access, amounts are left out and bills are not listed at all. */
export function buildTimeline(input: Input, opts: { showPrices: boolean }): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of input.stages) out.push({ id: `s-${e.id}`, at: e.changed_at, kind: "stage", by: e.changed_by, text: `${e.from_stage ? `Moved from ${stageLabel(e.from_stage)} to ${stageLabel(e.to_stage)}` : `Created in ${stageLabel(e.to_stage)}`}${e.note ? `. ${e.note}` : ""}` });
  for (const d of input.documents) out.push({ id: `d-${d.id}`, at: d.created_at, kind: "document", by: d.uploaded_by, text: `${d.file_name} added to ${sectionLabel(d.section)}${d.version > 1 ? ` (version ${d.version})` : ""}` });
  for (const q of input.quotes) {
    if (q.sent_at) out.push({ id: `qs-${q.id}`, at: q.sent_at, kind: "quote", by: null, text: `Quote ${q.number} sent${q.recipients.length ? ` to ${q.recipients.join(", ")}` : ""}` });
    if (q.status === "accepted" && q.accepted_at) out.push({ id: `qa-${q.id}`, at: q.accepted_at, kind: "quote", by: null, text: `Quote ${q.number} accepted${opts.showPrices && q.accepted_value_cents != null ? ` at $${money(q.accepted_value_cents)} before GST` : ""}${q.decision_note ? `. ${q.decision_note}` : ""}` });
  }
  if (opts.showPrices) for (const b of input.bills) if (b.status === "issued" && b.issued_at) out.push({ id: `b-${b.id}`, at: b.issued_at, kind: "bill", by: null, text: `${b.kind === "holdback_release" ? "Holdback release" : "Bill"} ${b.number} issued for $${money(b.total_cents)}` });
  for (const v of input.visits ?? []) out.push({ id: `v-${v.id}`, at: v.at, kind: "visit", by: null, text: `${v.note}${Object.hasOwn(VISIT_SOURCE_SUFFIX, v.source) ? VISIT_SOURCE_SUFFIX[v.source] : ""}` });
  for (const i of input.inspections ?? []) if (i.held_at) out.push({ id: `i-${i.id}`, at: i.held_at, kind: "inspection", by: i.held_by, text: `${INSPECTION_KIND[i.kind] ?? "Inspection"} closed: ${OUTCOME[i.outcome] ?? i.outcome}` });
  for (const s of input.signoffs ?? []) {
    if (s.signed_at) out.push({ id: `so-${s.id}`, at: s.signed_at, kind: "signoff", by: s.method === "emailed_link" ? null : s.recorded_by, text: `Sign-off recorded: ${s.signed_by_name} signed ${SIGN_METHOD[s.method] ?? ""}`.trim() });
    if (s.holdback_released_at) out.push({ id: `sh-${s.id}`, at: s.holdback_released_at, kind: "signoff", by: null, text: "Holdback released on sign-off (draft bill created)" });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
