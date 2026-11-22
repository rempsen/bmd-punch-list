/** One list of what has happened on a project, drawn from the records each part of the app already keeps. */
import { sectionLabel, type DocSection } from "@/lib/documents/logic";
import { money } from "@/lib/quotes/logic";
import type { StageEvent } from "./data";
import { stageLabel } from "./stages";

export type TimelineEntry = { id: string; at: string; kind: "stage" | "document" | "quote" | "bill"; text: string; by: string | null };
type Input = {
  stages: StageEvent[];
  documents: { id: string; file_name: string; section: DocSection; version: number; created_at: string; uploaded_by: string | null }[];
  quotes: { id: string; number: string; status: string; sent_at: string | null; accepted_at: string | null; accepted_value_cents: number | null; decision_note: string | null; recipients: string[] }[];
  bills: { id: string; number: string; kind: string; status: string; issued_at: string | null; total_cents: number }[];
};

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
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
