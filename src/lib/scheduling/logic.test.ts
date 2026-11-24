import { describe, expect, it } from "vitest";
import {
  areasFromSelection,
  areasSummary,
  assignmentState,
  bucketWeek,
  chipTone,
  inWeek,
  mergeTechnicians,
  mondayOf,
  selectionFromAreas,
  shiftWeek,
  technicianOf,
  toggleFloor,
  UNASSIGNED,
  visitDays,
  weekDays,
  assignmentFor,
  clashesFor,
  linkChanges,
  rowsToShow,
  suggestedCrews,
  monthOf,
  visitsThisMonth,
  searchTechnicians,
} from "./logic";

describe("weeks", () => {
  it("finds the Monday and the seven days", () => {
    expect(mondayOf("2026-11-24")).toBe("2026-11-23"); // Tuesday
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(weekDays("2026-11-23")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
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
    const g = bucketWeek(
      [
        {
          starts_at: "2026-11-24T14:00:00Z",
          ends_at: "2026-11-25T22:00:00Z",
          assigned_user_id: "u1",
        },
        { starts_at: "2026-11-26T14:00:00Z", ends_at: null },
        { starts_at: "2026-12-02T14:00:00Z", ends_at: null, assigned_user_id: "u1" },
      ],
      "2026-11-23",
      techs,
    );
    expect([...(g.get("u1")?.keys() ?? [])]).toEqual(["2026-11-24", "2026-11-25"]);
    expect(g.get(UNASSIGNED)?.get("2026-11-26")).toHaveLength(1);
  });
});

describe("technicians", () => {
  it("merges BMD staff with ArrivePing crew names, without duplicates", () => {
    const t = mergeTechnicians(
      [{ id: "u1", full_name: "Brodie Smith", email: "b@bmd.com" }],
      ["brodie smith", "Kyle", " ", null, "Kyle"],
    );
    expect(t).toEqual([
      { id: "u1", name: "Brodie Smith", source: "bmd" },
      { id: "ap:kyle", name: "Kyle", source: "arriveping" },
    ]);
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
    expect(
      assignmentState({ assigned_user_id: "u1", arriveping_assigned_to: "brodie" }, "Brodie"),
    ).toBe("confirmed");
    expect(
      assignmentState({ assigned_name: "Sub Co", arriveping_assigned_to: "Other" }, null),
    ).toBe("pending");
  });
});

describe("areas", () => {
  const rooms = [
    { id: "r1", floor_id: "f3" },
    { id: "r2", floor_id: "f3" },
    { id: "r3", floor_id: "f4" },
  ];
  it("stores checked rooms as floor/room pairs in room order", () => {
    expect(areasFromSelection(["r3", "r1", "nope"], rooms)).toEqual([
      { floor_id: "f3", room_id: "r1" },
      { floor_id: "f4", room_id: "r3" },
    ]);
    expect([...selectionFromAreas([{ floor_id: "f3", room_id: "r2" }, { bad: 1 }, null])]).toEqual([
      "r2",
    ]);
    expect(selectionFromAreas("x").size).toBe(0);
  });
  it("whole floor checks all of it, then clears it", () => {
    const on = toggleFloor(new Set(["r1"]), "f3", rooms);
    expect([...on].sort()).toEqual(["r1", "r2"]);
    expect([...toggleFloor(on, "f3", rooms)]).toEqual([]);
  });
  it("summarises", () => {
    const label = (id: string) => ({ f3: "Floor 3" })[id];
    expect(
      areasSummary(
        [
          { floor_id: "f3", room_id: "r1" },
          { floor_id: "f3", room_id: "r2" },
        ],
        label,
      ),
    ).toBe("2 areas · Floor 3");
    expect(
      areasSummary(
        [
          { floor_id: "f3", room_id: "r1" },
          { floor_id: "f4", room_id: "r3" },
        ],
        label,
      ),
    ).toBe("2 areas · 2 floors");
    expect(areasSummary([], label)).toBe("—");
  });
});

it("colours chips by ArrivePing status", () => {
  expect(chipTone({ status: "scheduled", arriveping_status: "en_route" })).toBe("en_route");
  expect(chipTone({ status: "arrived" })).toBe("in_progress");
  expect(chipTone({ status: "cancelled", arriveping_status: "assigned" })).toBe("cancelled");
  expect(chipTone({ status: "scheduled", arriveping_status: "completed" })).toBe("complete");
});

describe("subcontractors from the catalogue are technicians", () => {
  const staff = [{ id: "u1", full_name: "Dan Rosenblat", email: "dan@x.ca" }];
  const subs = [
    { id: "s2", name: "Zed Flooring", contact_name: "Pat Lee", phone: "204-555-0101", supplies: "both" },
    { id: "s1", name: "Brodi Installs", contact_name: null, phone: null, supplies: "labour" },
  ];
  const techs = mergeTechnicians(staff, ["Brodi installs", "Kai"], subs);

  it("staff come first, then subcontractors by name, then ArrivePing names nobody has claimed", () => {
    expect(techs.map((t) => [t.id, t.source])).toEqual([["u1", "bmd"], ["sup:s1", "supplier"], ["sup:s2", "supplier"], ["ap:kai", "arriveping"]]);
    expect(techs[2]).toMatchObject({ name: "Zed Flooring", detail: "Pat Lee · 204-555-0101", both: true });
  });
  it("a visit linked to a subcontractor sits in that subcontractor's row, whatever name was typed", () => {
    expect(technicianOf({ technician_supplier_id: "s2", assigned_name: "old name" }, techs)).toBe("sup:s2");
    expect(technicianOf({ assigned_name: "brodi installs" }, techs)).toBe("sup:s1");
    expect(technicianOf({ technician_supplier_id: "gone", assigned_name: "Ghost Crew" }, techs)).toBe("ap:ghost crew");
  });
  it("search finds by name, contact or phone, names that start with the text first", () => {
    expect(searchTechnicians(techs, "").length).toBe(4);
    expect(searchTechnicians(techs, "pat").map((t) => t.id)).toEqual(["sup:s2"]);
    expect(searchTechnicians(techs, "555").map((t) => t.id)).toEqual(["sup:s2"]);
    expect(searchTechnicians(techs, "d").map((t) => t.id)).toEqual(["u1", "sup:s1", "sup:s2"]);
  });
  it("what is saved on the visit for each kind of pick", () => {
    expect(assignmentFor("", techs)).toEqual({ assigned_user_id: null, assigned_name: null, technician_supplier_id: null });
    expect(assignmentFor("u1", techs)).toEqual({ assigned_user_id: "u1", assigned_name: null, technician_supplier_id: null });
    expect(assignmentFor("sup:s1", techs)).toEqual({ assigned_user_id: null, assigned_name: "Brodi Installs", technician_supplier_id: "s1" });
  });
  it("a subcontractor confirmed by ArrivePing under the same name shows as confirmed", () => {
    expect(assignmentState({ assigned_name: "Brodi Installs", technician_supplier_id: "s1", arriveping_assigned_to: "brodi installs" }, null)).toBe("confirmed");
  });
});

describe("the Technicians page", () => {
  const techs = mergeTechnicians([{ id: "u1", full_name: "Dan R", email: null }], [], [{ id: "s1", name: "Brodi Installs", contact_name: null, phone: null, supplies: "labour" }]);
  const v = (id: string, starts_at: string, who: object, status = "scheduled") => ({ id, starts_at, ends_at: null, status, ...who });
  const visits = [
    v("a", "2026-11-03T15:00:00Z", { technician_supplier_id: "s1", assigned_name: "Brodi Installs" }),
    v("b", "2026-11-20T15:00:00Z", { technician_supplier_id: "s1", assigned_name: "Brodi Installs" }),
    v("c", "2026-11-21T15:00:00Z", { technician_supplier_id: "s1", assigned_name: "Brodi Installs" }, "cancelled"),
    v("d", "2026-12-02T15:00:00Z", { technician_supplier_id: "s1", assigned_name: "Brodi Installs" }),
    v("e", "2026-11-10T15:00:00Z", { assigned_user_id: "u1" }),
    v("f", "2026-11-11T15:00:00Z", {}),
  ];
  it("counts each technician's visits in the month, leaving out cancelled ones and other months", () => {
    const n = visitsThisMonth(visits, techs, "2026-11-24");
    expect(n.get("sup:s1")).toBe(2);
    expect(n.get("u1")).toBe(1);
    expect(n.get("unassigned")).toBeUndefined();
  });
  it("a month runs from its first day to the first day of the next, across a year end", () => {
    expect(monthOf("2026-11-24")).toEqual({ from: "2026-11-01", to: "2026-12-01" });
    expect(monthOf("2026-12-31")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
});

describe("crews: a calmer grid, clashes and suggestions", () => {
  const techs = mergeTechnicians([{ id: "u1", full_name: "Dan R", email: null }], [], [
    { id: "s1", name: "Apollo", contact_name: null, phone: null, supplies: "labour" },
    { id: "s2", name: "Brolee", contact_name: null, phone: null, supplies: "labour" },
  ]);
  it("the week grid shows only crews with a visit that week unless everyone is asked for", () => {
    expect(rowsToShow(techs, new Set(["sup:s2"]), false).map((t) => t.id)).toEqual(["sup:s2"]);
    expect(rowsToShow(techs, new Set(["sup:s2"]), true).map((t) => t.id)).toEqual(["u1", "sup:s1", "sup:s2"]);
    expect(rowsToShow(techs, new Set(), false)).toEqual([]);
  });
  const v = (id: string, s: string, e: string | null, who: object, status = "scheduled") => ({ id, starts_at: s, ends_at: e, status, ...who });
  const visits = [
    v("a", "2026-11-26T14:00:00Z", "2026-11-26T22:00:00Z", { technician_supplier_id: "s1", assigned_name: "Apollo" }),
    v("b", "2026-11-27T14:00:00Z", "2026-11-27T22:00:00Z", { technician_supplier_id: "s1", assigned_name: "Apollo" }),
    v("c", "2026-11-26T14:00:00Z", "2026-11-26T22:00:00Z", { technician_supplier_id: "s1", assigned_name: "Apollo" }, "cancelled"),
    v("d", "2026-11-26T14:00:00Z", "2026-11-26T22:00:00Z", { technician_supplier_id: "s2", assigned_name: "Brolee" }),
  ];
  it("a crew already booked that day is reported, but not a cancelled visit, another crew, or the visit being edited", () => {
    const at = { starts_at: "2026-11-26T15:00:00Z", ends_at: "2026-11-26T20:00:00Z" };
    expect(clashesFor(visits, "sup:s1", techs, at, null).map((x) => x.id)).toEqual(["a"]);
    expect(clashesFor(visits, "sup:s1", techs, at, "a")).toEqual([]);
    expect(clashesFor(visits, "", techs, at, null)).toEqual([]);
    expect(clashesFor(visits, "u1", techs, at, null)).toEqual([]);
  });
  it("crews linked to the job's labour come first, each with the work they are linked for", () => {
    const out = suggestedCrews(techs, [{ supplier_id: "s2", work: "Install LVT" }, { supplier_id: "gone", work: "x" }]);
    expect(out).toEqual([{ ...techs[2]!, work: "Install LVT" }]);
  });
  it("saving the crews on a labour item adds and removes only what changed", () => {
    expect(linkChanges(["a", "b"], ["b", "c", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(linkChanges([], [])).toEqual({ add: [], remove: [] });
  });
});
