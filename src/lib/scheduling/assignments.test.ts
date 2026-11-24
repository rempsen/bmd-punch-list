import { describe, expect, test } from "bun:test";
import {
  assignmentEmail,
  confirmationCounts,
  confirmationOf,
  countsLine,
  crewRef,
  defaultAssignmentDay,
  groupByCrew,
  linkExpiry,
  linkState,
  parseEmails,
  planRecipients,
  reportLine,
  reportPlace,
  reportTimeLabel,
} from "./assignments";
import { siteDay } from "./logic";
import type { WorkCalendar } from "./workdays";

const cal: WorkCalendar = { workdays: [1, 2, 3, 4, 5], holidays: [{ day: "2026-11-30", name: "Shop closed" }] };
const base = { status: "scheduled", tentative: false, assigned_user_id: null, assigned_name: null, technician_supplier_id: null, arriveping_assigned_to: null, confirmation: "not_sent" as const };
const v = (id: string, over: Partial<typeof base> & Record<string, unknown> = {}) => ({ id, starts_at: "2026-11-25T14:00:00.000Z", ...base, ...over });

describe("which day the Assignments tab opens on", () => {
  test("tomorrow", () => expect(defaultAssignmentDay("2026-11-24", cal)).toBe("2026-11-25"));
  test("Friday night shows Monday, or Tuesday when Monday is a holiday", () => {
    expect(defaultAssignmentDay("2026-11-20", cal)).toBe("2026-11-23");
    expect(defaultAssignmentDay("2026-11-27", cal)).toBe("2026-12-01");
  });
});

describe("report to", () => {
  test("site by default, at the visit's start time", () => {
    expect(reportPlace({ report_to: "site", report_to_other: null })).toBe("Site");
    expect(reportLine({ report_to: "site", report_to_other: null, report_time: null, starts_at: "2026-07-02T13:00:00.000Z" })).toBe("Report to: Site for 8:00 a.m.");
  });
  test("shop for 7", () => {
    expect(reportLine({ report_to: "shop", report_to_other: null, report_time: "07:00:00", starts_at: "2026-11-25T14:00:00.000Z" })).toBe("Report to: Shop for 7:00 a.m.");
  });
  test("somewhere else, in the office's words; blank falls back to Site", () => {
    expect(reportPlace({ report_to: "other", report_to_other: " Supplier yard, 55 King St " })).toBe("Supplier yard, 55 King St");
    expect(reportPlace({ report_to: "other", report_to_other: "  " })).toBe("Site");
  });
  test("a visit from before this was added reads as Site", () => {
    expect(reportLine({ starts_at: "2026-07-02T13:30:00.000Z" })).toBe("Report to: Site for 8:30 a.m.");
  });
  test("times read the way the crew says them", () => {
    expect(reportTimeLabel("07:00")).toBe("7:00 a.m.");
    expect(reportTimeLabel("13:30:00")).toBe("1:30 p.m.");
    expect(reportTimeLabel("00:15")).toBe("12:15 a.m.");
    expect(reportTimeLabel("nonsense")).toBeNull();
  });
});

describe("who is on a visit", () => {
  test("staff by login, subcontractor by vendor, a typed name, a name only ArrivePing has, or nobody", () => {
    expect(crewRef(v("1", { assigned_user_id: "u1" }))).toEqual({ key: "user:u1", kind: "user", id: "u1" });
    expect(crewRef(v("1", { technician_supplier_id: "s1", assigned_name: "Floors R Us" }))).toEqual({ key: "sup:s1", kind: "sup", id: "s1" });
    expect(crewRef(v("1", { assigned_name: " Brodie " }))).toEqual({ key: "name:brodie", kind: "name", name: "Brodie" });
    expect(crewRef(v("1", { arriveping_assigned_to: "Sam" }))).toEqual({ key: "name:sam", kind: "name", name: "Sam" });
    expect(crewRef(v("1"))).toBeNull();
  });
});

const names = new Map([["user:u1", "Alex Staff"], ["sup:s1", "Floors R Us"], ["sup:s2", "No Email Tile"]]);
const visits = [
  v("a", { assigned_user_id: "u1" }),
  v("b", { assigned_user_id: "u1", starts_at: "2026-11-25T18:00:00.000Z" }),
  v("c", { technician_supplier_id: "s1", assigned_name: "Floors R Us" }),
  v("d"),
  v("e", { technician_supplier_id: "s2", assigned_name: "No Email Tile" }),
  v("f", { assigned_user_id: "u1", status: "cancelled" }),
  v("g", { assigned_name: "Brodie" }),
  v("h", { technician_supplier_id: "s1", tentative: true }),
  v("i", { assigned_user_id: "u1", starts_at: "2026-11-26T14:00:00.000Z" }),
];

describe("the day's visits by crew", () => {
  const g = groupByCrew(visits, "2026-11-25", names);
  test("visits with no crew come first, on their own", () => expect(g.unassigned.map((x) => x.id)).toEqual(["d"]));
  test("one group per crew, by name; cancelled visits and other days are left out", () => {
    expect(g.crews.map((c) => [c.name, c.visits.map((x) => x.id)])).toEqual([
      ["Alex Staff", ["a", "b"]],
      ["Brodie", ["g"]],
      ["Floors R Us", ["c", "h"]],
      ["No Email Tile", ["e"]],
    ]);
  });
});

describe("who gets an email and who is skipped", () => {
  const g = groupByCrew(visits, "2026-11-25", names);
  const emails = new Map<string, string | null>([["user:u1", "alex@bmd.example"], ["sup:s1", " Office@FloorsRUs.example "], ["sup:s2", null]]);
  const plan = planRecipients(g.crews, emails);
  test("staff at their login email, subcontractors at the email on their vendor record, one message per crew", () => {
    expect(plan.send.map((s) => [s.name, s.email, s.visits.map((x) => x.id)])).toEqual([
      ["Alex Staff", "alex@bmd.example", ["a", "b"]],
      ["Floors R Us", "office@floorsrus.example", ["c"]],
    ]);
  });
  test("a crew with no email is skipped and named, never guessed", () => {
    expect(plan.skipped).toContainEqual({ key: "sup:s2", name: "No Email Tile", reason: "No email on file" });
    expect(plan.skipped).toContainEqual({ key: "name:brodie", name: "Brodie", reason: "No email on file" });
  });
  test("tentative visits are never in a message", () => {
    expect(plan.send.flatMap((s) => s.visits.map((x) => x.id))).not.toContain("h");
  });
  test("a crew whose only visits are tentative gets nothing", () => {
    const only = groupByCrew([v("h", { technician_supplier_id: "s1", tentative: true })], "2026-11-25", names);
    const p = planRecipients(only.crews, emails);
    expect(p.send).toEqual([]);
    expect(p.skipped).toEqual([{ key: "sup:s1", name: "Floors R Us", reason: "Tentative only" }]);
  });
  test("an address that is not an email is treated as none", () => {
    const p = planRecipients(g.crews, new Map([["user:u1", "not an email"]]));
    expect(p.send).toEqual([]);
    expect(p.skipped.find((s) => s.key === "user:u1")?.reason).toBe("No email on file");
  });
  test("only the crews picked are sent to", () => {
    expect(planRecipients(g.crews, emails, ["sup:s1"]).send.map((s) => s.key)).toEqual(["sup:s1"]);
  });
});

describe("confirmation", () => {
  test("counts for the day", () => {
    const list = [v("1", { confirmation: "confirmed" }), v("2", { confirmation: "confirmed" }), v("3", { confirmation: "declined" }), v("4", { confirmation: "waiting" }), v("5"), v("6", { status: "cancelled", confirmation: "confirmed" })];
    const c = confirmationCounts(list);
    expect(c).toEqual({ confirmed: 2, declined: 1, waiting: 1, notSent: 1 });
    expect(countsLine(c)).toBe("2 confirmed · 1 can't make it · 1 waiting · 1 not sent");
    expect(countsLine({ confirmed: 5, declined: 1, waiting: 2, notSent: 0 })).toBe("5 confirmed · 1 can't make it · 2 waiting");
    expect(countsLine({ confirmed: 0, declined: 0, waiting: 0, notSent: 0 })).toBe("Nothing scheduled");
  });
  test("the word shown on a visit", () => {
    expect(confirmationOf({ confirmation: "confirmed" })).toEqual({ state: "confirmed", label: "Confirmed" });
    expect(confirmationOf({ confirmation: "declined" })).toEqual({ state: "declined", label: "Can't make it" });
    expect(confirmationOf({ confirmation: "waiting" })).toEqual({ state: "waiting", label: "Waiting" });
    expect(confirmationOf({})).toEqual({ state: "not_sent", label: "Not sent" });
  });
});

describe("the link in the email", () => {
  test("it stops working when the visit day is over in Winnipeg", () => {
    expect(linkExpiry("2026-07-01")).toBe("2026-07-02T05:00:00.000Z"); // midnight, daylight time
    const end = Date.parse(linkExpiry("2026-11-25"));
    expect(siteDay(new Date(end))).toBe("2026-11-26");
    expect(siteDay(new Date(end - 1))).toBe("2026-11-25");
  });
  const link = { expires_at: "2026-11-26T06:00:00.000Z", response: null as "confirmed" | "declined" | null };
  test("open until then, expired after", () => {
    expect(linkState(link, 2, new Date("2026-11-26T05:59:00Z"))).toBe("open");
    expect(linkState(link, 2, new Date("2026-11-26T06:00:00Z"))).toBe("expired");
  });
  test("a link whose visits were all moved, reassigned or sent again no longer applies", () => {
    expect(linkState(link, 0, new Date("2026-11-25T12:00:00Z"))).toBe("replaced");
  });
  test("an answer already given shows, and can still be changed until the day is over", () => {
    expect(linkState({ ...link, response: "confirmed" }, 1, new Date("2026-11-25T12:00:00Z"))).toBe("confirmed");
    expect(linkState({ ...link, response: "declined" }, 1, new Date("2026-11-25T12:00:00Z"))).toBe("declined");
    expect(linkState({ ...link, response: "confirmed" }, 1, new Date("2026-11-27T12:00:00Z"))).toBe("expired");
  });
});

describe("the email", () => {
  const mail = assignmentEmail({
    crewName: "Floors <R> Us",
    day: "2026-11-25",
    visits: [{ job: "2611 Hyatt & Co", address: "1 Main St", scope: "Corridor LVT", reportTo: "Shop", reportAt: "7:00 a.m.", runLabel: "Day 2 of 3" }],
    confirmUrl: "https://x.example/confirm/abc?a=yes",
    declineUrl: "https://x.example/confirm/abc?a=no",
    senderName: "Dan",
    company: "BMD Materials",
  });
  test("subject names the day", () => expect(mail.subject).toBe("Your assignment for Wed, Nov 25"));
  test("says where and when to report, with both links", () => {
    expect(mail.html).toContain("Shop for 7:00 a.m.");
    expect(mail.html).toContain("https://x.example/confirm/abc?a=yes");
    expect(mail.html).toContain("https://x.example/confirm/abc?a=no");
    expect(mail.html).toContain("Day 2 of 3");
  });
  test("names typed by people cannot break the page", () => {
    expect(mail.html).toContain("Floors &lt;R&gt; Us");
    expect(mail.html).toContain("2611 Hyatt &amp; Co");
    expect(mail.html).not.toContain("<R>");
  });
  test("several visits say so in the subject", () => {
    const two = assignmentEmail({ crewName: "A", day: "2026-11-25", visits: [{ job: "J1", address: null, scope: null, reportTo: "Site", reportAt: "8:00 a.m.", runLabel: null }, { job: "J2", address: null, scope: null, reportTo: "Site", reportAt: "1:00 p.m.", runLabel: null }], confirmUrl: "c", declineUrl: "d", senderName: "Dan", company: "BMD Materials" });
    expect(two.subject).toBe("Your 2 assignments for Wed, Nov 25");
  });
});

describe("the copy-to list", () => {
  test("one per line or comma, tidied, no repeats; anything that is not an email is pointed out", () => {
    expect(parseEmails("Dan@BMD.example, ops@bmd.example\nops@bmd.example; nope")).toEqual({ emails: ["dan@bmd.example", "ops@bmd.example"], invalid: ["nope"] });
    expect(parseEmails("  ")).toEqual({ emails: [], invalid: [] });
  });
});
