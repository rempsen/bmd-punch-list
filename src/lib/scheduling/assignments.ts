/**
 * Tomorrow's assignments: who is on what, where and when they report, who gets an email, and whether they have confirmed.
 * Pure rules; the email itself is sent from the signed-in person's own mailbox by assignments.functions.ts.
 */
import { SCHEDULE_TZ, visitTimes } from "@/lib/visits/logic";
import { siteDay } from "./logic";
import { nextWorkday, type WorkCalendar } from "./workdays";

export type Confirmation = "not_sent" | "waiting" | "confirmed" | "declined";
export type ReportTo = "site" | "shop" | "other";
export const CONFIRMATION_LABEL: Record<Confirmation, string> = { not_sent: "Not sent", waiting: "Waiting", confirmed: "Confirmed", declined: "Can't make it" };

/** The day the Assignments tab opens on: the next workday after today. */
export const defaultAssignmentDay = (today: string, cal: WorkCalendar): string => nextWorkday(today, cal);

// ── Report to ──────────────────────────────────────────────────────────────────────────────────────────────
type Reporting = { report_to?: string | null; report_to_other?: string | null; report_time?: string | null; starts_at: string };

/** Where the crew reports: "Site", "Shop", or the place typed for Other. */
export function reportPlace(v: Pick<Reporting, "report_to" | "report_to_other">): string {
  if (v.report_to === "shop") return "Shop";
  if (v.report_to === "other") return (v.report_to_other ?? "").trim() || "Site";
  return "Site";
}

/** "07:00" or "07:00:00" as the crew says it: "7:00 a.m.". Null when it is not a time. */
export function reportTimeLabel(time: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  if (!m || +m[1]! > 23 || +m[2]! > 59) return null;
  const h = +m[1]!;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "a.m." : "p.m."}`;
}

/** When the crew reports: the time set on the visit, else the visit's start (Winnipeg time). */
export function reportAt(v: Pick<Reporting, "report_time" | "starts_at">, tz = SCHEDULE_TZ): string {
  const set = reportTimeLabel(v.report_time);
  if (set) return set;
  const hm = new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(v.starts_at));
  return reportTimeLabel(hm) ?? "";
}

/** The one line the crew reads: "Report to: Shop for 7:00 a.m.". */
export const reportLine = (v: Reporting, tz = SCHEDULE_TZ): string => `Report to: ${reportPlace(v)} for ${reportAt(v, tz)}`;

// ── Crews ──────────────────────────────────────────────────────────────────────────────────────────────────
type Assigned = { assigned_user_id?: string | null; technician_supplier_id?: string | null; assigned_name?: string | null; arriveping_assigned_to?: string | null };
export type CrewRef = { key: string; kind: "user"; id: string } | { key: string; kind: "sup"; id: string } | { key: string; kind: "name"; name: string };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Who a visit is assigned to: staff by login, a subcontractor by vendor record, else a bare name (typed, or only ArrivePing's). Null is nobody. */
export function crewRef(v: Assigned): CrewRef | null {
  if (v.assigned_user_id) return { key: `user:${v.assigned_user_id}`, kind: "user", id: v.assigned_user_id };
  if (v.technician_supplier_id) return { key: `sup:${v.technician_supplier_id}`, kind: "sup", id: v.technician_supplier_id };
  const name = (v.assigned_name ?? "").trim() || (v.arriveping_assigned_to ?? "").trim();
  return name ? { key: `name:${norm(name)}`, kind: "name", name } : null;
}

type DayVisit = Assigned & { id: string; starts_at: string; status: string; tentative?: boolean | null; confirmation?: string | null };
export type CrewGroup<V> = { key: string; kind: CrewRef["kind"]; name: string; visits: V[] };

/** A day's live visits: those with no crew, then one group per crew by name, each in start order. `names` gives staff and vendor names by crew key. */
export function groupByCrew<V extends DayVisit>(visits: V[], day: string, names: Map<string, string>, tz = SCHEDULE_TZ): { unassigned: V[]; crews: CrewGroup<V>[] } {
  const live = visits.filter((v) => v.status !== "cancelled" && siteDay(v.starts_at, tz) === day).sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
  const unassigned: V[] = [];
  const groups = new Map<string, CrewGroup<V>>();
  for (const v of live) {
    const ref = crewRef(v);
    if (!ref) {
      unassigned.push(v);
      continue;
    }
    const g = groups.get(ref.key) ?? { key: ref.key, kind: ref.kind, name: names.get(ref.key) ?? (ref.kind === "name" ? ref.name : (v.assigned_name ?? "").trim() || "Crew"), visits: [] };
    g.visits.push(v);
    groups.set(ref.key, g);
  }
  return { unassigned, crews: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) };
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const cleanEmail = (raw: string | null | undefined): string | null => {
  const e = (raw ?? "").trim().toLowerCase();
  return e.length <= 320 && EMAIL.test(e) ? e : null;
};

export type Recipient<V> = { key: string; name: string; email: string; visits: V[] };
export type Skipped = { key: string; name: string; reason: "No email on file" | "Tentative only" };

/**
 * Who gets an assignment email: one message per crew holding all its visits for the day. Tentative visits are never sent.
 * A crew with no usable email is skipped and named, never guessed at. `only` limits the send to the crews picked.
 */
export function planRecipients<V extends DayVisit>(crews: CrewGroup<V>[], emails: Map<string, string | null | undefined>, only?: string[]): { send: Recipient<V>[]; skipped: Skipped[] } {
  const send: Recipient<V>[] = [];
  const skipped: Skipped[] = [];
  for (const c of crews) {
    if (only && !only.includes(c.key)) continue;
    const visits = c.visits.filter((v) => !v.tentative && v.status !== "cancelled");
    if (!visits.length) {
      skipped.push({ key: c.key, name: c.name, reason: "Tentative only" });
      continue;
    }
    const email = cleanEmail(emails.get(c.key));
    if (!email) skipped.push({ key: c.key, name: c.name, reason: "No email on file" });
    else send.push({ key: c.key, name: c.name, email, visits });
  }
  return { send, skipped };
}

// ── Confirmation ───────────────────────────────────────────────────────────────────────────────────────────
export function confirmationOf(v: { confirmation?: string | null }): { state: Confirmation; label: string } {
  const state: Confirmation = v.confirmation === "confirmed" || v.confirmation === "declined" || v.confirmation === "waiting" ? v.confirmation : "not_sent";
  return { state, label: CONFIRMATION_LABEL[state] };
}

export type Counts = { confirmed: number; declined: number; waiting: number; notSent: number };
/** How the day stands. Cancelled visits are not counted. */
export function confirmationCounts(visits: { status: string; confirmation?: string | null }[]): Counts {
  const c: Counts = { confirmed: 0, declined: 0, waiting: 0, notSent: 0 };
  for (const v of visits) {
    if (v.status === "cancelled") continue;
    const s = confirmationOf(v).state;
    if (s === "confirmed") c.confirmed++;
    else if (s === "declined") c.declined++;
    else if (s === "waiting") c.waiting++;
    else c.notSent++;
  }
  return c;
}
/** "5 confirmed · 1 can't make it · 2 waiting" (and "· 1 not sent" when some have not gone out). */
export function countsLine(c: Counts): string {
  if (c.confirmed + c.declined + c.waiting + c.notSent === 0) return "Nothing scheduled";
  return [`${c.confirmed} confirmed`, `${c.declined} can't make it`, `${c.waiting} waiting`, ...(c.notSent ? [`${c.notSent} not sent`] : [])].join(" · ");
}

// ── The link ───────────────────────────────────────────────────────────────────────────────────────────────
const nextDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** When a confirmation link stops working: the end of the visit day, site time. */
export function linkExpiry(day: string, tz = SCHEDULE_TZ): string {
  const t = visitTimes({ date: nextDay(day), start: "00:00", end: "" }, tz);
  if ("error" in t) throw new Error("Invalid day");
  return t.startsAt.toISOString();
}

export type LinkState = "open" | "confirmed" | "declined" | "expired" | "replaced";
/** What the page shows for a link. `liveVisits` is how many visits still point at it: none means they were moved, reassigned or sent again. */
export function linkState(link: { expires_at: string; response: "confirmed" | "declined" | null }, liveVisits: number, now: Date = new Date()): LinkState {
  if (now.getTime() >= Date.parse(link.expires_at)) return "expired";
  if (liveVisits <= 0) return "replaced";
  return link.response ?? "open";
}

// ── The email ──────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const dayLong = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const dayShort = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** One visit as the crew's email shows it. No prices, no client contact details. */
export type EmailVisit = { job: string; address: string | null; scope: string | null; reportTo: string; reportAt: string; runLabel: string | null };

/** The assignment email for one crew: every visit that day, where and when to report, and the two links. */
export function assignmentEmail(o: { crewName: string; day: string; visits: EmailVisit[]; confirmUrl: string; declineUrl: string; senderName: string; company: string }): { subject: string; html: string } {
  const many = o.visits.length > 1;
  const subject = `Your ${many ? `${o.visits.length} assignments` : "assignment"} for ${dayShort(o.day)}`;
  const rows = o.visits
    .map(
      (v) =>
        `<tr><td style="padding:12px 0;border-top:1px solid #e5e5e5"><div style="font-size:16px;font-weight:600">${esc(v.job)}${v.runLabel ? ` <span style="font-weight:400;color:#555">· ${esc(v.runLabel)}</span>` : ""}</div>` +
        (v.address ? `<div style="color:#333">${esc(v.address)}</div>` : "") +
        (v.scope ? `<div style="color:#333">${esc(v.scope)}</div>` : "") +
        `<div style="margin-top:4px"><b>Report to:</b> ${esc(v.reportTo)} for ${esc(v.reportAt)}</div></td></tr>`,
    )
    .join("");
  const button = (href: string, label: string, bg: string, fg: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:14px 22px;border-radius:8px;background:${bg};color:${fg};font-size:16px;font-weight:600;text-decoration:none;border:1px solid #111">${label}</a>`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111;max-width:560px">` +
    `<p>Hi ${esc(o.crewName)},</p><p>Here ${many ? "are your assignments" : "is your assignment"} for <b>${esc(dayLong(o.day))}</b>.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows}</table>` +
    `<p style="margin-top:20px">Please let us know:</p><p>${button(o.confirmUrl, "Confirm", "#111", "#fff")}${button(o.declineUrl, "Can&#39;t make it", "#fff", "#111")}</p>` +
    `<p style="color:#555;font-size:13px">One tap is all it takes. The links work until the end of that day.</p>` +
    `<p>Thanks,<br>${esc(o.senderName)}<br>${esc(o.company)}</p></div>`;
  return { subject, html };
}

/** The "Copy assignments to" box as a list: one address per line (commas and semicolons work too), tidied, no repeats. */
export function parseEmails(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const e = cleanEmail(part);
    if (!e) invalid.push(part);
    else if (!emails.includes(e)) emails.push(e);
  }
  return { emails, invalid };
}
