import { describe, expect, test } from "bun:test";
import { planRun, renumberRun, runLabel, shiftRun, MAX_RUN_DAYS } from "./runs";
import type { WorkCalendar } from "./workdays";

const cal: WorkCalendar = { workdays: [1, 2, 3, 4, 5], holidays: [{ day: "2026-11-25", name: "Shop closed" }] };
const at = (day: string) => `${day}T14:00:00.000Z`; // 8:00 a.m. in Winnipeg (CST)

describe("creating a run of days", () => {
  test("one day is a single visit with no run", () => {
    expect(planRun("2026-11-23", 1, cal)).toEqual([{ day: "2026-11-23", run_day: null, run_total: null }]);
  });
  test("three days from Monday skip the closed Wednesday", () => {
    expect(planRun("2026-11-23", 3, cal)).toEqual([
      { day: "2026-11-23", run_day: 1, run_total: 3 },
      { day: "2026-11-24", run_day: 2, run_total: 3 },
      { day: "2026-11-26", run_day: 3, run_total: 3 },
    ]);
  });
  test("a run from Friday carries over the weekend", () => {
    expect(planRun("2026-11-27", 2, cal).map((d) => d.day)).toEqual(["2026-11-27", "2026-11-30"]);
  });
  test("a run started on a non-workday keeps that first day as chosen, then continues on workdays", () => {
    expect(planRun("2026-11-28", 2, cal).map((d) => d.day)).toEqual(["2026-11-28", "2026-11-30"]);
  });
  test("the number of days is kept sensible", () => {
    expect(planRun("2026-11-23", 0, cal)).toHaveLength(1);
    expect(planRun("2026-11-23", 2.7, cal)).toHaveLength(2);
    expect(planRun("2026-11-23", 999, cal)).toHaveLength(MAX_RUN_DAYS);
  });
});

const run = [
  { id: "a", starts_at: at("2026-11-23"), status: "scheduled" },
  { id: "b", starts_at: at("2026-11-24"), status: "scheduled" },
  { id: "c", starts_at: at("2026-11-26"), status: "scheduled" },
];

describe("moving a day of a run", () => {
  test("just this day: only that visit moves", () => {
    expect(shiftRun(run, "b", "2026-11-27", "one", cal)).toEqual([{ id: "b", day: "2026-11-27" }]);
  });
  test("this and the following days: later days shift by the same number of workdays", () => {
    // Tuesday → Thursday is one workday on (Wednesday is closed); Thursday's visit goes to Friday.
    expect(shiftRun(run, "b", "2026-11-26", "following", cal)).toEqual([
      { id: "b", day: "2026-11-26" },
      { id: "c", day: "2026-11-27" },
    ]);
  });
  test("the following days skip the weekend", () => {
    // Monday → Thursday is two workdays on: Tuesday → Friday, Thursday → the Monday after.
    expect(shiftRun(run, "a", "2026-11-26", "following", cal)).toEqual([
      { id: "a", day: "2026-11-26" },
      { id: "b", day: "2026-11-27" },
      { id: "c", day: "2026-11-30" },
    ]);
  });
  test("moving earlier pulls the following days back", () => {
    expect(shiftRun(run, "b", "2026-11-23", "following", cal)).toEqual([
      { id: "b", day: "2026-11-23" },
      { id: "c", day: "2026-11-24" },
    ]);
  });
  test("earlier days and cancelled days never move", () => {
    const withCancelled = [...run, { id: "d", starts_at: at("2026-11-27"), status: "cancelled" }];
    expect(shiftRun(withCancelled, "c", "2026-11-27", "following", cal)).toEqual([{ id: "c", day: "2026-11-27" }]);
  });
  test("moved onto a non-workday, that day goes where it was put and the rest stay on workdays", () => {
    expect(shiftRun(run, "b", "2026-11-28", "following", cal)).toEqual([
      { id: "b", day: "2026-11-28" },
      { id: "c", day: "2026-11-30" },
    ]);
  });
  test("the same day is no move", () => {
    expect(shiftRun(run, "b", "2026-11-24", "following", cal)).toEqual([]);
  });
});

describe("renumbering", () => {
  test("removing the middle day renumbers the rest", () => {
    const left = run.map((v) => (v.id === "b" ? { ...v, status: "cancelled" } : v));
    expect(renumberRun(left)).toEqual([
      { id: "a", run_day: 1, run_total: 2, in_run: true },
      { id: "b", run_day: null, run_total: null, in_run: false },
      { id: "c", run_day: 2, run_total: 2, in_run: true },
    ]);
  });
  test("days are numbered in date order, whatever order they were moved into", () => {
    const moved = [run[0]!, { ...run[1]!, starts_at: at("2026-11-30") }, run[2]!];
    expect(renumberRun(moved).map((r) => [r.id, r.run_day])).toEqual([["a", 1], ["b", 3], ["c", 2]]);
  });
  test("a run left with one day is an ordinary visit again", () => {
    const left = run.map((v) => (v.id === "a" ? v : { ...v, status: "cancelled" }));
    expect(renumberRun(left).find((r) => r.id === "a")).toEqual({ id: "a", run_day: null, run_total: null, in_run: false });
  });
  test("the label a chip shows", () => {
    expect(runLabel({ run_day: 2, run_total: 3 })).toBe("Day 2 of 3");
    expect(runLabel({ run_day: null, run_total: null })).toBeNull();
    expect(runLabel({ run_day: 1, run_total: 1 })).toBeNull();
  });
});
