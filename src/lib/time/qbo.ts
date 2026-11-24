/**
 * Approved hours as QuickBooks Online TimeActivity records. Pure planning plus a sender that takes its `post` and its
 * store from the caller, so it runs on the server and under test. Rules: only approved, closed entries go; a person must
 * be linked to a QuickBooks Employee (or Vendor) first; an entry that has its QuickBooks id is never sent again; a job
 * with no QuickBooks customer is sent without one and not billable; an unknown rate is never sent as 0; cost is never sent.
 */
import { entryDay, hoursText, type TimeEntry } from "./logic";

export type QboPersonLink = { qbo_type: "Employee" | "Vendor"; qbo_id: string; qbo_name?: string | null };
export type TimeSendInput = {
  entry: TimeEntry;
  personName: string;
  projectName: string;
  personLink: QboPersonLink | null;
  /** The QuickBooks customer (or project) this job is linked to, if it is. */
  customerId: string | null;
  /** The person's billable rate on this job (`rateFor`), or null when unknown. */
  billableRateCents: number | null;
  tz?: string;
};
export type PlannedTime = { entryId: string; personName: string; projectName: string; day: string; minutes: number; billable: boolean; requestId: string; body: Record<string, unknown>; summary: string[] };
export type TimePlan = { ok: true; send: PlannedTime } | { ok: false; reason: string };

/**
 * QuickBooks treats a repeated `requestid` as the same request and will not create a second record. The id stays the same
 * while an attempt's outcome is unknown (no answer), and moves on once QuickBooks has definitely refused an attempt.
 */
export const requestIdFor = (entryId: string, attempts: number): string => `${entryId.replace(/-/g, "")}-${Math.max(0, Math.floor(attempts) || 0)}`;

export function planTimeActivity(i: TimeSendInput): TimePlan {
  const e = i.entry;
  if (e.qbo_time_activity_id) return { ok: false, reason: "Already in QuickBooks." };
  if (e.clock_out_at == null || e.rounded_minutes == null) return { ok: false, reason: "Still clocked in." };
  if (!e.approved_at) return { ok: false, reason: "Not approved." };
  if (!i.personLink) return { ok: false, reason: `${i.personName} is not linked to a QuickBooks employee or vendor yet.` };
  if (e.rounded_minutes <= 0) return { ok: false, reason: "Rounds to zero hours: nothing to send." };

  const ref = { value: i.personLink.qbo_id, ...(i.personLink.qbo_name ? { name: i.personLink.qbo_name } : {}) };
  const notes = [e.note_in, e.note_out].map((n) => (n ?? "").trim()).filter(Boolean).join("; ");
  const body: Record<string, unknown> = {
    TxnDate: entryDay(e, i.tz),
    NameOf: i.personLink.qbo_type,
    [i.personLink.qbo_type === "Vendor" ? "VendorRef" : "EmployeeRef"]: ref,
    Hours: Math.floor(e.rounded_minutes / 60),
    Minutes: e.rounded_minutes % 60,
    Description: `${i.projectName}${notes ? ` — ${notes}` : ""}`.slice(0, 4000),
  };
  const billable = i.customerId != null && i.billableRateCents != null;
  if (i.customerId != null) body["CustomerRef"] = { value: i.customerId };
  body["BillableStatus"] = billable ? "Billable" : "NotBillable";
  if (billable) body["HourlyRate"] = i.billableRateCents! / 100;
  const why = billable ? `Billable at $${(i.billableRateCents! / 100).toFixed(2)} an hour` : i.customerId == null ? "No QuickBooks customer for this job: not billable" : "No billable rate for this person: not billable";
  return { ok: true, send: { entryId: e.id, personName: i.personName, projectName: i.projectName, day: entryDay(e, i.tz), minutes: e.rounded_minutes, billable, requestId: requestIdFor(e.id, e.qbo_attempts), body, summary: [`${hoursText(e.rounded_minutes)} h`, why] } };
}

export type TimePreview = { sends: PlannedTime[]; held: { entryId: string; label: string; reason: string }[] };
export function previewTime(inputs: TimeSendInput[]): TimePreview {
  const out: TimePreview = { sends: [], held: [] };
  for (const i of inputs) {
    const p = planTimeActivity(i);
    if (p.ok) out.sends.push(p.send);
    else out.held.push({ entryId: i.entry.id, label: `${i.personName} · ${i.projectName} · ${entryDay(i.entry, i.tz)}`, reason: p.reason });
  }
  return out;
}

export type TimeSendStore = {
  /** Read fresh, just before sending: still approved and without a QuickBooks id. */
  sendable: (entryId: string) => Promise<boolean>;
  sent: (entryId: string, qboId: string, at: string, send: PlannedTime) => Promise<void>;
  /** `refused` is true when QuickBooks answered and said no; false when the outcome is unknown. */
  failed: (entryId: string, message: string, refused: boolean, send: PlannedTime) => Promise<void>;
};

/** Sends each planned entry once. One failing never stops the rest; each keeps its own outcome. */
export async function sendTimeActivities(deps: { post: (path: string, body: unknown) => Promise<Record<string, unknown>>; store: TimeSendStore; now: () => string }, sends: PlannedTime[]): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0, failed = 0, skipped = 0;
  for (const s of sends) {
    if (!(await deps.store.sendable(s.entryId))) {
      skipped++;
      continue;
    }
    try {
      const res = await deps.post(`timeactivity?requestid=${encodeURIComponent(s.requestId)}`, s.body);
      const id = (res["TimeActivity"] as { Id?: unknown } | undefined)?.Id;
      if (typeof id !== "string" || !id) {
        await deps.store.failed(s.entryId, "QuickBooks answered without a time activity id, so this was not marked as sent.", false, s);
        failed++;
        continue;
      }
      await deps.store.sent(s.entryId, id, deps.now(), s);
      sent++;
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await deps.store.failed(s.entryId, message, message.startsWith("QuickBooks refused the request"), s);
      failed++;
    }
  }
  return { sent, failed, skipped };
}

// ── Linking people to QuickBooks employees and vendors ─────────────────────────────────────────────────────
export type QboName = { Id?: string; DisplayName?: string; GivenName?: string; FamilyName?: string };
const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Ways a name may be written: as shown, "Given Family", "Family Given", and with the words in the other order. */
const forms = (r: QboName): Set<string> => {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = norm(s);
    if (!n) return;
    out.add(n);
    out.add(n.split(" ").reverse().join(" "));
  };
  add(r.DisplayName ?? "");
  add(`${r.GivenName ?? ""} ${r.FamilyName ?? ""}`);
  return out;
};

/** A suggested QuickBooks record for each person whose name matches exactly one employee (or, failing that, exactly one vendor). */
export function matchPeople(people: { id: string; full_name: string | null; email: string | null }[], employees: QboName[], vendors: QboName[]): Map<string, QboPersonLink> {
  const out = new Map<string, QboPersonLink>();
  const find = (name: string, list: QboName[]) => {
    const all = list.filter((r) => r.Id && forms(r).has(name));
    // Two records with the very same name cannot be told apart: no suggestion. Otherwise the closest (shown name) wins.
    const exact = all.filter((r) => norm(r.DisplayName) === name);
    return exact.length === 1 ? exact[0]! : all.length === 1 ? all[0]! : null;
  };
  for (const p of people) {
    const name = norm(p.full_name);
    if (!name) continue;
    const same = (list: QboName[]) => list.filter((r) => r.Id && forms(r).has(name)).length;
    const emp = find(name, employees);
    if (emp) out.set(p.id, { qbo_type: "Employee", qbo_id: String(emp.Id), qbo_name: emp.DisplayName ?? null });
    else if (same(employees) === 0) {
      const ven = find(name, vendors);
      if (ven) out.set(p.id, { qbo_type: "Vendor", qbo_id: String(ven.Id), qbo_name: ven.DisplayName ?? null });
    }
  }
  return out;
}
