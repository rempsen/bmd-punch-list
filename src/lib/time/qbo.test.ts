import { describe, expect, test } from "bun:test";
import { createQbo } from "@/lib/qbo/connect";
import type { TimeEntry } from "./logic";
import { matchPeople, planTimeActivity, previewTime, requestIdFor, sendTimeActivities, type PlannedTime, type TimeSendInput, type TimeSendStore } from "./qbo";

const entry = (o: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "0a000000-0000-4000-8000-0000000000e1",
  user_id: "u1",
  project_id: "p1",
  clock_in_at: "2025-11-24T13:02:00.000Z",
  clock_out_at: "2025-11-24T21:40:00.000Z",
  rounded_minutes: 525,
  in_lat: null, in_lng: null, in_accuracy_m: null, out_lat: null, out_lng: null, out_accuracy_m: null,
  note_in: "Unit 4 stairs", note_out: null, source: "clock",
  original: null, adjusted_at: null, adjusted_by: null, adjust_reason: null,
  approved_at: "2025-11-25T15:00:00.000Z", approved_by: "boss",
  qbo_time_activity_id: null, qbo_sent_at: null, qbo_error: null, qbo_attempts: 0,
  ...o,
});
const input = (o: Partial<TimeSendInput> = {}): TimeSendInput => ({ entry: entry(), personName: "Ana Crew", projectName: "Hyatt Centric", personLink: { qbo_type: "Employee", qbo_id: "55", qbo_name: "Ana Crew" }, customerId: null, billableRateCents: null, ...o });

describe("an approved entry as a QuickBooks TimeActivity", () => {
  test("an employee's time on a job that is not linked: no customer, not billable, rounded hours and minutes", () => {
    const p = planTimeActivity(input());
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).toEqual({ TxnDate: "2025-11-24", NameOf: "Employee", EmployeeRef: { value: "55", name: "Ana Crew" }, Hours: 8, Minutes: 45, Description: "Hyatt Centric — Unit 4 stairs", BillableStatus: "NotBillable" });
    expect(p.send).toMatchObject({ entryId: "0a000000-0000-4000-8000-0000000000e1", day: "2025-11-24", minutes: 525, billable: false });
    expect(p.send.summary).toEqual(["8.75 h", "No QuickBooks customer for this job: not billable"]);
  });
  test("a linked job with a known billable rate: customer, billable, rate in dollars", () => {
    const p = planTimeActivity(input({ customerId: "301", billableRateCents: 8550 }));
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).toMatchObject({ CustomerRef: { value: "301" }, BillableStatus: "Billable", HourlyRate: 85.5 });
    expect(p.send.billable).toBe(true);
    expect(p.send.summary).toEqual(["8.75 h", "Billable at $85.50 an hour"]);
  });
  test("a linked job with no billable rate keeps the customer but is not billable; the rate is never sent as 0", () => {
    const p = planTimeActivity(input({ customerId: "301", billableRateCents: null }));
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).toMatchObject({ CustomerRef: { value: "301" }, BillableStatus: "NotBillable" });
    expect(p.send.body).not.toHaveProperty("HourlyRate");
    expect(p.send.summary[1]).toBe("No billable rate for this person: not billable");
  });
  test("a rate with no linked job is not sent either", () => {
    const p = planTimeActivity(input({ customerId: null, billableRateCents: 8550 }));
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).not.toHaveProperty("HourlyRate");
    expect(p.send.body).not.toHaveProperty("CustomerRef");
  });
  test("a subcontractor goes as a Vendor", () => {
    const p = planTimeActivity(input({ personLink: { qbo_type: "Vendor", qbo_id: "900", qbo_name: "Floor Bros" } }));
    if (!p.ok) throw new Error(p.reason);
    expect(p.send.body).toMatchObject({ NameOf: "Vendor", VendorRef: { value: "900", name: "Floor Bros" } });
    expect(p.send.body).not.toHaveProperty("EmployeeRef");
  });
  test("the cost of labour is never part of what is sent", () => {
    const p = planTimeActivity(input({ customerId: "301", billableRateCents: 8550 }));
    if (!p.ok) throw new Error(p.reason);
    expect(JSON.stringify(p.send.body)).not.toContain("cost");
  });
  test("held, with the reason: person not linked, not approved, still clocked in, already sent, nothing to pay", () => {
    expect(planTimeActivity(input({ personLink: null }))).toEqual({ ok: false, reason: "Ana Crew is not linked to a QuickBooks employee or vendor yet." });
    expect(planTimeActivity(input({ entry: entry({ approved_at: null }) }))).toEqual({ ok: false, reason: "Not approved." });
    expect(planTimeActivity(input({ entry: entry({ clock_out_at: null, rounded_minutes: null, approved_at: null }) }))).toEqual({ ok: false, reason: "Still clocked in." });
    expect(planTimeActivity(input({ entry: entry({ qbo_time_activity_id: "5" }) }))).toEqual({ ok: false, reason: "Already in QuickBooks." });
    expect(planTimeActivity(input({ entry: entry({ rounded_minutes: 0 }) }))).toEqual({ ok: false, reason: "Rounds to zero hours: nothing to send." });
  });
  test("the preview splits what will be sent from what is held", () => {
    const p = previewTime([input(), input({ entry: entry({ id: "0b000000-0000-4000-8000-0000000000e2" }), personName: "Ben Crew", personLink: null })]);
    expect(p.sends.map((s) => s.entryId)).toEqual(["0a000000-0000-4000-8000-0000000000e1"]);
    expect(p.held).toEqual([{ entryId: "0b000000-0000-4000-8000-0000000000e2", label: "Ben Crew · Hyatt Centric · 2025-11-24", reason: "Ben Crew is not linked to a QuickBooks employee or vendor yet." }]);
  });
  test("the request id is the same for a repeat of the same attempt and new after QuickBooks refused one", () => {
    expect(requestIdFor("0a000000-0000-4000-8000-0000000000e1", 0)).toBe("0a0000000000400080000000000000e1-0");
    expect(requestIdFor("0a000000-0000-4000-8000-0000000000e1", 0)).toBe(requestIdFor("0a000000-0000-4000-8000-0000000000e1", 0));
    expect(requestIdFor("0a000000-0000-4000-8000-0000000000e1", 1)).not.toBe(requestIdFor("0a000000-0000-4000-8000-0000000000e1", 0));
    expect(requestIdFor("0a000000-0000-4000-8000-0000000000e1", 3).length).toBeLessThanOrEqual(50);
  });
});

// ── Sending, against canned QuickBooks answers ─────────────────────────────────────────────────────────────
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
/** Intuit's documented TimeActivity create response. */
const created = (id: string, body: Record<string, unknown>) => ({ TimeActivity: { ...body, Taxable: false, HourlyRate: 0, domain: "QBO", sparse: false, Id: id, SyncToken: "0", MetaData: { CreateTime: "2025-11-25T09:21:45-08:00", LastUpdatedTime: "2025-11-25T09:21:45-08:00" } }, time: "2025-11-25T09:21:45.123-08:00" });
const fault = { Fault: { Error: [{ Message: "Invalid Reference Id", Detail: "Invalid Reference Id : Employee assigned to this transaction has been deleted.", code: "2500", element: "EmployeeRef" }], type: "ValidationFault" }, time: "2025-11-25T09:21:45.123-08:00" };

function fakeQuickBooks(answer: (call: Call, n: number) => { status: number; json: unknown } | "network") {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const a = answer(call, calls.length);
    if (a === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { "content-type": "application/json", intuit_tid: "1-abc" } });
  }) as typeof fetch;
  const q = createQbo({ fetch: fetchFn, env: { clientId: "id", clientSecret: "secret" }, store: { get: async () => null, saveToken: async () => {}, setError: async () => {} }, keyMaterial: "k" });
  const auth = { accessToken: "token-1", realmId: "4620816365" };
  return { calls, post: (path: string, body: unknown) => q.post(path, body, auth) };
}

function memoryStore(entries: TimeEntry[]) {
  const rows = new Map(entries.map((e) => [e.id, { ...e }]));
  const log: string[] = [];
  const store: TimeSendStore = {
    sendable: async (id) => { const r = rows.get(id); return !!r && !!r.approved_at && !r.qbo_time_activity_id; },
    sent: async (id, qboId, at) => { const r = rows.get(id)!; r.qbo_time_activity_id = qboId; r.qbo_sent_at = at; r.qbo_error = null; log.push(`sent ${id} ${qboId}`); },
    failed: async (id, message, refused) => { const r = rows.get(id)!; r.qbo_error = message; if (refused) r.qbo_attempts += 1; log.push(`failed ${id} ${refused ? "refused" : "unknown"}`); },
  };
  return { rows, log, store };
}
const plan = (e: TimeEntry, o: Partial<TimeSendInput> = {}): PlannedTime => {
  const p = planTimeActivity(input({ entry: e, ...o }));
  if (!p.ok) throw new Error(p.reason);
  return p.send;
};
const now = () => "2025-11-25T17:21:45.000Z";

describe("sending approved hours to QuickBooks", () => {
  test("posts a TimeActivity to the company's API and records the id QuickBooks gives back", async () => {
    const e = entry();
    const qb = fakeQuickBooks((c) => ({ status: 200, json: created("5", c.body as Record<string, unknown>) }));
    const mem = memoryStore([e]);
    const r = await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(e)]);
    expect(r).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0]!.url).toBe("https://quickbooks.api.intuit.com/v3/company/4620816365/timeactivity?requestid=0a0000000000400080000000000000e1-0&minorversion=75");
    expect(qb.calls[0]!.method).toBe("POST");
    expect(qb.calls[0]!.headers).toMatchObject({ authorization: "Bearer token-1", "content-type": "application/json", accept: "application/json" });
    expect(qb.calls[0]!.body).toEqual({ TxnDate: "2025-11-24", NameOf: "Employee", EmployeeRef: { value: "55", name: "Ana Crew" }, Hours: 8, Minutes: 45, Description: "Hyatt Centric — Unit 4 stairs", BillableStatus: "NotBillable" });
    expect(mem.rows.get(e.id)).toMatchObject({ qbo_time_activity_id: "5", qbo_sent_at: now(), qbo_error: null });
  });
  test("nothing is sent twice: an entry that already has its QuickBooks id is skipped without a request", async () => {
    const e = entry();
    const qb = fakeQuickBooks((c, n) => ({ status: 200, json: created(String(4 + n), c.body as Record<string, unknown>) }));
    const mem = memoryStore([e]);
    const sends = [plan(e)];
    await sendTimeActivities({ post: qb.post, store: mem.store, now }, sends);
    const again = await sendTimeActivities({ post: qb.post, store: mem.store, now }, sends); // the same ticked list, pressed again
    expect(again).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(qb.calls).toHaveLength(1);
    expect(mem.rows.get(e.id)!.qbo_time_activity_id).toBe("5");
  });
  test("an entry whose approval was removed after the preview is skipped", async () => {
    const e = entry();
    const qb = fakeQuickBooks(() => ({ status: 200, json: {} }));
    const mem = memoryStore([{ ...e, approved_at: null }]);
    expect(await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(e)])).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(qb.calls).toHaveLength(0);
  });
  test("a refusal keeps QuickBooks' own words on the entry, sends the others, and can be retried under a new request id", async () => {
    const a = entry();
    const b = entry({ id: "0b000000-0000-4000-8000-0000000000e2" });
    let refuse = true;
    const qb = fakeQuickBooks((c) => (refuse && (c.body as { EmployeeRef: { value: string } }).EmployeeRef.value === "77" ? { status: 400, json: fault } : { status: 200, json: created("9", c.body as Record<string, unknown>) }));
    const mem = memoryStore([a, b]);
    const gone = { personLink: { qbo_type: "Employee" as const, qbo_id: "77" } };
    const r = await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(a, gone), plan(b)]);
    expect(r).toEqual({ sent: 1, failed: 1, skipped: 0 });
    const failed = mem.rows.get(a.id)!;
    expect(failed.qbo_time_activity_id).toBeNull();
    expect(failed.qbo_error).toContain("QuickBooks refused the request (400: Invalid Reference Id)");
    expect(failed.qbo_error).toContain("intuit_tid 1-abc");
    expect(failed.qbo_attempts).toBe(1);
    expect(mem.rows.get(b.id)!.qbo_time_activity_id).toBe("9");
    // Retry after the link is fixed: planned again from the stored entry, so it goes out under a new request id.
    refuse = false;
    const retry = await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(failed, gone)]);
    expect(retry).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(qb.calls.at(-1)!.url).toContain("requestid=0a0000000000400080000000000000e1-1&");
    expect(mem.rows.get(a.id)).toMatchObject({ qbo_time_activity_id: "9", qbo_error: null });
  });
  test("when the answer never arrives the entry is left unsent, and the retry repeats the same request id so QuickBooks cannot make two", async () => {
    const e = entry();
    let down = true;
    const qb = fakeQuickBooks((c) => (down ? "network" : { status: 200, json: created("12", c.body as Record<string, unknown>) }));
    const mem = memoryStore([e]);
    expect(await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(e)])).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(mem.rows.get(e.id)).toMatchObject({ qbo_time_activity_id: null, qbo_attempts: 0 });
    expect(mem.rows.get(e.id)!.qbo_error).toContain("fetch failed");
    down = false;
    await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(mem.rows.get(e.id)!)]);
    expect(qb.calls[1]!.url).toBe(qb.calls[0]!.url);
    expect(mem.rows.get(e.id)!.qbo_time_activity_id).toBe("12");
  });
  test("an answer with no id is a failure, never recorded as sent", async () => {
    const e = entry();
    const qb = fakeQuickBooks(() => ({ status: 200, json: { time: "2025-11-25T09:21:45.123-08:00" } }));
    const mem = memoryStore([e]);
    expect(await sendTimeActivities({ post: qb.post, store: mem.store, now }, [plan(e)])).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect(mem.rows.get(e.id)).toMatchObject({ qbo_time_activity_id: null, qbo_error: "QuickBooks answered without a time activity id, so this was not marked as sent." });
  });
});

describe("matching people to QuickBooks employees by name", () => {
  const employees = [{ Id: "55", DisplayName: "Ana Crew", GivenName: "Ana", FamilyName: "Crew" }, { Id: "56", DisplayName: "Benjamin Crew", GivenName: "Ben", FamilyName: "Crew" }, { Id: "57", DisplayName: "Sam Lee" }, { Id: "58", DisplayName: "Sam  LEE" }];
  const vendors = [{ Id: "900", DisplayName: "Floor Bros Ltd." }, { Id: "901", DisplayName: "Ana Crew" }];
  test("suggests the employee with the same name, however it is written; an employee wins over a vendor of the same name", () => {
    const m = matchPeople([{ id: "u1", full_name: "ana  crew", email: "a@x.test" }, { id: "u2", full_name: "Crew, Ben", email: null }, { id: "u3", full_name: "Floor Bros Ltd", email: null }], employees, vendors);
    expect(m.get("u1")).toEqual({ qbo_type: "Employee", qbo_id: "55", qbo_name: "Ana Crew" });
    expect(m.get("u2")).toEqual({ qbo_type: "Employee", qbo_id: "56", qbo_name: "Benjamin Crew" });
    expect(m.get("u3")).toEqual({ qbo_type: "Vendor", qbo_id: "900", qbo_name: "Floor Bros Ltd." });
  });
  test("no suggestion when nothing matches, the name is blank, or two records share the name", () => {
    const m = matchPeople([{ id: "u4", full_name: "Zed Nobody", email: null }, { id: "u5", full_name: null, email: "x@y.test" }, { id: "u6", full_name: "Sam Lee", email: null }], employees, vendors);
    expect(m.size).toBe(0);
  });
});
