import { describe, expect, it } from "vitest";
import { areasFromSelection, areasSummary, assignmentState, bucketWeek, chipTone, inWeek, mergeTechnicians, mondayOf, selectionFromAreas, shiftWeek, technicianOf, toggleFloor, UNASSIGNED, visitDays, weekDays } from "./logic";

describe("weeks", () => {
  it("finds the Monday and the seven days", () => {
    expect(mondayOf("2026-11-24")).toBe("2026-11-23"); // Tuesday
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(weekDays("2026-11-23")).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(shiftWeek("2026-11-23", 1)).toBe("2026-11-30");
    expect(shiftWeek("2026-11-30", -1)).toBe("2026-11-23");
  });
  it("buckets by Winnipeg day, not UTC", () => {
    // 11 p.m. Sunday in Winnipeg is Monday 05:00 UTC.
    const late = { starts_at: "2026-11-30T05:00:00Z", ends_at: null };
    expect(visitDays(late)).toEqual(["2026-11-29"]);
    expect(inWeek(late, "2026-11-23")).toBe(true);
    expect(inWeek(late, "2026-11-30")).toBe(false);
  });
  it("puts each visit under its technician and on every day it spans", () => {
    const techs = mergeTechnicians([{ id: "u1", full_name: "Brodie", email: null }], []);
    const g = bucketWeek([
      { starts_at: "2026-11-24T14:00:00Z", ends_at: "2026-11-25T22:00:00Z", assigned_user_id: "u1" },
      { starts_at: "2026-11-26T14:00:00Z", ends_at: null },
      { starts_at: "2026-12-02T14:00:00Z", ends_at: null, assigned_user_id: "u1" },
    ], "2026-11-23", techs);
    expect([...(g.get("u1")?.keys() ?? [])]).toEqual(["2026-11-24", "2026-11-25"]);
    expect(g.get(UNASSIGNED)?.get("2026-11-26")).toHaveLength(1);
  });
});

describe("technicians", () => {
  it("merges BMD staff with ArrivePing crew names, without duplicates", () => {
    const t = mergeTechnicians([{ id: "u1", full_name: "Brodie Smith", email: "b@bmd.com" }], ["brodie smith", "Kyle", " ", null, "Kyle"]);
    expect(t).toEqual([{ id: "u1", name: "Brodie Smith", source: "bmd" }, { id: "ap:kyle", name: "Kyle", source: "arriveping" }]);
  });
  it("places a visit by BMD's assignment, then ArrivePing's", () => {
    const t = mergeTechnicians([{ id: "u1", full_name: "Brodie", email: null }], ["Kyle"]);
    expect(technicianOf({ assigned_user_id: "u1", arriveping_assigned_to: "Kyle" }, t)).toBe("u1");
    expect(technicianOf({ arriveping_assigned_to: "kyle" }, t)).toBe("ap:kyle");
    expect(technicianOf({ assigned_name: "Sub Co" }, t)).toBe("ap:sub co");
    expect(technicianOf({}, t)).toBe(UNASSIGNED);
  });
  it("is pending until ArrivePing reports the same person", () => {
    expect(assignmentState({}, null)).toBe("none");
    expect(assignmentState({ assigned_user_id: "u1" }, "Brodie")).toBe("pending");
    expect(assignmentState({ assigned_user_id: "u1", arriveping_assigned_to: "brodie" }, "Brodie")).toBe("confirmed");
    expect(assignmentState({ assigned_name: "Sub Co", arriveping_assigned_to: "Other" }, null)).toBe("pending");
  });
});

describe("areas", () => {
  const rooms = [{ id: "r1", floor_id: "f3" }, { id: "r2", floor_id: "f3" }, { id: "r3", floor_id: "f4" }];
  it("stores checked rooms as floor/room pairs in room order", () => {
    expect(areasFromSelection(["r3", "r1", "nope"], rooms)).toEqual([{ floor_id: "f3", room_id: "r1" }, { floor_id: "f4", room_id: "r3" }]);
    expect([...selectionFromAreas([{ floor_id: "f3", room_id: "r2" }, { bad: 1 }, null])]).toEqual(["r2"]);
    expect(selectionFromAreas("x").size).toBe(0);
  });
  it("whole floor checks all of it, then clears it", () => {
    const on = toggleFloor(new Set(["r1"]), "f3", rooms);
    expect([...on].sort()).toEqual(["r1", "r2"]);
    expect([...toggleFloor(on, "f3", rooms)]).toEqual([]);
  });
  it("summarises", () => {
    const label = (id: string) => ({ f3: "Floor 3" })[id];
    expect(areasSummary([{ floor_id: "f3", room_id: "r1" }, { floor_id: "f3", room_id: "r2" }], label)).toBe("2 areas · Floor 3");
    expect(areasSummary([{ floor_id: "f3", room_id: "r1" }, { floor_id: "f4", room_id: "r3" }], label)).toBe("2 areas · 2 floors");
    expect(areasSummary([], label)).toBe("—");
  });
});

it("colours chips by ArrivePing status", () => {
  expect(chipTone({ status: "scheduled", arriveping_status: "en_route" })).toBe("en_route");
  expect(chipTone({ status: "arrived" })).toBe("in_progress");
  expect(chipTone({ status: "cancelled", arriveping_status: "assigned" })).toBe("cancelled");
  expect(chipTone({ status: "scheduled", arriveping_status: "completed" })).toBe("complete");
});
