import { describe, expect, it } from "bun:test";
import { calendarTitle, dueForSync, feedHttp, feedUrl, sha256Hex, syncSummary, tokenFromFile } from "./feed";

const TOKEN = "0123456789abcdef".repeat(4);

describe("calendar link", () => {
  it("builds the address a calendar app subscribes to", () => {
    expect(feedUrl("https://projects.bmdmaterials.com", TOKEN)).toBe(`https://projects.bmdmaterials.com/api/public/calendar/${TOKEN}.ics`);
  });
  it("reads the token back out of the file name, with or without .ics", () => {
    expect(tokenFromFile(`${TOKEN}.ics`)).toBe(TOKEN);
    expect(tokenFromFile(TOKEN)).toBe(TOKEN);
    expect(tokenFromFile(`${TOKEN.toUpperCase()}.ICS`)).toBe(TOKEN);
  });
  it("refuses anything that is not a token", () => {
    for (const bad of ["", "abc.ics", `${TOKEN}x.ics`, `${TOKEN.slice(1)}.ics`, "../../etc/passwd", `${TOKEN}.ics/extra`, undefined, null]) expect(tokenFromFile(bad as never)).toBeNull();
  });
  it("hashes a token the way the database does (sha-256, hex)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("names the calendar by what it covers", () => {
    expect(calendarTitle("BMD Projects", "mine", null)).toBe("BMD Projects — My visits");
    expect(calendarTitle("BMD Projects", "all", null)).toBe("BMD Projects — All visits");
    expect(calendarTitle("BMD Projects", "all", "Hyatt Centric")).toBe("BMD Projects — Hyatt Centric");
  });
});

describe("dueForSync", () => {
  const now = Date.parse("2026-11-24T18:00:00Z");
  it("is due when never synced or last synced 15 minutes ago or more", () => {
    expect(dueForSync(null, now)).toBe(true);
    expect(dueForSync("2026-11-24T17:45:00Z", now)).toBe(true);
    expect(dueForSync("2026-11-24T17:00:00Z", now)).toBe(true);
  });
  it("is not due inside 15 minutes", () => {
    expect(dueForSync("2026-11-24T17:45:01Z", now)).toBe(false);
    expect(dueForSync("2026-11-24T17:59:00Z", now)).toBe(false);
  });
  it("treats an unreadable time as never", () => {
    expect(dueForSync("yesterday", now)).toBe(true);
  });
});

describe("syncSummary", () => {
  it("says what changed in plain words", () => {
    expect(syncSummary({ created: 2, updated: 1, removed: 0, unchanged: 4, remaining: 0 })).toBe("2 added, 1 changed. Your Outlook calendar is up to date.");
    expect(syncSummary({ created: 0, updated: 0, removed: 1, unchanged: 0, remaining: 0 })).toBe("1 removed. Your Outlook calendar is up to date.");
  });
  it("says so when nothing changed", () => {
    expect(syncSummary({ created: 0, updated: 0, removed: 0, unchanged: 7, remaining: 0 })).toBe("Nothing to change. Your Outlook calendar is up to date.");
  });
  it("says how many are left when the run stopped at its limit", () => {
    expect(syncSummary({ created: 30, updated: 0, removed: 0, unchanged: 0, remaining: 12 })).toBe("30 added. 12 more to go: press Sync again.");
  });
});

describe("feedHttp", () => {
  it("serves the calendar as text/calendar, cached privately for a few minutes", () => {
    const r = feedHttp({ status: 200, ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" });
    expect(r.status).toBe(200);
    expect(r.body).toContain("BEGIN:VCALENDAR");
    expect(r.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("private, max-age=300");
  });
  it("answers an unknown or revoked link with a bare 404 that says nothing", () => {
    const r = feedHttp({ status: 404 });
    expect([r.status, r.body]).toEqual([404, "Not found"]);
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("tells a calendar that asks too often to wait five minutes", () => {
    const r = feedHttp({ status: 429 });
    expect(r.status).toBe(429);
    expect(r.headers["retry-after"]).toBe("300");
  });
});
