import { describe, expect, it } from "bun:test";
import { buildICalendar, escapeText, eventsFromVisits, foldLine, icalUtc } from "./ical";

const ORIGIN = "https://projects.bmdmaterials.com";
const NOW = new Date("2026-11-24T18:00:00Z");
const base = {
  id: "11111111-1111-4111-8111-111111111111",
  project_id: "22222222-2222-4222-8222-222222222222",
  starts_at: "2026-12-03T08:00:00-06:00",
  ends_at: "2026-12-03T16:00:00-06:00",
  status: "scheduled",
  crew: null,
  assigned_name: "Fred Field",
  notes: "Use the back door; bring the 1/4\" trowel",
  site_contact: "Sam Super, 204-555-0100",
  scope: "Level 2 carpet tile",
  project: { id: "22222222-2222-4222-8222-222222222222", name: "Hyatt Centric", project_number: "25-014", address: "123 Main St, Winnipeg, MB" },
};
const one = (row: Record<string, unknown>) => eventsFromVisits([row], { origin: ORIGIN })[0]!;
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("escapeText", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(escapeText("a\\b; c, d\r\ne\nf")).toBe("a\\\\b\; c\\, d\\ne\\nf");
  });
  it("drops control characters", () => {
    expect(escapeText("a\u0000b\tc")).toBe("ab c");
  });
});

describe("foldLine", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });
  it("keeps every physical line to 75 octets and continues with a space", () => {
    const line = `DESCRIPTION:${"x".repeat(300)}`;
    const parts = foldLine(line).split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });
  it("counts octets, not characters, and never splits a character", () => {
    const line = `SUMMARY:${"é—🙂".repeat(30)}`;
    const parts = foldLine(line).split("\r\n");
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
    for (const p of parts) expect(p.includes("�")).toBe(false);
  });
});

describe("icalUtc", () => {
  it("writes UTC with a Z", () => {
    expect(icalUtc("2026-12-03T08:00:00-06:00")).toBe("20261203T140000Z");
  });
});

describe("eventsFromVisits", () => {
  it("builds the title from job number, job name and scope", () => {
    expect(one(base).summary).toBe("25-014 Hyatt Centric — Level 2 carpet tile");
  });
  it("leaves out what is missing from the title", () => {
    expect(one({ ...base, scope: null, project: { ...base.project, project_number: null } }).summary).toBe("Hyatt Centric");
  });
  it("uses the job's site address as the place", () => {
    expect(one(base).location).toBe("123 Main St, Winnipeg, MB");
  });
  it("has a stable id per visit that does not depend on the site address used", () => {
    const a = one(base).uid;
    expect(a).toBe(eventsFromVisits([{ ...base, scope: "Changed" }], { origin: "https://bmd-punch-list.lovable.app" })[0]!.uid);
    expect(a).toContain(base.id);
    expect(one({ ...base, id: "33333333-3333-4333-8333-333333333333" }).uid).not.toBe(a);
  });
  it("describes crew, site contact, notes and a link back to the job", () => {
    const d = one(base).description;
    expect(d).toContain("Crew: Fred Field");
    expect(d).toContain("Site contact: Sam Super, 204-555-0100");
    expect(d).toContain("Notes: Use the back door");
    expect(d).toContain(`${ORIGIN}/projects/${base.project_id}`);
  });
  it("falls back to the crew name ArrivePing reported", () => {
    expect(one({ ...base, assigned_name: null, crew: null, arriveping_assigned_to: "Rempsen Flooring" }).description).toContain("Crew: Rempsen Flooring");
  });
  it("works when the optional scheduling fields do not exist yet", () => {
    const e = one(base);
    expect(e.summary).not.toContain("Day");
    expect(e.summary).not.toContain("Tentative");
    expect(e.tentative).toBe(false);
    expect(e.description).not.toContain("Report to");
  });
  it("adds Day 2 of 3, Tentative and report-to when those fields exist", () => {
    const e = one({ ...base, run_number: 2, run_total: 3, tentative: true, report_to: "Shop, 55 Plymouth St", report_at: "2026-07-06T07:15:00-05:00", crew_confirmation: "confirmed" });
    expect(e.summary).toBe("25-014 Hyatt Centric — Level 2 carpet tile · Day 2 of 3 (Tentative)");
    expect(e.tentative).toBe(true);
    expect(e.description).toContain("Report to: Shop, 55 Plymouth St at 7:15 a.m.");
    expect(e.description).toContain("Crew: Fred Field (confirmed)");
  });
  it("reads other likely names for the same fields, and a plain clock time", () => {
    const e = one({ ...base, day_number: 1, day_count: 2, is_tentative: true, report_to_place: "Site trailer", report_to_time: "06:45:00" });
    expect(e.summary).toContain("Day 1 of 2 (Tentative)");
    expect(e.description).toContain("Report to: Site trailer at 6:45 a.m.");
  });
  it("ignores a run of one day and nonsense run numbers", () => {
    expect(one({ ...base, run_number: 1, run_total: 1 }).summary).not.toContain("Day");
    expect(one({ ...base, run_number: 4, run_total: 3 }).summary).not.toContain("Day");
    expect(one({ ...base, run_number: "x", run_total: 3 }).summary).not.toContain("Day");
  });
  it("marks a cancelled visit", () => {
    expect(one({ ...base, status: "cancelled" }).cancelled).toBe(true);
    expect(one(base).cancelled).toBe(false);
  });
  it("gives a visit with no end time one hour", () => {
    const e = one({ ...base, ends_at: null });
    expect(e.end).toBe("2026-12-03T15:00:00.000Z");
  });
  it("never carries prices, costs or internal notes, whatever the row holds", () => {
    const e = one({ ...base, price: 12345.67, cost: 999.5, labour_cost: "888.25", internal_notes: "margin 31%", billing_notes: "invoice net 30", project: { ...base.project, contract_value: 54321, client_billing_email: "ap@client.test" } });
    const all = JSON.stringify(e) + buildICalendar([e], { name: "x", now: NOW });
    for (const s of ["12345", "999.5", "888.25", "margin", "net 30", "54321", "ap@client.test"]) expect(all).not.toContain(s);
  });
  it("skips rows with no id or no readable start", () => {
    expect(eventsFromVisits([{ ...base, id: null }, { ...base, starts_at: "soon" }, null as never], { origin: ORIGIN })).toHaveLength(0);
  });
});

describe("buildICalendar", () => {
  const ics = (rows: Record<string, unknown>[]) => buildICalendar(eventsFromVisits(rows, { origin: ORIGIN }), { name: "BMD Projects — My visits", now: NOW });

  it("is a calendar with CRLF line ends and one event per visit", () => {
    const out = ics([base, { ...base, id: "33333333-3333-4333-8333-333333333333" }]);
    expect(out.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(out).toContain("X-WR-CALNAME:BMD Projects — My visits");
  });
  it("is still a valid empty calendar with no visits", () => {
    const out = ics([]);
    expect(out).toContain("BEGIN:VCALENDAR");
    expect(out).not.toContain("VEVENT");
  });
  it("writes start and end in UTC on both sides of a Winnipeg clock change", () => {
    // 8:00 a.m. in Winnipeg was 14:00 UTC on standard time (Fri 6 Mar 2026) and 13:00 UTC on daylight time (Mon 9 Mar 2026).
    const out = ics([
      { ...base, id: "aaaaaaaa-0000-4000-8000-000000000001", starts_at: "2026-03-06T08:00:00-06:00", ends_at: "2026-03-06T16:00:00-06:00" },
      { ...base, id: "aaaaaaaa-0000-4000-8000-000000000002", starts_at: "2026-03-09T08:00:00-05:00", ends_at: "2026-03-09T16:00:00-05:00" },
      // A visit that runs through the night the clocks changed keeps its true length (23 hours on the clock, 22 real hours here).
      { ...base, id: "aaaaaaaa-0000-4000-8000-000000000003", starts_at: "2026-03-07T18:00:00-06:00", ends_at: "2026-03-08T17:00:00-05:00" },
    ]);
    expect(out).toContain("DTSTART:20260306T140000Z");
    expect(out).toContain("DTEND:20260306T220000Z");
    expect(out).toContain("DTSTART:20260309T130000Z");
    expect(out).toContain("DTEND:20260309T210000Z");
    expect(out).toContain("DTSTART:20260308T000000Z");
    expect(out).toContain("DTEND:20260308T220000Z");
    expect(out).not.toContain("TZID");
  });
  it("shows the Winnipeg clock time for report-to on both sides of a clock change", () => {
    const d = (at: string) => one({ ...base, report_to: "Shop", report_at: at }).description;
    expect(d("2026-03-06T13:30:00Z")).toContain("at 7:30 a.m.");
    expect(d("2026-03-09T12:30:00Z")).toContain("at 7:30 a.m.");
  });
  it("escapes text and folds long lines", () => {
    const out = ics([{ ...base, notes: `Line one\nLine two; with, punctuation ${"long ".repeat(40)}` }]);
    for (const line of out.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const flat = unfold(out);
    expect(flat).toContain("LOCATION:123 Main St\\, Winnipeg\\, MB");
    expect(flat).toContain("Notes: Line one\\nLine two\; with\\, punctuation");
  });
  it("marks cancelled and tentative events", () => {
    expect(ics([{ ...base, status: "cancelled" }])).toContain("STATUS:CANCELLED");
    expect(ics([{ ...base, tentative: true }])).toContain("STATUS:TENTATIVE");
    expect(ics([base])).toContain("STATUS:CONFIRMED");
    // Cancelled wins over tentative.
    expect(ics([{ ...base, status: "cancelled", tentative: true }])).toContain("STATUS:CANCELLED");
  });
  it("keeps the same UID every time it is built", () => {
    const uid = (s: string) => /UID:(.+)/.exec(unfold(s))![1];
    expect(uid(ics([base]))).toBe(uid(buildICalendar(eventsFromVisits([base], { origin: ORIGIN }), { name: "n", now: new Date("2027-01-01T00:00:00Z") })));
  });
  it("leaves out LOCATION when the job has no address", () => {
    expect(ics([{ ...base, project: { ...base.project, address: null } }])).not.toContain("LOCATION");
  });
});
