import { describe, expect, test } from "bun:test";
import type { PipelineProject } from "./data";
import { DEFAULT_PREFS, clientJobs, filterJobs, groupCounts, jobsExportRows, parsePrefs, sortChoice, splitOpenJobs } from "./joblist";
import { columnSummary, sortProjects, winRate } from "./pipeline";
import { STAGES, STAGE_GROUPS, isOpenStage, stageGroup, stageLabel } from "./stages";

const base: PipelineProject = {
  id: "x", name: "X", project_number: "26-001", client_id: "c1", client_name: "Acme", address: null,
  stage: "opportunity", stage_entered_at: "2026-11-01T00:00:00Z", bid_due_date: null, estimated_value_cents: null,
  lost_reason: null, lost_note: null, job_type: null, notes: null, archived_at: null, created_at: "2026-10-01T00:00:00Z",
  members: [], floorCount: 0, onedrive_folder_id: null, onedrive_parent_path: null, kind: "client", standard_tasks: [],
};
const p = (o: Partial<PipelineProject>): PipelineProject => ({ ...base, ...o });

describe("stages with Warranty", () => {
  test("Warranty sits between In progress and Closed", () => {
    expect(STAGES.map((s) => s.value)).toEqual(["opportunity", "estimating", "quote_out", "won", "in_progress", "warranty", "closed", "lost"]);
    expect(stageLabel("warranty")).toBe("Warranty");
  });
  test("the four plain groups cover every stage exactly once", () => {
    expect(STAGE_GROUPS.map((g) => g.label)).toEqual(["Presale", "Open", "Warranty", "Closed"]);
    expect(STAGE_GROUPS.flatMap((g) => g.stages).sort()).toEqual(STAGES.map((s) => s.value).sort());
    expect(stageGroup("quote_out")).toBe("presale");
    expect(stageGroup("won")).toBe("open");
    expect(stageGroup("in_progress")).toBe("open");
    expect(stageGroup("warranty")).toBe("warranty");
    expect(stageGroup("lost")).toBe("closed");
  });
  test("a job in Warranty is not open work", () => {
    expect(isOpenStage("warranty")).toBe(false);
    expect(isOpenStage("in_progress")).toBe(true);
  });
  test("Warranty has its own pipeline column and counts as a win, not as an open bid", () => {
    const rows = [p({ id: "a", stage: "warranty", estimated_value_cents: 500, stage_entered_at: "2026-11-20T00:00:00Z" }), p({ id: "b", stage: "in_progress", estimated_value_cents: 100 })];
    const s = columnSummary(rows);
    expect(s.warranty).toEqual({ count: 1, valueCents: 500, unvalued: 0, openBook: 0 });
    expect(s.in_progress.valueCents).toBe(100);
    expect(s.opportunity.count + s.estimating.count + s.quote_out.count).toBe(0);
    expect(winRate(rows, 30, new Date("2026-11-22T00:00:00Z"))).toEqual({ won: 2, lost: 0, pct: 100 });
  });
});

describe("filterJobs", () => {
  const rows = [
    p({ id: "a", name: "Alpha Tower", stage: "estimating" }),
    p({ id: "b", name: "Beta Mall", stage: "won", client_name: "Bolt", members: [{ user_id: "u1", job_roles: ["project_lead"] }] }),
    p({ id: "c", name: "Gamma", stage: "in_progress", project_number: "26-014" }),
    p({ id: "d", name: "Delta", stage: "warranty" }),
    p({ id: "e", name: "Echo", stage: "closed" }),
    p({ id: "f", name: "Foxtrot", stage: "lost" }),
    p({ id: "g", name: "Shop time", stage: "in_progress", kind: "internal", client_id: null, client_name: null }),
  ];
  const ids = (f: Partial<Parameters<typeof filterJobs>[1]>) => filterJobs(rows, { group: "all", text: "", mineId: null, ...f }).map((r) => r.id);
  test("each group shows its own stages", () => {
    expect(ids({ group: "presale" })).toEqual(["a"]);
    expect(ids({ group: "open" })).toEqual(["b", "c", "g"]);
    expect(ids({ group: "warranty" })).toEqual(["d"]);
    expect(ids({ group: "closed" })).toEqual(["e", "f"]);
    expect(ids({ group: "all" })).toHaveLength(7);
  });
  test("search looks at number, name and client", () => {
    expect(ids({ text: "bolt" })).toEqual(["b"]);
    expect(ids({ text: "26-014" })).toEqual(["c"]);
    expect(ids({ text: " SHOP " })).toEqual(["g"]);
  });
  test("my jobs keeps only jobs where the person holds a job role", () => expect(ids({ mineId: "u1" })).toEqual(["b"]));
  test("counts per group, for the filter buttons", () => {
    expect(groupCounts(rows)).toEqual({ presale: 1, open: 3, warranty: 1, closed: 2, all: 7 });
  });
});

describe("internal jobs", () => {
  const rows = [p({ id: "a", stage: "in_progress", estimated_value_cents: 1000 }), p({ id: "i", stage: "in_progress", kind: "internal", estimated_value_cents: 999 })];
  test("are left out of the pipeline, its totals and the estimates list", () => {
    expect(clientJobs(rows).map((r) => r.id)).toEqual(["a"]);
    expect(columnSummary(clientJobs(rows)).in_progress).toEqual({ count: 1, valueCents: 1000, unvalued: 0, openBook: 0 });
  });
  test("a job loaded before the column exists counts as a client job", () => {
    expect(clientJobs([{ ...rows[1]!, kind: undefined as never }])).toHaveLength(1);
  });
});

describe("open jobs list in the sidebar", () => {
  const rows = [
    { id: "1", name: "Zed Hotel", project_number: "26-003", stage: "in_progress" as const, kind: "client" as const },
    { id: "2", name: "alpha Offices", project_number: "26-001", stage: "won" as const, kind: "client" as const },
    { id: "3", name: "Shop time", project_number: "26-002", stage: "in_progress" as const, kind: "internal" as const },
    { id: "4", name: "Old job", project_number: "25-001", stage: "warranty" as const, kind: "client" as const },
    { id: "5", name: "A bid", project_number: "26-009", stage: "estimating" as const, kind: "client" as const },
    { id: "6", name: "Equipment repairs", project_number: null, stage: "in_progress" as const, kind: "internal" as const },
  ];
  test("only open jobs, internal ones first under their own heading, each by name", () => {
    const s = splitOpenJobs(rows, "");
    expect(s.internal.map((r) => r.name)).toEqual(["Equipment repairs", "Shop time"]);
    expect(s.jobs.map((r) => r.name)).toEqual(["alpha Offices", "Zed Hotel"]);
  });
  test("the search box narrows by name or number", () => {
    expect(splitOpenJobs(rows, "26-003").jobs.map((r) => r.id)).toEqual(["1"]);
    expect(splitOpenJobs(rows, "shop")).toEqual({ internal: [rows[2]!], jobs: [] });
  });
});

describe("remembered filter and sort", () => {
  test("starts on Open, newest first", () => {
    expect(DEFAULT_PREFS).toEqual({ group: "open", key: "created_at", dir: "desc" });
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });
  test("a saved choice comes back", () => {
    expect(parsePrefs(JSON.stringify({ group: "warranty", key: "name", dir: "asc" }))).toEqual({ group: "warranty", key: "name", dir: "asc" });
  });
  test("anything unreadable falls back to the default, part by part", () => {
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ group: "nope", key: "name", dir: "sideways" }))).toEqual({ group: "open", key: "name", dir: "desc" });
    expect(parsePrefs("[1,2]")).toEqual(DEFAULT_PREFS);
  });
  test("the sort picker names the three plain choices; a column sort shows as none of them", () => {
    expect(sortChoice({ key: "created_at", dir: "desc" })).toBe("newest");
    expect(sortChoice({ key: "project_number", dir: "asc" })).toBe("number");
    expect(sortChoice({ key: "name", dir: "desc" })).toBe("name");
    expect(sortChoice({ key: "bid_due_date", dir: "asc" })).toBe("");
  });
  test("newest first sorts by when the job was created", () => {
    const rows = [p({ id: "old", created_at: "2026-01-01T00:00:00Z" }), p({ id: "new", created_at: "2026-11-01T00:00:00Z" })];
    expect(sortProjects(rows, "created_at", "desc").map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("export", () => {
  test("one header row, then a row per job with plain words", () => {
    const rows = jobsExportRows(
      [p({ id: "a", name: "Alpha", stage: "warranty", estimated_value_cents: 123456, members: [{ user_id: "u1", job_roles: ["estimator"] }] }), p({ id: "i", name: "Shop", kind: "internal", client_name: null, stage: "in_progress" })],
      [{ id: "u1", full_name: "Pat Lee", email: null }],
      new Set(["a"]),
    );
    expect(rows[0]).toEqual(["No.", "Job", "Client", "Kind", "Group", "Stage", "Bid due", "Value", "Job type", "Estimator", "Project lead", "QuickBooks", "Created"]);
    expect(rows[1]).toEqual(["26-001", "Alpha", "Acme", "Client", "Warranty", "Warranty", null, 1234.56, null, "Pat Lee", null, "Linked", "2026-10-01"]);
    expect(rows[2]!.slice(1, 6)).toEqual(["Shop", null, "Internal", "Open", "In progress"]);
    expect(rows[2]![11]).toBe("");
  });
  test("an unknown value stays blank, never zero", () => {
    expect(jobsExportRows([p({})], [], new Set())[1]![7]).toBeNull();
  });
});
