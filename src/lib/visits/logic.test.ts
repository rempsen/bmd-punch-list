import { describe, expect, test } from "bun:test";
import { AP_LABEL, applyInboundEvent, crewLabel, crewStatusGroups, applyVisitEvent, arrivepingBadge, arrivepingPill, inboundEventKey, parseArrivePingEvent, scheduleRange, secretMatches, updatedAt, visitRange, visitTimes, visitsCsv } from "./logic";

const visit = { id: "11111111-1111-1111-1111-111111111111", starts_at: "2026-12-01T14:00:00Z", ends_at: "2026-12-01T22:00:00Z", crew: "Brodie + 2", notes: "Level 2, rooms 201-212", site_contact: "Pat Client 204-555-0100", arriveping_job_id: "AP-77", status: "scheduled" as const, arriveping_status: null, arriveping_assigned_to: null, arriveping_last_event_at: null };

describe("ArrivePing webhook", () => {
  test("a missing or wrong secret is refused; the right one is accepted", () => {
    expect(secretMatches("s3cret-value", "s3cret-value")).toBe(true);
    expect(secretMatches("s3cret-valuX", "s3cret-value")).toBe(false);
    expect(secretMatches("", "s3cret-value")).toBe(false);
    expect(secretMatches(null, "s3cret-value")).toBe(false);
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches("anything", undefined)).toBe(false);
  });
  test("reads the event and which visit it is about, in the shapes ArrivePing may send", () => {
    expect(parseArrivePingEvent({ event: "arrived", job_id: "AP-77", occurred_at: "2026-12-01T14:05:00Z" })).toEqual({ kind: "status", status: "arrived", jobId: "AP-77", visitId: null, at: "2026-12-01T14:05:00Z" });
    expect(parseArrivePingEvent({ type: "job.en_route", data: { jobId: 77, external_id: visit.id } })).toEqual({ kind: "status", status: "en_route", jobId: "77", visitId: visit.id, at: null });
    expect(parseArrivePingEvent({ event: "Completed", external_id: visit.id })).toMatchObject({ kind: "status", status: "completed", visitId: visit.id });
    expect(parseArrivePingEvent({ event: "something_else", job_id: "AP-77" })).toBeNull();
    expect(parseArrivePingEvent({ event: "arrived" })).toBeNull();
    expect(parseArrivePingEvent("nope")).toBeNull();
  });
  test("an arrival moves the visit on and says so for the activity list; a finished visit does not go backwards", () => {
    expect(applyVisitEvent(visit, "arrived")).toEqual({ status: "arrived", note: "Crew arrived on site (Brodie + 2)" });
    expect(applyVisitEvent({ ...visit, status: "arrived" }, "completed")).toEqual({ status: "completed", note: "Install visit completed (Brodie + 2)" });
    expect(applyVisitEvent({ ...visit, status: "completed" }, "arrived")).toBeNull();
    expect(applyVisitEvent({ ...visit, status: "arrived" }, "arrived")).toBeNull();
    expect(applyVisitEvent({ ...visit, status: "cancelled" }, "arrived")).toBeNull();
  });
});

describe("ArrivePing webhook: assignment and rescheduling", () => {
  test("an assignment names the tech from whichever field ArrivePing used", () => {
    expect(parseArrivePingEvent({ event: "workorder.assigned", data: { job_id: 77, tech: { name: "Brodie" } } })).toEqual({ kind: "assigned", assignee: "Brodie", jobId: "77", visitId: null, at: null });
    expect(parseArrivePingEvent({ type: "job.assigned", job_id: "AP-77", data: { assigned_to: "  Sam Lee " } })).toMatchObject({ kind: "assigned", assignee: "Sam Lee", jobId: "AP-77" });
    expect(parseArrivePingEvent({ type: "job:assigned", external_id: visit.id, data: { assignee: { name: "Kim" } } })).toMatchObject({ kind: "assigned", assignee: "Kim", visitId: visit.id });
  });
  test("an unassignment clears the tech; an assignment that names nobody is not guessed at", () => {
    expect(parseArrivePingEvent({ event: "workorder.unassigned", job_id: "AP-77", data: { tech: { name: "Brodie" } } })).toEqual({ kind: "assigned", assignee: null, jobId: "AP-77", visitId: null, at: null });
    expect(parseArrivePingEvent({ event: "workorder.assigned", job_id: "AP-77" })).toBeNull();
    expect(parseArrivePingEvent({ event: "workorder.assigned", job_id: "AP-77", data: { assigned_to: "   " } })).toBeNull();
  });
  test("a reschedule carries the new times as ISO strings", () => {
    expect(parseArrivePingEvent({ event: "workorder.rescheduled", job_id: "AP-77", data: { start_at: "2026-12-03T08:00:00-06:00", end_at: "2026-12-03T16:00:00-06:00" } })).toEqual({ kind: "rescheduled", startsAt: "2026-12-03T14:00:00.000Z", endsAt: "2026-12-03T22:00:00.000Z", jobId: "AP-77", visitId: null, at: null });
    expect(parseArrivePingEvent({ type: "job.reschedule", job_id: "AP-77", starts_at: "2026-12-03T14:00:00Z", occurred_at: "2026-12-02T10:00:00Z" })).toEqual({ kind: "rescheduled", startsAt: "2026-12-03T14:00:00.000Z", endsAt: null, jobId: "AP-77", visitId: null, at: "2026-12-02T10:00:00Z" });
    expect(parseArrivePingEvent({ event: "rescheduled", job_id: "AP-77", data: { start: "2026-12-03T14:00:00Z", ends_at: "2026-12-03T22:00:00Z" } })).toMatchObject({ startsAt: "2026-12-03T14:00:00.000Z", endsAt: "2026-12-03T22:00:00.000Z" });
  });
  test("a reschedule with a missing, unreadable or backwards time is refused", () => {
    expect(parseArrivePingEvent({ event: "workorder.rescheduled", job_id: "AP-77", data: { start_at: "2026-12-03T16:00:00Z", end_at: "2026-12-03T08:00:00Z" } })).toBeNull();
    expect(parseArrivePingEvent({ event: "workorder.rescheduled", job_id: "AP-77", data: { start_at: "next tuesday" } })).toBeNull();
    expect(parseArrivePingEvent({ event: "workorder.rescheduled", job_id: "AP-77", data: { start_at: "2026-12-03T08:00:00Z", end_at: "soon" } })).toBeNull();
    expect(parseArrivePingEvent({ event: "workorder.rescheduled", job_id: "AP-77" })).toBeNull();
  });
  test("the contracted envelope: full work order in data, techs as a list, ids from data.id / work_order_id / external_ref", () => {
    const envelope = { id: "evt_01J", type: "workorder.assigned", occurred_at: "2026-12-01T14:03:11Z", data: { id: "wo_9", external_source: "bmd_projects", external_ref: visit.id, reference: "26-002", assigned_techs: [{ id: "t1", name: "Brodie" }, { id: "t2", name: "Sam" }] } };
    expect(parseArrivePingEvent(envelope)).toEqual({ kind: "assigned", assignee: "Brodie, Sam", jobId: "wo_9", visitId: visit.id, at: "2026-12-01T14:03:11Z" });
    expect(parseArrivePingEvent({ ...envelope, data: { ...envelope.data, assigned_techs: [] } })).toMatchObject({ kind: "assigned", assignee: null });
    expect(parseArrivePingEvent({ ...envelope, type: "workorder.unassigned", data: { ...envelope.data, assigned_techs: [{ name: "Sam" }] } })).toMatchObject({ kind: "assigned", assignee: "Sam" });
    expect(parseArrivePingEvent({ type: "workorder.rescheduled", data: { work_order_id: "wo_7", start_at: "2026-12-03T14:00:00Z" } })).toMatchObject({ kind: "rescheduled", jobId: "wo_7" });
    expect(parseArrivePingEvent({ type: "tech.arrived", external_ref: visit.id })).toMatchObject({ kind: "status", status: "arrived", visitId: visit.id, jobId: null });
    expect(parseArrivePingEvent({ type: "tech.arrived", data: { external_ref: "visit_8f1" } })).toBeNull();
    // The event's own id is never mistaken for the work order's.
    expect(parseArrivePingEvent({ id: "evt_1", type: "tech.arrived" })).toBeNull();
  });
  test("an event id becomes the replay key; anything else gets none", () => {
    expect(inboundEventKey({ id: "evt_123", event: "arrived" })).toBe("ap-evt-evt_123");
    expect(inboundEventKey({ event_id: "abc" })).toBe("ap-evt-abc");
    expect(inboundEventKey({ id: 42 })).toBeNull();
    expect(inboundEventKey({ id: "   " })).toBeNull();
    expect(inboundEventKey({ id: "x".repeat(201) })).toBeNull();
    expect(inboundEventKey(null)).toBeNull();
  });
});

describe("applying an ArrivePing event to a visit", () => {
  const now = "2026-12-02T12:00:00.000Z";
  const v = { ...visit, arriveping_assigned_to: null as string | null };
  test("a status change moves the visit on and records what ArrivePing said and when", () => {
    const ev = { kind: "status" as const, status: "arrived" as const, jobId: "AP-77", visitId: null, at: "2026-12-01T14:05:00Z" };
    expect(applyInboundEvent(v, ev, now)).toEqual({ ok: true, patch: { status: "arrived", arriveping_status: "arrived", arriveping_last_event_at: "2026-12-01T14:05:00.000Z" }, event: { status: "arrived", note: "Crew arrived on site (Brodie + 2)", at: "2026-12-01T14:05:00.000Z" } });
    expect(applyInboundEvent({ ...v, status: "completed" }, ev, now)).toEqual({ ok: false, reason: "no change" });
  });
  test("the first event for a visit found by reference ties ArrivePing's job id to it", () => {
    const ev = { kind: "status" as const, status: "en_route" as const, jobId: "AP-99", visitId: visit.id, at: null };
    const r = applyInboundEvent({ ...v, arriveping_job_id: null }, ev, now);
    expect(r).toMatchObject({ ok: true, patch: { arriveping_job_id: "AP-99", arriveping_last_event_at: now } });
    expect(applyInboundEvent(v, ev, now)).not.toHaveProperty("patch.arriveping_job_id");
  });
  test("an unreadable event time falls back to now", () => {
    const ev = { kind: "status" as const, status: "arrived" as const, jobId: "AP-77", visitId: null, at: "yesterday-ish" };
    expect(applyInboundEvent(v, ev, now)).toMatchObject({ patch: { arriveping_last_event_at: now }, event: { at: now } });
  });
  test("an assignment names the tech, and marks a scheduled visit assigned", () => {
    const ev = { kind: "assigned" as const, assignee: "Brodie", jobId: "AP-77", visitId: null, at: null };
    expect(applyInboundEvent(v, ev, now)).toEqual({ ok: true, patch: { arriveping_assigned_to: "Brodie", arriveping_status: "assigned", arriveping_last_event_at: now }, event: { status: "assigned", note: "Assigned to Brodie in ArrivePing", at: now } });
  });
  test("a reassignment while the crew is out keeps ArrivePing's live status as it is", () => {
    const ev = { kind: "assigned" as const, assignee: "Sam", jobId: "AP-77", visitId: null, at: null };
    const r = applyInboundEvent({ ...v, status: "en_route", arriveping_assigned_to: "Brodie" }, ev, now);
    expect(r).toEqual({ ok: true, patch: { arriveping_assigned_to: "Sam", arriveping_last_event_at: now }, event: { status: "assigned", note: "Assigned to Sam in ArrivePing", at: now } });
  });
  test("an unassignment clears the tech and puts a scheduled visit back to scheduled", () => {
    const ev = { kind: "assigned" as const, assignee: null, jobId: "AP-77", visitId: null, at: null };
    expect(applyInboundEvent({ ...v, arriveping_assigned_to: "Brodie" }, ev, now)).toEqual({ ok: true, patch: { arriveping_assigned_to: null, arriveping_status: "scheduled", arriveping_last_event_at: now }, event: { status: "unassigned", note: "Unassigned in ArrivePing", at: now } });
  });
  test("a repeated assignment, or one for a finished visit, changes nothing", () => {
    const ev = { kind: "assigned" as const, assignee: "Brodie", jobId: "AP-77", visitId: null, at: null };
    expect(applyInboundEvent({ ...v, arriveping_assigned_to: "Brodie" }, ev, now)).toEqual({ ok: false, reason: "no change" });
    expect(applyInboundEvent({ ...v, status: "completed" }, ev, now)).toEqual({ ok: false, reason: "no change" });
    expect(applyInboundEvent({ ...v, status: "cancelled" }, ev, now)).toEqual({ ok: false, reason: "no change" });
    expect(applyInboundEvent(v, { ...ev, assignee: null }, now)).toEqual({ ok: false, reason: "no change" });
  });
  test("an assignment or reschedule older than the last event applied is stale and changes nothing", () => {
    const seen = { ...v, arriveping_last_event_at: "2026-12-02T10:00:00.000Z" };
    const assigned = { kind: "assigned" as const, assignee: "Sam", jobId: "AP-77", visitId: null, at: "2026-12-02T09:59:59Z" };
    const moved = { kind: "rescheduled" as const, startsAt: "2026-12-05T14:00:00.000Z", endsAt: null, jobId: "AP-77", visitId: null, at: "2026-12-02T09:00:00Z" };
    expect(applyInboundEvent(seen, assigned, now)).toEqual({ ok: false, reason: "stale" });
    expect(applyInboundEvent(seen, moved, now)).toEqual({ ok: false, reason: "stale" });
  });
  test("an event at the same time or later than the last one is applied; one with no time counts as now", () => {
    const seen = { ...v, arriveping_last_event_at: "2026-12-02T10:00:00.000Z" };
    const ev = { kind: "assigned" as const, assignee: "Sam", jobId: "AP-77", visitId: null, at: "2026-12-02T10:00:00Z" };
    expect(applyInboundEvent(seen, ev, now)).toMatchObject({ ok: true, patch: { arriveping_assigned_to: "Sam", arriveping_last_event_at: "2026-12-02T10:00:00.000Z" } });
    expect(applyInboundEvent(seen, { ...ev, at: "2026-12-02T11:00:00Z" }, now)).toMatchObject({ ok: true, patch: { arriveping_last_event_at: "2026-12-02T11:00:00.000Z" } });
    expect(applyInboundEvent(seen, { ...ev, at: null }, now)).toMatchObject({ ok: true, patch: { arriveping_last_event_at: now } });
  });
  test("a late status event still moves the visit forward but never winds the last-event time back", () => {
    const seen = { ...v, arriveping_last_event_at: "2026-12-02T10:00:00.000Z" };
    const ev = { kind: "status" as const, status: "arrived" as const, jobId: "AP-77", visitId: null, at: "2026-12-02T09:00:00Z" };
    expect(applyInboundEvent(seen, ev, now)).toMatchObject({ ok: true, patch: { status: "arrived", arriveping_last_event_at: "2026-12-02T10:00:00.000Z" }, event: { at: "2026-12-02T09:00:00.000Z" } });
  });
  test("a reschedule moves the visit's times and says where to", () => {
    const ev = { kind: "rescheduled" as const, startsAt: "2026-12-03T09:00:00.000Z", endsAt: "2026-12-03T17:00:00.000Z", jobId: "AP-77", visitId: null, at: null };
    const r = applyInboundEvent(v, ev, now, "UTC");
    expect(r).toMatchObject({ ok: true, patch: { starts_at: "2026-12-03T09:00:00.000Z", ends_at: "2026-12-03T17:00:00.000Z", arriveping_last_event_at: now }, event: { status: "rescheduled", at: now } });
    if (!r.ok) throw new Error("expected a change");
    expect(r.event.note.replace(/\s/g, " ")).toBe("Rescheduled in ArrivePing to Dec 3, 2026, 9:00 a.m.–5:00 p.m.");
  });
  test("a reschedule with only a new start moves the old end by the same amount", () => {
    const ev = { kind: "rescheduled" as const, startsAt: "2026-12-04T15:00:00.000Z", endsAt: null, jobId: "AP-77", visitId: null, at: null };
    const r = applyInboundEvent(v, ev, now, "UTC");
    expect(r).toMatchObject({ ok: true, patch: { starts_at: "2026-12-04T15:00:00.000Z", ends_at: "2026-12-04T23:00:00.000Z" } });
    if (!r.ok) throw new Error("expected a change");
    expect(r.event.note.replace(/\s/g, " ")).toBe("Rescheduled in ArrivePing to Dec 4, 2026, 3:00–11:00 p.m.");
  });
  test("a reschedule with only a new start leaves the end empty when the visit had none", () => {
    const ev = { kind: "rescheduled" as const, startsAt: "2026-12-04T14:00:00.000Z", endsAt: null, jobId: "AP-77", visitId: null, at: null };
    expect(applyInboundEvent({ ...v, ends_at: null }, ev, now)).toMatchObject({ ok: true, patch: { starts_at: "2026-12-04T14:00:00.000Z", ends_at: null } });
  });
  test("a reschedule to the same times, or of a finished visit, changes nothing", () => {
    const same = { kind: "rescheduled" as const, startsAt: "2026-12-01T14:00:00.000Z", endsAt: "2026-12-01T22:00:00.000Z", jobId: "AP-77", visitId: null, at: null };
    expect(applyInboundEvent(v, same, now)).toEqual({ ok: false, reason: "no change" });
    expect(applyInboundEvent({ ...v, status: "cancelled" }, { ...same, startsAt: "2026-12-05T14:00:00.000Z", endsAt: null }, now)).toEqual({ ok: false, reason: "no change" });
    expect(applyInboundEvent({ ...v, status: "completed" }, { ...same, startsAt: "2026-12-05T14:00:00.000Z", endsAt: null }, now)).toEqual({ ok: false, reason: "no change" });
    expect(applyInboundEvent(v, { ...same, endsAt: null }, now)).toEqual({ ok: false, reason: "no change" });
  });
  test("schedule ranges read naturally: one day once, two days in full, no end left off", () => {
    expect(scheduleRange("2026-12-03T09:00:00Z", "2026-12-03T17:00:00Z", "UTC")).toMatch(/^Dec 3, 2026, 9:00\sa\.m\.\s*[–-]\s*5:00\sp\.m\.$/);
    expect(scheduleRange("2026-12-03T14:00:00Z", "2026-12-04T22:00:00Z", "UTC")).toMatch(/^Dec 3, 2026, 2:00\sp\.m\.\s*[–-]\s*Dec 4, 2026, 10:00\sp\.m\.$/);
    expect(scheduleRange("2026-12-03T14:00:00Z", null, "UTC")).toMatch(/^Dec 3, 2026, 2:00\sp\.m\.$/);
  });
  test("schedule ranges are in Winnipeg time unless told otherwise, whatever zone the server runs in", () => {
    expect(scheduleRange("2026-12-03T14:00:00Z", "2026-12-03T22:00:00Z")).toBe(scheduleRange("2026-12-03T14:00:00Z", "2026-12-03T22:00:00Z", "America/Winnipeg"));
    expect(scheduleRange("2026-12-03T14:00:00Z", null)).not.toBe(scheduleRange("2026-12-03T14:00:00Z", null, "UTC"));
  });
});

describe("visit export", () => {
  test("a CSV ArrivePing can import, with commas and quotes kept intact", () => {
    const csv = visitsCsv([{ ...visit, notes: 'Bring 4" base, adhesive' }], { name: "Hyatt Centric", number: "26-041", address: "325 Broadway, Winnipeg, MB", client: "Kothari Group" });
    const [head, row] = csv.split("\r\n");
    expect(head).toBe("Reference,Project,Client,Address,Start,End,Crew,Site contact,Notes");
    expect(row).toBe(`${visit.id},26-041 Hyatt Centric,Kothari Group,"325 Broadway, Winnipeg, MB",2026-12-01T14:00:00Z,2026-12-01T22:00:00Z,Brodie + 2,Pat Client 204-555-0100,"Bring 4"" base, adhesive"`);
  });
});

describe("polish: export safety", () => {
  test("a cell that a spreadsheet would run as a formula is exported as plain text", () => {
    const csv = visitsCsv([{ ...visit, notes: "=HYPERLINK(\"http://x\")", crew: "+1 crew", site_contact: "@pat" }], { name: "Job", number: null, address: null, client: "-Client" });
    const row = csv.split("\r\n")[1]!;
    expect(row).toContain(",'+1 crew,'@pat,");
    expect(row).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(row).toContain(",'-Client,");
  });
});

describe("scheduling a visit", () => {
  const H = 3600_000;
  const wall = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  test("what the estimator types is site time in Winnipeg, whatever zone the browser is in", () => {
    const r = visitTimes({ date: "2026-12-01", start: "08:00", end: "16:00" });
    if ("error" in r) throw new Error(r.error);
    expect(wall(r.startsAt, "America/Winnipeg")).toBe("2026-12-01, 08:00");
    expect(wall(r.endsAt!, "America/Winnipeg")).toBe("2026-12-01, 16:00");
    expect(r).toEqual(visitTimes({ date: "2026-12-01", start: "08:00", end: "16:00" }, "America/Winnipeg"));
  });
  test("a fixed-offset zone and UTC give exact instants", () => {
    const six = visitTimes({ date: "2026-12-01", start: "08:00", end: "16:00" }, "Etc/GMT+6");
    if ("error" in six) throw new Error(six.error);
    expect(six.startsAt.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    const utc = visitTimes({ date: "2026-12-01", start: "08:00", end: "16:00" }, "UTC");
    if ("error" in utc) throw new Error(utc.error);
    expect(utc.startsAt.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(utc.endsAt!.toISOString()).toBe("2026-12-01T16:00:00.000Z");
  });
  test("daylight saving is taken from the date itself", () => {
    const winter = visitTimes({ date: "2026-12-01", start: "08:00", end: "" }, "Europe/London");
    const summer = visitTimes({ date: "2026-07-01", start: "08:00", end: "" }, "Europe/London");
    if ("error" in winter || "error" in summer) throw new Error("expected times");
    expect(winter.startsAt.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(summer.startsAt.toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });
  test("a multi-day visit runs from the first day's start to the last day's end", () => {
    const r = visitTimes({ date: "2026-12-01", endDate: "2026-12-04", start: "08:00", end: "16:00" });
    if ("error" in r) throw new Error(r.error);
    expect(wall(r.startsAt, "America/Winnipeg")).toBe("2026-12-01, 08:00");
    expect(wall(r.endsAt!, "America/Winnipeg")).toBe("2026-12-04, 16:00");
    expect(r.endsAt!.getTime() - r.startsAt.getTime()).toBe((3 * 24 + 8) * H);
  });
  test("the end date defaults to the start date", () => {
    const r = visitTimes({ date: "2026-12-01", start: "08:00", end: "16:00" });
    if ("error" in r) throw new Error(r.error);
    expect(r.endsAt!.getTime() - r.startsAt.getTime()).toBe(8 * H);
    expect(visitTimes({ date: "2026-12-01", endDate: "", start: "08:00", end: "16:00" })).toEqual(r);
  });
  test("no end time means no end", () => {
    const r = visitTimes({ date: "2026-12-01", endDate: "2026-12-04", start: "08:00", end: "" });
    if ("error" in r) throw new Error(r.error);
    expect(r.endsAt).toBeNull();
  });
  test("a missing date or start, or an end before the start, is refused with a clear message", () => {
    expect(visitTimes({ date: "", start: "08:00", end: "16:00" })).toEqual({ error: "Choose a date and start time." });
    expect(visitTimes({ date: "2026-12-01", start: "", end: "16:00" })).toEqual({ error: "Choose a date and start time." });
    expect(visitTimes({ date: "2026-12-01", start: "08:00", end: "07:00" })).toEqual({ error: "The end is before the start." });
    expect(visitTimes({ date: "2026-12-04", endDate: "2026-12-01", start: "08:00", end: "16:00" })).toEqual({ error: "The end is before the start." });
  });
});

describe("ArrivePing status on a visit", () => {
  const linked = { arriveping_job_id: "wo_9", arriveping_status: "scheduled", arriveping_assigned_to: null };
  test("labels read the way the crew says them", () => {
    expect(AP_LABEL).toMatchObject({ scheduled: "Scheduled", assigned: "Assigned", en_route: "On the way", arrived: "On site", completed: "Completed", cancelled: "Cancelled", cancel_requested: "Cancel requested" });
  });
  test("an assignment names the tech", () => {
    expect(arrivepingBadge({ ...linked, arriveping_status: "assigned", arriveping_assigned_to: "Brodie" })).toBe("Assigned to Brodie");
    expect(arrivepingBadge({ ...linked, arriveping_status: "assigned" })).toBe("Assigned");
  });
  test("a live status uses its label; a fresh work order says where it is", () => {
    expect(arrivepingBadge({ ...linked, arriveping_status: "en_route", arriveping_assigned_to: "Brodie" })).toBe("On the way");
    expect(arrivepingBadge(linked)).toBe("Scheduled in ArrivePing");
    expect(arrivepingBadge({ ...linked, arriveping_status: "cancel_requested" })).toBe("Cancel requested");
    expect(arrivepingBadge({ ...linked, arriveping_status: null })).toBe("In ArrivePing");
    expect(arrivepingBadge({ ...linked, arriveping_status: "on_hold" })).toBe("In ArrivePing");
  });
  test("a visit never sent to ArrivePing has no badge", () => {
    expect(arrivepingBadge({ ...linked, arriveping_job_id: null })).toBeNull();
    expect(arrivepingBadge({ arriveping_job_id: null, arriveping_status: "assigned", arriveping_assigned_to: "Brodie" })).toBeNull();
  });
});

describe("a visit's dates on its row", () => {
  const sp = (s: string) => s.replace(/\s/g, " ");
  test("one day reads as the day and its hours", () => {
    expect(sp(visitRange("2026-12-01T08:00:00Z", "2026-12-01T16:00:00Z", "UTC"))).toMatch(/^Dec 1, 2026, 8:00 a\.m\. ?[–-] ?4:00 p\.m\.$/);
  });
  test("several days read as the day range, then the daily hours", () => {
    expect(sp(visitRange("2026-12-01T08:00:00Z", "2026-12-04T16:00:00Z", "UTC"))).toBe("Dec 1 – Dec 4, 8:00 a.m. – 4:00 p.m.");
  });
  test("a range across a new year names both years", () => {
    expect(sp(visitRange("2026-12-30T08:00:00Z", "2027-01-02T16:00:00Z", "UTC"))).toBe("Dec 30, 2026 – Jan 2, 2027, 8:00 a.m. – 4:00 p.m.");
  });
  test("no end shows just the start", () => {
    expect(sp(visitRange("2026-12-01T08:00:00Z", null, "UTC"))).toBe("Dec 1, 2026, 8:00 a.m.");
  });
});

describe("the ArrivePing pill beside the visit's status", () => {
  const v = { status: "scheduled" as const, arriveping_job_id: "wo_9", arriveping_status: "scheduled", arriveping_assigned_to: null };
  test("hidden when it only repeats the visit's own status, or when the visit was never sent", () => {
    expect(arrivepingPill({ ...v, status: "en_route", arriveping_status: "en_route" })).toBeNull();
    expect(arrivepingPill({ ...v, status: "arrived", arriveping_status: "arrived" })).toBeNull();
    expect(arrivepingPill({ ...v, arriveping_job_id: null })).toBeNull();
  });
  test("shown when it adds something", () => {
    expect(arrivepingPill(v)).toBe("Scheduled in ArrivePing");
    expect(arrivepingPill({ ...v, arriveping_status: "assigned", arriveping_assigned_to: "Brodie" })).toBe("Assigned to Brodie");
    expect(arrivepingPill({ ...v, status: "cancelled", arriveping_status: "cancel_requested" })).toBe("Cancel requested");
  });
});

describe("crew status view", () => {
  const v = (id: string, status: "scheduled" | "en_route" | "arrived" | "completed" | "cancelled", starts_at: string) => ({ id, status, starts_at });
  test("groups active, upcoming and past; upcoming by start, past newest first", () => {
    const g = crewStatusGroups([v("c", "completed", "2026-11-01T15:00:00Z"), v("s2", "scheduled", "2026-12-05T15:00:00Z"), v("a", "arrived", "2026-12-01T15:00:00Z"), v("s1", "scheduled", "2026-12-02T15:00:00Z"), v("x", "cancelled", "2026-11-20T15:00:00Z"), v("e", "en_route", "2026-11-30T15:00:00Z")]);
    expect(g.active.map((x) => x.id)).toEqual(["e", "a"]);
    expect(g.upcoming.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(g.past.map((x) => x.id)).toEqual(["x", "c"]);
  });
  test("updatedAt reads in Winnipeg time, with the day only when it is not today", () => {
    // Built from site wall-clock times so the test does not depend on which offset the runtime's zone data gives December.
    const at = (date: string, time: string) => (visitTimes({ date, start: time, end: "" }) as { startsAt: Date }).startsAt;
    const now = at("2026-12-01", "20:00");
    expect(updatedAt(at("2026-12-01", "14:14").toISOString(), now)).toBe("2:14 p.m.");
    expect(updatedAt(at("2026-11-30", "14:14").toISOString(), now)).toBe("Nov 30, 2:14 p.m.");
  });
  test("crewLabel prefers ArrivePing's word before the crew is out, then BMD's", () => {
    const base = { arriveping_job_id: "AP-1" as string | null, arriveping_status: null as string | null };
    expect(crewLabel({ ...base, status: "scheduled", arriveping_status: "assigned" })).toBe("Assigned");
    expect(crewLabel({ ...base, status: "scheduled" })).toBe("Scheduled");
    expect(crewLabel({ ...base, status: "scheduled", arriveping_job_id: null, arriveping_status: "assigned" })).toBe("Scheduled");
    expect(crewLabel({ ...base, status: "arrived", arriveping_status: "assigned" })).toBe("On site");
    expect(crewLabel({ ...base, status: "en_route", arriveping_status: "cancel_requested" })).toBe("Cancel requested");
    expect(crewLabel({ ...base, status: "completed", arriveping_status: "mystery" })).toBe("Completed");
  });
});
