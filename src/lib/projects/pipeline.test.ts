import { describe, expect, test } from "bun:test";
import { applyFilters, columnSummary, sortProjects, toCsv, winRate, type Filters } from "./pipeline";
import type { PipelineProject } from "./data";

const base: PipelineProject = {
  id: "x", name: "X", project_number: "26-001", client_id: "c1", client_name: "Acme", address: null,
  stage: "opportunity", stage_entered_at: "2026-11-01T00:00:00Z", bid_due_date: null, estimated_value_cents: null,
  lost_reason: null, lost_note: null, job_type: null, notes: null, archived_at: null, created_at: "2026-10-01T00:00:00Z",
  members: [], floorCount: 0, onedrive_folder_id: null, onedrive_parent_path: null,
};
const p = (o: Partial<PipelineProject>): PipelineProject => ({ ...base, ...o });
const none: Filters = { assignee: "", clientId: "", jobType: "", due: "any", text: "" };
const today = new Date("2026-11-22T18:00:00Z");

describe("applyFilters", () => {
  const rows = [
    p({ id: "a", name: "Alpha Tower", client_id: "c1", job_type: "Hotel", bid_due_date: "2026-11-20", members: [{ user_id: "u1", job_roles: ["estimator"] }] }),
    p({ id: "b", name: "Beta Mall", client_id: "c2", client_name: "Bolt", job_type: "Retail", bid_due_date: "2026-11-25", members: [{ user_id: "u2", job_roles: [] }] }),
    p({ id: "c", name: "Gamma", client_id: "c2", client_name: "Bolt", bid_due_date: "2026-12-30" }),
  ];
  const ids = (f: Partial<Filters>) => applyFilters(rows, { ...none, ...f }, today).map((r) => r.id);

  test("no filters keeps everything", () => expect(ids({})).toEqual(["a", "b", "c"]));
  test("assignee matches only people holding a job role", () => {
    expect(ids({ assignee: "u1" })).toEqual(["a"]);
    expect(ids({ assignee: "u2" })).toEqual([]);
  });
  test("client and job type", () => {
    expect(ids({ clientId: "c2" })).toEqual(["b", "c"]);
    expect(ids({ jobType: "Hotel" })).toEqual(["a"]);
  });
  test("overdue means due before today", () => expect(ids({ due: "overdue" })).toEqual(["a"]));
  test("due this week covers today through seven days out", () => expect(ids({ due: "week" })).toEqual(["b"]));
  test("due this month covers today through thirty days out", () => expect(ids({ due: "month" })).toEqual(["b"]));
  test("text searches number, name and client, ignoring case", () => {
    expect(ids({ text: "bolt" })).toEqual(["b", "c"]);
    expect(ids({ text: "ALPHA" })).toEqual(["a"]);
  });
});

describe("columnSummary", () => {
  test("counts every project and adds only known values", () => {
    const s = columnSummary([
      p({ stage: "estimating", estimated_value_cents: 1_000_00 }),
      p({ stage: "estimating", estimated_value_cents: null }),
      p({ stage: "won", estimated_value_cents: 2_500_00 }),
    ]);
    expect(s.estimating).toEqual({ count: 2, valueCents: 1_000_00, unvalued: 1, openBook: 0 });
    expect(s.won).toEqual({ count: 1, valueCents: 2_500_00, unvalued: 0, openBook: 0 });
    expect(s.lost).toEqual({ count: 0, valueCents: 0, unvalued: 0, openBook: 0 });
  });
});

describe("winRate", () => {
  const decided = [
    p({ stage: "won", stage_entered_at: "2026-11-10T00:00:00Z" }),
    p({ stage: "in_progress", stage_entered_at: "2026-11-12T00:00:00Z" }),
    p({ stage: "lost", lost_reason: "price", stage_entered_at: "2026-11-15T00:00:00Z" }),
    p({ stage: "lost", lost_reason: "scope", stage_entered_at: "2026-06-01T00:00:00Z" }),
    p({ stage: "quote_out" }),
  ];
  test("won, in progress and closed count as wins against losses in the period", () => {
    expect(winRate(decided, 90, today)).toEqual({ won: 2, lost: 1, pct: 67 });
  });
  test("a longer period brings older decisions in", () => {
    expect(winRate(decided, 365, today)).toEqual({ won: 2, lost: 2, pct: 50 });
  });
  test("no decisions gives no percentage rather than zero", () => {
    expect(winRate([p({ stage: "estimating" })], 90, today)).toEqual({ won: 0, lost: 0, pct: null });
  });
});

describe("sortProjects", () => {
  const rows = [p({ id: "a", name: "b", bid_due_date: null }), p({ id: "b", name: "A", bid_due_date: "2026-12-01" }), p({ id: "c", name: "c", bid_due_date: "2026-11-01" })];
  test("by name, case-insensitive", () => expect(sortProjects(rows, "name", "asc").map((r) => r.id)).toEqual(["b", "a", "c"]));
  test("by due date with undated projects last in both directions", () => {
    expect(sortProjects(rows, "bid_due_date", "asc").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortProjects(rows, "bid_due_date", "desc").map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});

describe("toCsv", () => {
  test("quotes fields containing commas, quotes or line breaks", () => {
    expect(toCsv([["No.", "Project"], ["26-001", 'Tower "A", north'], ["26-002", "Line\nbreak"]])).toBe(
      'No.,Project\r\n26-001,"Tower ""A"", north"\r\n26-002,"Line\nbreak"',
    );
  });
  test("cells that could run as spreadsheet formulas are neutralised", () => {
    expect(toCsv([["=SUM(A1)", "+1", "-2", "@x"]])).toBe("'=SUM(A1),'+1,'-2,'@x");
  });
});

describe("open-book jobs in the stage totals", () => {
  test("an open-book job is counted but adds no dollars and is not 'unpriced'", () => {
    const rows = [
      { id: "a", stage: "won", estimated_value_cents: 100_00 },
      { id: "b", stage: "won", estimated_value_cents: 999_00 },
      { id: "c", stage: "won", estimated_value_cents: null },
    ] as never;
    const s = columnSummary(rows, new Set(["b"])).won;
    expect(s).toEqual({ count: 3, valueCents: 100_00, unvalued: 1, openBook: 1 });
  });
});
