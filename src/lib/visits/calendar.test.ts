import { describe, expect, it } from "vitest";
import {
  calendarRange,
  daysOfMonth,
  isWeekend,
  monthGrid,
  monthOf,
  placeVisits,
  shiftMonth,
  sortVisits,
  visitSpansDay,
  visitsOn,
} from "./calendar";

const v = (id: string, starts_at: string, ends_at: string | null, number = "26-002", name = "Test Take Off") => ({
  id,
  starts_at,
  ends_at,
  project: { project_number: number, name },
});

describe("months", () => {
  it("knows a month's first day, its days and how to step", () => {
    expect(monthOf("2026-11-24")).toBe("2026-11-01");
    expect(daysOfMonth("2026-11-01")).toHaveLength(30);
    expect(daysOfMonth("2026-02-10")).toHaveLength(28);
    expect(daysOfMonth("2028-02-01")).toHaveLength(29);
    expect(shiftMonth("2026-11-01", 1)).toBe("2026-12-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("lays the month out in whole Monday-to-Sunday weeks", () => {
    const rows = monthGrid("2026-11-01"); // Nov 2026 starts on a Sunday
    expect(rows[0]![0]).toBe("2026-10-26");
    expect(rows[0]![6]).toBe("2026-11-01");
    expect(rows[rows.length - 1]![6]).toBe("2026-12-06");
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });
  it("gives the range a mode shows", () => {
    expect(calendarRange("week", "2026-11-24")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(calendarRange("month", "2026-11-24")).toEqual({ from: "2026-10-26", to: "2026-12-06" });
  });
});

describe("site days", () => {
  it("buckets by the site day, so a late-evening start stays on its day", () => {
    // 23:30 at UTC-6 (Winnipeg in winter) on Nov 23 is 05:30Z on Nov 24. A fixed offset keeps this true on machines without full tz data.
    const tz = "Etc/GMT+6";
    const late = v("a", "2026-11-24T05:30:00Z", "2026-11-24T05:50:00Z");
    expect(visitSpansDay(late, "2026-11-23", tz)).toBe(true);
    expect(visitSpansDay(late, "2026-11-24", tz)).toBe(false);
  });
  it("a multi-day visit touches every day it covers", () => {
    const multi = v("m", "2026-12-01T14:00:00Z", "2026-12-03T22:00:00Z");
    expect(visitSpansDay(multi, "2026-12-02")).toBe(true);
    expect(visitSpansDay(multi, "2026-12-04")).toBe(false);
  });
  it("knows weekends", () => {
    expect(isWeekend("2026-11-28")).toBe(true);
    expect(isWeekend("2026-11-29")).toBe(true);
    expect(isWeekend("2026-11-30")).toBe(false);
  });
});

describe("placing blocks", () => {
  const week = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
  it("orders by start, then job, then id", () => {
    const out = sortVisits([
      v("b", "2026-11-24T14:00:00Z", null, "26-005", "Zed"),
      v("a", "2026-11-24T14:00:00Z", null, "26-002", "Alpha"),
      v("c", "2026-11-23T14:00:00Z", null, "26-009", "Late start first"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("spans the days it covers and continues across rows", () => {
    const out = placeVisits([v("m", "2026-11-21T14:00:00Z", "2026-11-24T22:00:00Z")], week);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ col: 0, span: 2, fromPrev: true, toNext: false, lane: 0 });
    const next = placeVisits([v("n", "2026-11-28T14:00:00Z", "2026-12-02T22:00:00Z")], week);
    expect(next[0]).toMatchObject({ col: 5, span: 2, fromPrev: false, toNext: true });
  });
  it("stacks overlapping blocks in lanes and reuses a lane once it is free", () => {
    const out = placeVisits(
      [
        v("one", "2026-11-23T14:00:00Z", "2026-11-25T22:00:00Z"),
        v("two", "2026-11-24T14:00:00Z", null),
        v("three", "2026-11-26T14:00:00Z", null),
      ],
      week,
    );
    const by = Object.fromEntries(out.map((p) => [p.visit.id, p]));
    expect(by["one"]!.lane).toBe(0);
    expect(by["two"]!.lane).toBe(1);
    expect(by["three"]!.lane).toBe(0);
  });
  it("leaves out visits outside the row", () => {
    expect(placeVisits([v("x", "2026-12-10T14:00:00Z", null)], week)).toEqual([]);
  });
  it("lists a day's visits in order", () => {
    const list = visitsOn(
      [v("b", "2026-11-24T16:00:00Z", null), v("a", "2026-11-24T14:00:00Z", null), v("z", "2026-11-25T14:00:00Z", null)],
      "2026-11-24",
    );
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
