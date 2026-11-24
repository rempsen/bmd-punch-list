import { describe, expect, test } from "bun:test";
import {
  adjustedLine,
  clockedInLine,
  clockJobs,
  exportRows,
  dollarsToCents,
  entryDay,
  hoursText,
  labourCostCents,
  planAdjust,
  planApprove,
  planClockIn,
  planClockOut,
  planMissedEntry,
  rateFor,
  roundMinutes,
  summariseWeek,
  weekBounds,
  zonedInstant,
  type TimeEntry,
} from "./logic";

const entry = (o: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "e1",
  user_id: "u1",
  project_id: "p1",
  clock_in_at: "2025-11-24T13:02:00.000Z", // 7:02 a.m. Winnipeg. Tests that depend on the clock use 2025: from 2026 the time zone database has Manitoba on daylight time all year.
  clock_out_at: "2025-11-24T21:40:00.000Z", // 3:40 p.m.
  rounded_minutes: 525,
  in_lat: null, in_lng: null, in_accuracy_m: null, out_lat: null, out_lng: null, out_accuracy_m: null,
  note_in: null, note_out: null, source: "clock",
  original: null, adjusted_at: null, adjusted_by: null, adjust_reason: null,
  approved_at: null, approved_by: null,
  qbo_time_activity_id: null, qbo_sent_at: null, qbo_error: null, qbo_attempts: 0,
  ...o,
});

describe("rounding paid time", () => {
  const at = (min: number, sec = 0) => new Date(Date.UTC(2025, 10, 24, 14, 0, 0) + min * 60_000 + sec * 1000).toISOString();
  test("7 minutes rounds down and 8 minutes rounds up to the quarter hour", () => {
    expect(roundMinutes(at(0), at(7))).toBe(0);
    expect(roundMinutes(at(0), at(8))).toBe(15);
    expect(roundMinutes(at(0), at(22))).toBe(15);
    expect(roundMinutes(at(0), at(23))).toBe(30);
    expect(roundMinutes(at(0), at(8 * 60 + 7))).toBe(480);
    expect(roundMinutes(at(0), at(8 * 60 + 8))).toBe(495);
  });
  test("exactly half way goes up", () => {
    expect(roundMinutes(at(0), at(7, 29))).toBe(0);
    expect(roundMinutes(at(0), at(7, 30))).toBe(15);
  });
  test("a shift that crosses midnight is its real length", () => {
    // 10:00 p.m. to 6:10 a.m. Winnipeg
    expect(roundMinutes("2025-11-25T04:00:00Z", "2025-11-25T12:10:00Z")).toBe(495);
  });
  test("zero length, or an out before the in, is zero and never negative", () => {
    expect(roundMinutes(at(0), at(0))).toBe(0);
    expect(roundMinutes(at(30), at(0))).toBe(0);
  });
  test("the increment is a setting; anything unusable falls back to 15", () => {
    expect(roundMinutes(at(0), at(8), 5)).toBe(10);
    expect(roundMinutes(at(0), at(8), 1)).toBe(8);
    expect(roundMinutes(at(0), at(40), 30)).toBe(30);
    expect(roundMinutes(at(0), at(8), 0)).toBe(15);
    expect(roundMinutes(at(0), at(8), Number.NaN)).toBe(15);
  });
});

describe("clocking in and out", () => {
  const now = "2025-11-24T13:02:11.000Z";
  test("clocking in saves the instant, the job, the note and one location reading", () => {
    const p = planClockIn({ open: null, userId: "u1", projectId: "p1", now, note: "  Unit 4 stairs ", location: { lat: 49.8951, lng: -97.1384, accuracy: 12.4 } });
    if (!p.ok) throw new Error(p.reason);
    expect(p.row).toEqual({ user_id: "u1", project_id: "p1", clock_in_at: now, note_in: "Unit 4 stairs", in_lat: 49.8951, in_lng: -97.1384, in_accuracy_m: 12.4, source: "clock", created_by: "u1" });
  });
  test("a refused or failed location still saves the entry, with no location", () => {
    const p = planClockIn({ open: null, userId: "u1", projectId: "p1", now, note: "", location: null });
    if (!p.ok) throw new Error(p.reason);
    expect(p.row).toMatchObject({ in_lat: null, in_lng: null, in_accuracy_m: null, note_in: null });
  });
  test("a nonsense location is dropped, never stored", () => {
    const p = planClockIn({ open: null, userId: "u1", projectId: "p1", now, note: null, location: { lat: 949, lng: -97, accuracy: 5 } });
    if (!p.ok) throw new Error(p.reason);
    expect(p.row.in_lat).toBeNull();
  });
  test("one open entry per person: clocking in while clocked in is refused and names the open entry", () => {
    const open = entry({ id: "open1", clock_out_at: null, rounded_minutes: null, project_id: "p9" });
    const p = planClockIn({ open, userId: "u1", projectId: "p1", now, note: null, location: null });
    expect(p).toEqual({ ok: false, reason: "You are still clocked in on another job. Clock out of it first.", openId: "open1", openProjectId: "p9" });
  });
  test("clocking out stores the exact instant and the rounded minutes", () => {
    const open = entry({ clock_out_at: null, rounded_minutes: null });
    const p = planClockOut({ open, now: "2025-11-24T21:40:30.000Z", increment: 15, note: "done", location: { lat: 49.9, lng: -97.1, accuracy: 30 } });
    if (!p.ok) throw new Error(p.reason);
    expect(p.patch).toEqual({ clock_out_at: "2025-11-24T21:40:30.000Z", rounded_minutes: 525, note_out: "done", out_lat: 49.9, out_lng: -97.1, out_accuracy_m: 30 });
  });
  test("clocking out with nothing open is refused", () => {
    expect(planClockOut({ open: null, now, increment: 15, note: null, location: null })).toEqual({ ok: false, reason: "You are not clocked in." });
  });
});

describe("weeks and days in Winnipeg time", () => {
  test("a wall-clock time becomes the right instant on either side of the clock change", () => {
    expect(zonedInstant("2025-11-01", "08:00")!.toISOString()).toBe("2025-11-01T13:00:00.000Z"); // CDT
    expect(zonedInstant("2025-11-03", "08:00")!.toISOString()).toBe("2025-11-03T14:00:00.000Z"); // CST
    expect(zonedInstant("2026-13-40", "08:00")).toBeNull();
  });
  test("the week the clocks go back is 169 hours long, Monday to Monday", () => {
    const b = weekBounds("2025-10-27");
    expect(b).toEqual({ from: "2025-10-27T05:00:00.000Z", to: "2025-11-03T06:00:00.000Z" });
    expect((Date.parse(b.to) - Date.parse(b.from)) / 3_600_000).toBe(169);
  });
  test("the week the clocks go forward is 167 hours long", () => {
    const b = weekBounds("2025-03-03");
    expect((Date.parse(b.to) - Date.parse(b.from)) / 3_600_000).toBe(167);
  });
  test("an entry belongs to the Winnipeg day it was clocked in on", () => {
    expect(entryDay(entry({ clock_in_at: "2025-11-03T05:30:00Z" }))).toBe("2025-11-02"); // 11:30 p.m. Sunday
    expect(entryDay(entry({ clock_in_at: "2025-11-03T06:00:00Z" }))).toBe("2025-11-03");
  });
  test("totals per day and week across the clock change; the long night is paid as the 9 hours it was", () => {
    const night = { in: "2025-11-02T05:30:00Z", out: "2025-11-02T14:30:00Z" }; // 12:30 a.m. CDT to 8:30 a.m. CST
    const entries = [
      entry({ id: "a", clock_in_at: "2025-10-27T13:00:00Z", clock_out_at: "2025-10-27T21:00:00Z", rounded_minutes: 480 }),
      entry({ id: "b", clock_in_at: night.in, clock_out_at: night.out, rounded_minutes: roundMinutes(night.in, night.out) }),
      entry({ id: "c", clock_in_at: "2025-11-03T05:30:00Z", clock_out_at: "2025-11-03T06:30:00Z", rounded_minutes: 60 }), // Sunday 11:30 p.m.
      entry({ id: "d", user_id: "u2", clock_in_at: "2025-10-28T13:00:00Z", clock_out_at: "2025-10-28T15:00:00Z", rounded_minutes: 120 }),
    ];
    const s = summariseWeek(entries, "2025-10-27", { dailyMinutes: 480, weeklyMinutes: 2400 });
    const u1 = s.people.find((p) => p.userId === "u1")!;
    expect(u1.days["2025-10-27"]).toBe(480);
    expect(u1.days["2025-11-02"]).toBe(540 + 60);
    expect(u1.weekMinutes).toBe(1080);
    expect(s.people.find((p) => p.userId === "u2")!.weekMinutes).toBe(120);
    expect(s.totalMinutes).toBe(1200);
  });
  test("an entry outside the week, or still open, is not counted", () => {
    const s = summariseWeek(
      [
        entry({ id: "old", clock_in_at: "2025-10-26T20:00:00Z", rounded_minutes: 60 }),
        entry({ id: "open", clock_in_at: "2025-10-28T13:00:00Z", clock_out_at: null, rounded_minutes: null }),
      ],
      "2025-10-27",
      { dailyMinutes: 480, weeklyMinutes: 2400 },
    );
    expect(s.totalMinutes).toBe(0);
    expect(s.people).toEqual([{ userId: "u1", days: {}, weekMinutes: 0, overDays: [], overWeek: false, clockedIn: true, entryIds: ["open"] }]);
  });
});

describe("overtime heads-up", () => {
  const day = (id: string, d: string, minutes: number, user = "u1") => entry({ id, user_id: user, clock_in_at: `${d}T14:00:00Z`, clock_out_at: `${d}T22:00:00Z`, rounded_minutes: minutes });
  const limits = { dailyMinutes: 480, weeklyMinutes: 2400 };
  test("a day over the daily limit is flagged; exactly at the limit is not", () => {
    const s = summariseWeek([day("a", "2026-11-23", 480), day("b", "2026-11-24", 495)], "2026-11-23", limits);
    expect(s.people[0]!.overDays).toEqual(["2026-11-24"]);
    expect(s.people[0]!.overWeek).toBe(false);
    expect(s.overtime).toEqual([{ userId: "u1", days: ["2026-11-24"], week: false }]);
  });
  test("two entries on one day add up before the check", () => {
    const s = summariseWeek([day("a", "2026-11-23", 300), day("b", "2026-11-23", 195)], "2026-11-23", limits);
    expect(s.people[0]!.overDays).toEqual(["2026-11-23"]);
  });
  test("a week over the weekly limit is flagged even when no day is", () => {
    const six = ["23", "24", "25", "26", "27", "28"].map((d, i) => day(`e${i}`, `2026-11-${d}`, 450));
    const s = summariseWeek(six, "2026-11-23", limits);
    expect(s.people[0]!.overDays).toEqual([]);
    expect(s.people[0]!.overWeek).toBe(true);
    expect(s.overtime).toEqual([{ userId: "u1", days: [], week: true }]);
  });
  test("the flag never changes the hours", () => {
    const s = summariseWeek([day("a", "2026-11-23", 600)], "2026-11-23", limits);
    expect(s.people[0]!.days["2026-11-23"]).toBe(600);
    expect(s.people[0]!.weekMinutes).toBe(600);
  });
  test("people with nothing over are not listed", () => {
    expect(summariseWeek([day("a", "2026-11-23", 60, "u2")], "2026-11-23", limits).overtime).toEqual([]);
  });
});

describe("the office adjusting an entry", () => {
  const now = "2025-11-25T15:00:00.000Z";
  const change = { clockInAt: "2025-11-24T13:00:00.000Z", clockOutAt: "2025-11-24T21:30:00.000Z", projectId: "p1", reason: "Forgot to clock out at the shop" };
  test("the first adjustment keeps the original in, out, job and paid minutes", () => {
    const p = planAdjust({ entry: entry(), change, by: "boss", now, increment: 15 });
    if (!p.ok) throw new Error(p.reason);
    expect(p.patch).toEqual({
      clock_in_at: change.clockInAt,
      clock_out_at: change.clockOutAt,
      project_id: "p1",
      rounded_minutes: 510,
      original: { clock_in_at: "2025-11-24T13:02:00.000Z", clock_out_at: "2025-11-24T21:40:00.000Z", project_id: "p1", rounded_minutes: 525 },
      adjusted_at: now,
      adjusted_by: "boss",
      adjust_reason: "Forgot to clock out at the shop",
    });
  });
  test("a second adjustment still keeps the very first values", () => {
    const first = { clock_in_at: "2025-11-24T13:02:00.000Z", clock_out_at: "2025-11-24T21:40:00.000Z", project_id: "p1", rounded_minutes: 525 };
    const p = planAdjust({ entry: entry({ clock_in_at: change.clockInAt, original: first, adjusted_at: now, adjusted_by: "boss", adjust_reason: "x" }), change: { ...change, projectId: "p2", reason: "Wrong job" }, by: "boss2", now, increment: 15 });
    if (!p.ok) throw new Error(p.reason);
    expect(p.patch.original).toEqual(first);
    expect(p.patch.project_id).toBe("p2");
    expect(p.patch.adjusted_by).toBe("boss2");
  });
  test("a reason is required", () => {
    expect(planAdjust({ entry: entry(), change: { ...change, reason: "  " }, by: "boss", now, increment: 15 })).toEqual({ ok: false, reason: "Say briefly why this is being changed." });
  });
  test("the out cannot be before the in", () => {
    expect(planAdjust({ entry: entry(), change: { ...change, clockOutAt: "2025-11-24T12:00:00.000Z" }, by: "boss", now, increment: 15 })).toEqual({ ok: false, reason: "The clock-out is before the clock-in." });
  });
  test("an approved entry is locked", () => {
    expect(planAdjust({ entry: entry({ approved_at: now, approved_by: "boss" }), change, by: "boss", now, increment: 15 })).toEqual({ ok: false, reason: "This entry is approved. Remove the approval before changing it." });
  });
  test("an entry already in QuickBooks can never be changed here", () => {
    expect(planAdjust({ entry: entry({ approved_at: now, qbo_time_activity_id: "88" }), change, by: "boss", now, increment: 15 })).toEqual({ ok: false, reason: "This entry has been sent to QuickBooks and can no longer be changed here." });
  });
  test("an open entry can be closed by the office (someone forgot to clock out)", () => {
    const p = planAdjust({ entry: entry({ clock_out_at: null, rounded_minutes: null }), change, by: "boss", now, increment: 15 });
    if (!p.ok) throw new Error(p.reason);
    expect(p.patch.original).toEqual({ clock_in_at: "2025-11-24T13:02:00.000Z", clock_out_at: null, project_id: "p1", rounded_minutes: null });
    expect(p.patch.rounded_minutes).toBe(510);
  });
  test("a missed entry is added closed, marked as the office's, with the reason", () => {
    const p = planMissedEntry({ userId: "u1", change, by: "boss", now, increment: 15 });
    if (!p.ok) throw new Error(p.reason);
    expect(p.row).toEqual({ user_id: "u1", project_id: "p1", clock_in_at: change.clockInAt, clock_out_at: change.clockOutAt, rounded_minutes: 510, source: "office", created_by: "boss", adjusted_at: now, adjusted_by: "boss", adjust_reason: "Forgot to clock out at the shop" });
    expect(planMissedEntry({ userId: "u1", change: { ...change, clockOutAt: null }, by: "boss", now, increment: 15 })).toEqual({ ok: false, reason: "A missed entry needs both a clock-in and a clock-out." });
  });
  test('the original is shown as "Adjusted by … from 7:02–3:40"', () => {
    const e = entry({ original: { clock_in_at: "2025-11-24T13:02:00.000Z", clock_out_at: "2025-11-24T21:40:00.000Z", project_id: "p1", rounded_minutes: 525 }, adjusted_by: "boss", adjust_reason: "Forgot" });
    expect(adjustedLine(e, "Dana")).toBe("Adjusted by Dana from 7:02 a.m.–3:40 p.m. · Forgot");
    expect(adjustedLine(entry({ source: "office", adjusted_by: "boss", adjust_reason: "Phone was dead" }), "Dana")).toBe("Added by Dana · Phone was dead");
    expect(adjustedLine(entry(), "Dana")).toBeNull();
  });
});

describe("approving", () => {
  const now = "2025-11-25T15:00:00.000Z";
  test("closed entries are approved; open ones are left with the reason", () => {
    const p = planApprove({ entries: [entry({ id: "a" }), entry({ id: "b", clock_out_at: null, rounded_minutes: null }), entry({ id: "c", approved_at: now })], approve: true, by: "boss", now });
    expect(p.ids).toEqual(["a"]);
    expect(p.patch).toEqual({ approved_at: now, approved_by: "boss" });
    expect(p.skipped).toEqual([{ id: "b", reason: "Still clocked in" }]);
  });
  test("approval can be removed until the entry has gone to QuickBooks", () => {
    const p = planApprove({ entries: [entry({ id: "a", approved_at: now }), entry({ id: "b", approved_at: now, qbo_time_activity_id: "88" })], approve: false, by: "boss", now });
    expect(p.ids).toEqual(["a"]);
    expect(p.patch).toEqual({ approved_at: null, approved_by: null });
    expect(p.skipped).toEqual([{ id: "b", reason: "Already sent to QuickBooks" }]);
  });
});

describe("rates: unknown is not zero", () => {
  test("a job's own billable rate wins, then the person's default, else unknown", () => {
    expect(rateFor({ billable_rate_cents: 8500 }, { billable_rate_cents: 9500 })).toBe(9500);
    expect(rateFor({ billable_rate_cents: 8500 }, null)).toBe(8500);
    expect(rateFor({ billable_rate_cents: 8500 }, { billable_rate_cents: null })).toBe(8500);
    expect(rateFor({ billable_rate_cents: null }, null)).toBeNull();
    expect(rateFor(null, undefined)).toBeNull();
  });
  test("a rate of zero is a real rate, not unknown", () => {
    expect(rateFor({ billable_rate_cents: 8500 }, { billable_rate_cents: 0 })).toBe(0);
    expect(rateFor({ billable_rate_cents: 0 }, null)).toBe(0);
  });
  test("labour cost is hours times cost, and unknown when the cost is unknown", () => {
    expect(labourCostCents(510, 3250)).toBe(27625);
    expect(labourCostCents(510, null)).toBeNull();
    expect(labourCostCents(510, undefined)).toBeNull();
    expect(labourCostCents(510, 0)).toBe(0);
    expect(labourCostCents(null, 3250)).toBeNull();
  });
  test("typed dollars become cents; blank stays unknown and rubbish is refused", () => {
    expect(dollarsToCents("32.50")).toEqual({ ok: true, cents: 3250 });
    expect(dollarsToCents(" $1,250 ")).toEqual({ ok: true, cents: 125000 });
    expect(dollarsToCents("0")).toEqual({ ok: true, cents: 0 });
    expect(dollarsToCents("")).toEqual({ ok: true, cents: null });
    expect(dollarsToCents("abc")).toEqual({ ok: false });
    expect(dollarsToCents("-5")).toEqual({ ok: false });
  });
});

describe("small words", () => {
  test("hours read as decimals of an hour", () => {
    expect(hoursText(525)).toBe("8.75");
    expect(hoursText(0)).toBe("0.00");
    expect(hoursText(null)).toBe("—");
  });
  test("who is clocked in on a job", () => {
    expect(clockedInLine([])).toBeNull();
    expect(clockedInLine(["Ana"])).toBe("1 clocked in: Ana");
    expect(clockedInLine(["Ben", "Ana"])).toBe("2 clocked in: Ana, Ben");
  });
});

describe("choosing the job to clock in on", () => {
  const jobs = [
    { id: "a", name: "Quote only", project_number: null, stage: "quote_out", archived_at: null },
    { id: "b", name: "Zed Tower", project_number: "24-010", stage: "in_progress", archived_at: null },
    { id: "c", name: "Old Mall", project_number: null, stage: "closed", archived_at: null },
    { id: "d", name: "Archived", project_number: null, stage: "in_progress", archived_at: "2025-01-01" },
    { id: "e", name: "Shop time", project_number: null, stage: "closed", archived_at: null, kind: "internal" },
    { id: "f", name: "Alpha Flats", project_number: null, stage: "won", archived_at: null },
    { id: "g", name: "Lost one", project_number: null, stage: "lost", archived_at: null },
  ];
  test("open jobs first, then Internal jobs, then the rest; closed, lost and archived are left out", () => {
    expect(clockJobs(jobs).map((j) => j.id)).toEqual(["f", "b", "e", "a"]);
    expect(clockJobs(jobs).map((j) => j.group)).toEqual(["open", "open", "internal", "other"]);
  });
  test("works the same when there is no kind column yet", () => {
    expect(clockJobs(jobs.map(({ kind: _k, ...j }) => j)).map((j) => j.id)).toEqual(["f", "b", "a"]);
  });
});

describe("the week as a spreadsheet", () => {
  const e = entry({ in_lat: 49.9, in_lng: -97.1, note_in: "Stairs", note_out: "Done", approved_at: "2025-11-25T15:00:00.000Z", approved_by: "boss", original: { clock_in_at: "2025-11-24T13:00:00.000Z", clock_out_at: "2025-11-24T21:40:00.000Z", project_id: "p1", rounded_minutes: 525 }, adjusted_by: "boss", adjust_reason: "Late start" });
  const names = new Map([["u1", "Ana Crew"], ["boss", "Dana"]]);
  const jobNames = new Map([["p1", "Hyatt Centric"]]);
  test("one row per entry with exact times, rounded hours, notes, locations and status", () => {
    expect(exportRows([e], names, jobNames, null)).toEqual([
      { Person: "Ana Crew", Date: "2025-11-24", Job: "Hyatt Centric", In: "7:02 a.m.", Out: "3:40 p.m.", "Paid hours": 8.75, Notes: "Stairs; Done", "In location": "https://www.google.com/maps?q=49.9,-97.1", "Out location": "No location", Adjusted: "Adjusted by Dana from 7:00 a.m.–3:40 p.m. · Late start", Approved: "Yes", QuickBooks: "Not sent" },
    ]);
  });
  test("labour cost is a column only when rates are passed in (people who see pricing), and unknown stays Unknown", () => {
    const known = exportRows([e], names, jobNames, new Map([["u1", { hourly_cost_cents: 3200, billable_rate_cents: null }]]));
    expect(known[0]!["Labour cost"]).toBe(280);
    const unknown = exportRows([e], names, jobNames, new Map());
    expect(unknown[0]!["Labour cost"]).toBe("Unknown");
    expect(exportRows([e], names, jobNames, null)[0]).not.toHaveProperty("Labour cost");
  });
  test("an open entry has no out and no hours", () => {
    const r = exportRows([entry({ clock_out_at: null, rounded_minutes: null })], names, jobNames, null)[0]!;
    expect(r.Out).toBe("Still clocked in");
    expect(r["Paid hours"]).toBe("");
  });
});
