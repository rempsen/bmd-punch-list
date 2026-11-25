import { describe, expect, test } from "bun:test";
import { buildTimeline } from "./timeline";

describe("project activity", () => {
  test("draft saves, issue and void are bill Activity events, not stage moves", () => {
    const stages = ["Draft saved", "Issued", "Voided"].map((action, i) => ({ id: String(i), from_stage: "won" as const, to_stage: "won" as const, changed_by: "u1", changed_at: `2026-11-25T00:0${i}:00Z`, note: `B01 · ${action}` }));
    const input = { stages, documents: [], quotes: [], bills: [] };
    expect(buildTimeline(input, { showPrices: true }).map(e => e.kind)).toEqual(["bill", "bill", "bill"]);
    expect(buildTimeline(input, { showPrices: false })).toEqual([]);
  });
  test("stage moves, documents, quotes and bills in one list, newest first, with no prices for people who may not see them", () => {
    const input = {
      stages: [{ id: "e1", from_stage: null, to_stage: "opportunity" as const, changed_by: "u1", changed_at: "2026-11-01T15:00:00Z", note: null }, { id: "e2", from_stage: "estimating" as const, to_stage: "quote_out" as const, changed_by: "u1", changed_at: "2026-11-10T15:00:00Z", note: "Quote Q-26-041-R0 sent" }],
      documents: [{ id: "d1", file_name: "Plans.pdf", section: "plans" as const, version: 2, created_at: "2026-11-05T15:00:00Z", uploaded_by: "u2" }],
      quotes: [{ id: "q1", number: "Q-26-041-R0", status: "accepted" as const, sent_at: "2026-11-10T15:00:01Z", accepted_at: "2026-11-12T15:00:00Z", accepted_value_cents: 2712204, decision_note: "Accepted online by Pat Client (pat@example.com)", recipients: ["pat@example.com"] }],
      bills: [{ id: "b1", number: "26-041-B01", kind: "progress" as const, status: "issued" as const, issued_at: "2026-11-20T15:00:00Z", total_cents: 9712500 }, { id: "b2", number: "26-041-B02", kind: "progress" as const, status: "draft" as const, issued_at: null, total_cents: 100 }],
    };
    const t = buildTimeline(input, { showPrices: true });
    expect(t.map((x) => x.text)).toEqual([
      "Bill 26-041-B01 issued for $97,125.00",
      "Quote Q-26-041-R0 accepted at $27,122.04 before GST. Accepted online by Pat Client (pat@example.com)",
      "Quote Q-26-041-R0 sent to pat@example.com",
      "Moved from Estimating to Quote out. Quote Q-26-041-R0 sent",
      "Plans.pdf added to Plans (version 2)",
      "Created in Opportunity",
    ]);
    expect(t[0]).toMatchObject({ at: "2026-11-20T15:00:00Z", kind: "bill", by: null });
    expect(t[4]).toMatchObject({ by: "u2", kind: "document" });
    const hidden = buildTimeline(input, { showPrices: false }).map((x) => x.text).join(" | ");
    expect(hidden).not.toMatch(/\$|Bill /);
    expect(hidden).toContain("Quote Q-26-041-R0 accepted");
  });
  test("a visit entry says who reported it: ArrivePing, or BMD sending to ArrivePing; a plain one has no suffix", () => {
    const base = { stages: [], documents: [], quotes: [], bills: [] };
    const visits = [
      { id: "v1", note: "Crew on the way (Brodie + 2)", at: "2026-12-01T14:00:00Z", source: "arriveping" },
      { id: "v2", note: "Install visit scheduled", at: "2026-12-01T13:00:00Z", source: "sync" },
      { id: "v3", note: "Install visit scheduled", at: "2026-12-01T12:00:00Z", source: "app" },
    ];
    const t = buildTimeline({ ...base, visits }, { showPrices: false });
    expect(t.map((x) => x.text)).toEqual(["Crew on the way (Brodie + 2) · reported by ArrivePing", "Install visit scheduled · sent to ArrivePing", "Install visit scheduled"]);
    expect(t.every((x) => x.kind === "visit")).toBe(true);
  });
});
