import { describe, expect, it } from "bun:test";
import { incomingFromVisit, jobScopes, mergeArrivePingStatus, readiness, scopeForVisit, tileCounts } from "./logic";

describe("mergeArrivePingStatus", () => {
  it("completes anything not finished", () => {
    expect(mergeArrivePingStatus(null, "complete")).toBe("complete");
    expect(mergeArrivePingStatus("not_started", "complete")).toBe("complete");
    expect(mergeArrivePingStatus("in_progress", "complete")).toBe("complete");
  });
  it("never overwrites complete or not required", () => {
    expect(mergeArrivePingStatus("complete", "complete")).toBeNull();
    expect(mergeArrivePingStatus("not_required", "complete")).toBeNull();
    expect(mergeArrivePingStatus("complete", "in_progress")).toBeNull();
    expect(mergeArrivePingStatus("not_required", "in_progress")).toBeNull();
  });
  it("in progress only lifts not started", () => {
    expect(mergeArrivePingStatus(undefined, "in_progress")).toBe("in_progress");
    expect(mergeArrivePingStatus("in_progress", "in_progress")).toBeNull();
  });
  it("maps visit statuses", () => {
    expect(incomingFromVisit("completed")).toBe("complete");
    expect(incomingFromVisit("en_route")).toBe("in_progress");
    expect(incomingFromVisit("scheduled")).toBeNull();
    expect(incomingFromVisit("cancelled")).toBeNull();
  });
});

describe("readiness", () => {
  const base = { scopes: ["lvp", "wall_base"], status: {}, blockers: [], awaitingMaterial: false };
  it("blocked by a stored blocker", () => {
    const r = readiness({ ...base, blockers: [{ scope: "lvp", text: "No access", kind: "access" }] });
    expect(r.state).toBe("blocked");
    expect(r.blocker).toEqual({ text: "No access", kind: "access", auto: false });
  });
  it("blocked by awaiting material while not complete", () => {
    const r = readiness({ ...base, awaitingMaterial: true });
    expect(r.state).toBe("blocked");
    expect(r.blocker?.auto).toBe(true);
    expect(r.blocker?.text).toBe("Awaiting material");
  });
  it("installed when required scopes complete, even with material outstanding", () => {
    expect(readiness({ ...base, awaitingMaterial: true, status: { lvp: "complete", wall_base: "not_required" } }).state).toBe("installed");
  });
  it("in progress and not ready", () => {
    expect(readiness({ ...base, status: { lvp: "in_progress" } }).state).toBe("in_progress");
    expect(readiness(base).state).toBe("not_ready");
  });
  it("tiles", () => {
    expect(tileCounts(["not_ready", "blocked", "in_progress", "installed", "not_ready"])).toEqual({ ready: 2, inProgress: 1, blocked: 1 });
  });
});

describe("scopes", () => {
  it("prefers wizard scopes, then install categories, then flooring", () => {
    expect(jobScopes(["lvp"], ["wall_base"])).toEqual(["lvp"]);
    expect(jobScopes([], ["adhesive", "wall_base", "wall_base"])).toEqual(["wall_base"]);
    expect(jobScopes([], ["prep"])).toEqual(["flooring"]);
  });
  it("matches a visit scope", () => {
    expect(scopeForVisit("Wall base", ["lvp", "wall_base"])).toBe("wall_base");
    expect(scopeForVisit("anything", ["lvp"])).toBe("lvp");
    expect(scopeForVisit("Paint", ["lvp", "wall_base"])).toBeNull();
  });
});
