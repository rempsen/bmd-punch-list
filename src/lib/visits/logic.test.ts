import { describe, expect, test } from "bun:test";
import { applyVisitEvent, parseArrivePingEvent, secretMatches, visitsCsv } from "./logic";

const visit = { id: "11111111-1111-1111-1111-111111111111", starts_at: "2026-12-01T14:00:00Z", ends_at: "2026-12-01T22:00:00Z", crew: "Brodie + 2", notes: "Level 2, rooms 201-212", site_contact: "Pat Client 204-555-0100", arriveping_job_id: "AP-77", status: "scheduled" as const };

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
    expect(parseArrivePingEvent({ event: "arrived", job_id: "AP-77", occurred_at: "2026-12-01T14:05:00Z" })).toEqual({ status: "arrived", jobId: "AP-77", visitId: null, at: "2026-12-01T14:05:00Z" });
    expect(parseArrivePingEvent({ type: "job.en_route", data: { jobId: 77, external_id: visit.id } })).toEqual({ status: "en_route", jobId: "77", visitId: visit.id, at: null });
    expect(parseArrivePingEvent({ event: "Completed", external_id: visit.id })).toMatchObject({ status: "completed", visitId: visit.id });
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

describe("visit export", () => {
  test("a CSV ArrivePing can import, with commas and quotes kept intact", () => {
    const csv = visitsCsv([{ ...visit, notes: 'Bring 4" base, adhesive' }], { name: "Hyatt Centric", number: "26-041", address: "325 Broadway, Winnipeg, MB", client: "Kothari Group" });
    const [head, row] = csv.split("\r\n");
    expect(head).toBe("Reference,Project,Client,Address,Start,End,Crew,Site contact,Notes");
    expect(row).toBe(`${visit.id},26-041 Hyatt Centric,Kothari Group,"325 Broadway, Winnipeg, MB",2026-12-01T14:00:00Z,2026-12-01T22:00:00Z,Brodie + 2,Pat Client 204-555-0100,"Bring 4"" base, adhesive"`);
  });
});
