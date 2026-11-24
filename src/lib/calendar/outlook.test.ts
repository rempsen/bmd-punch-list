import { describe, expect, it } from "bun:test";
import type { CalEvent } from "./ical";
import { graphEventBody, syncOutlook, type EventLink, type GraphCall } from "./outlook";

const ev = (n: number, over: Partial<CalEvent> = {}): CalEvent => ({
  visitId: `00000000-0000-4000-8000-00000000000${n}`,
  uid: `visit-${n}@x`,
  start: `2026-12-0${n}T14:00:00.000Z`,
  end: `2026-12-0${n}T22:00:00.000Z`,
  summary: `25-014 Hyatt — visit ${n}`,
  location: "123 Main St",
  description: "Crew: Fred",
  url: "https://projects.bmdmaterials.com/projects/p",
  cancelled: false,
  tentative: false,
  ...over,
});
const json = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A stand-in for Microsoft Graph's calendar: answers the calls the sync makes and remembers what it was asked. */
function fakeGraph(o: { fail?: (method: string, path: string) => Response | undefined } = {}) {
  const calendars = new Map<string, string>();
  const events = new Map<string, { calendarId: string; body: Record<string, unknown> }>();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let seq = 0;
  const graph: GraphCall = async (path, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, path, ...(body ? { body } : {}) });
    const failed = o.fail?.(method, path);
    if (failed) return failed;
    let m: RegExpExecArray | null;
    if (method === "GET" && path.startsWith("/me/calendars?")) {
      const name = /name eq '([^']+)'/.exec(decodeURIComponent(path))?.[1];
      return json(200, { value: [...calendars].filter(([, n]) => n === name).map(([id, n]) => ({ id, name: n })) });
    }
    if (method === "POST" && path === "/me/calendars") {
      const id = `cal-${++seq}`;
      calendars.set(id, String(body!["name"]));
      return json(201, { id, name: body!["name"] });
    }
    if (method === "GET" && (m = /^\/me\/calendars\/([^/?]+)\/events\?/.exec(path))) {
      if (!calendars.has(m[1]!)) return json(404, { error: { code: "ErrorItemNotFound" } });
      return json(200, { value: [...events].filter(([, e]) => e.calendarId === m![1]).map(([id]) => ({ id })) });
    }
    if (method === "GET" && (m = /^\/me\/calendars\/([^/?]+)\?/.exec(path))) return calendars.has(m[1]!) ? json(200, { id: m[1] }) : json(404, { error: { code: "ErrorItemNotFound" } });
    if (method === "POST" && (m = /^\/me\/calendars\/([^/?]+)\/events$/.exec(path))) {
      const id = `evt-${++seq}`;
      events.set(id, { calendarId: m[1]!, body: body! });
      return json(201, { id });
    }
    if (method === "PATCH" && (m = /^\/me\/events\/([^/?]+)$/.exec(path))) {
      const e = events.get(m[1]!);
      if (!e) return json(404, { error: { code: "ErrorItemNotFound" } });
      e.body = { ...e.body, ...body };
      return json(200, { id: m[1] });
    }
    if (method === "DELETE" && (m = /^\/me\/events\/([^/?]+)$/.exec(path))) return events.delete(m[1]!) ? json(204) : json(404, { error: { code: "ErrorItemNotFound" } });
    return json(400, { error: { message: `unexpected ${method} ${path}` } });
  };
  return { graph, calendars, events, calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

/** Runs a sync and keeps the links the way the server would. */
async function run(g: ReturnType<typeof fakeGraph>, state: { links: EventLink[]; calendarId: string | null }, events: CalEvent[], maxChanges?: number) {
  const out = await syncOutlook({ graph: g.graph, events, links: state.links, calendarId: state.calendarId, calendarName: "BMD Projects", ...(maxChanges ? { maxChanges } : {}) });
  const kept = state.links.filter((l) => !out.forget.includes(l.visit_id) && !out.save.some((s) => s.visit_id === l.visit_id));
  state.links = [...kept, ...out.save];
  state.calendarId = out.calendarId;
  return out;
}

describe("graphEventBody", () => {
  it("sends UTC times, the place and the notes, and nothing else", () => {
    expect(graphEventBody(ev(1))).toEqual({
      subject: "25-014 Hyatt — visit 1",
      body: { contentType: "text", content: "Crew: Fred" },
      start: { dateTime: "2026-12-01T14:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-12-01T22:00:00", timeZone: "UTC" },
      location: { displayName: "123 Main St" },
      showAs: "busy",
    });
  });
  it("shows a tentative visit as tentative", () => {
    expect(graphEventBody(ev(1, { tentative: true }))["showAs"]).toBe("tentative");
  });
});

describe("syncOutlook", () => {
  it("makes the calendar and one event per visit the first time", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    const out = await run(g, state, [ev(1), ev(2)]);
    expect(out.problem).toBeNull();
    expect([out.created, out.updated, out.removed, out.unchanged]).toEqual([2, 0, 0, 0]);
    expect([...g.calendars.values()]).toEqual(["BMD Projects"]);
    expect(g.events.size).toBe(2);
    expect(state.links.map((l) => l.visit_id).sort()).toEqual([ev(1).visitId, ev(2).visitId]);
    expect(state.calendarId).toBe([...g.calendars.keys()][0]!);
  });

  it("does nothing the second time: no duplicates", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    await run(g, state, [ev(1), ev(2)]);
    const before = g.writes().length;
    const out = await run(g, state, [ev(1), ev(2)]);
    expect([out.created, out.updated, out.removed, out.unchanged]).toEqual([0, 0, 0, 2]);
    expect(g.writes().length).toBe(before);
    expect(g.events.size).toBe(2);
    expect(g.calendars.size).toBe(1);
  });

  it("uses a calendar of that name that is already there instead of making a second", async () => {
    const g = fakeGraph();
    g.calendars.set("cal-existing", "BMD Projects");
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    await run(g, state, [ev(1)]);
    expect(g.calendars.size).toBe(1);
    expect(state.calendarId).toBe("cal-existing");
  });

  it("updates the event in place when the visit changes", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    await run(g, state, [ev(1)]);
    const id = state.links[0]!.event_id;
    const out = await run(g, state, [ev(1, { start: "2026-12-01T15:00:00.000Z", summary: "Moved" })]);
    expect([out.created, out.updated]).toEqual([0, 1]);
    expect(g.events.size).toBe(1);
    expect(state.links[0]!.event_id).toBe(id);
    expect(g.events.get(id)!.body["subject"]).toBe("Moved");
    expect((g.events.get(id)!.body["start"] as { dateTime: string }).dateTime).toBe("2026-12-01T15:00:00");
  });

  it("removes the event when the visit is cancelled or no longer in the list", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    await run(g, state, [ev(1), ev(2), ev(3)]);
    const out = await run(g, state, [ev(1), ev(2, { cancelled: true })]);
    expect(out.removed).toBe(2);
    expect(g.events.size).toBe(1);
    expect(state.links.map((l) => l.visit_id)).toEqual([ev(1).visitId]);
  });

  it("never creates an event for a visit that is already cancelled", async () => {
    const g = fakeGraph();
    const out = await run(g, { links: [], calendarId: null }, [ev(1, { cancelled: true })]);
    expect(out.created).toBe(0);
    expect(g.events.size).toBe(0);
  });

  it("puts back an event the person deleted in Outlook, once", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    await run(g, state, [ev(1), ev(2)]);
    g.events.delete(state.links.find((l) => l.visit_id === ev(1).visitId)!.event_id);
    const out = await run(g, state, [ev(1), ev(2)]);
    expect([out.created, out.unchanged]).toEqual([1, 1]);
    expect(g.events.size).toBe(2);
    expect((await run(g, state, [ev(1), ev(2)])).created).toBe(0);
  });

  it("starts again cleanly when the whole calendar was deleted in Outlook", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    await run(g, state, [ev(1), ev(2)]);
    g.calendars.clear();
    g.events.clear();
    const out = await run(g, state, [ev(1), ev(2)]);
    expect(out.created).toBe(2);
    expect(g.calendars.size).toBe(1);
    expect(g.events.size).toBe(2);
    expect(state.links).toHaveLength(2);
  });

  it("stops at the limit and says how many are left, then finishes on the next run", async () => {
    const g = fakeGraph();
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    const all = [ev(1), ev(2), ev(3), ev(4), ev(5)];
    const first = await run(g, state, all, 2);
    expect([first.created, first.remaining]).toEqual([2, 3]);
    const second = await run(g, state, all, 2);
    expect([second.created, second.unchanged, second.remaining]).toEqual([2, 2, 1]);
    const third = await run(g, state, all, 2);
    expect([third.created, third.remaining]).toEqual([1, 0]);
    expect(g.events.size).toBe(5);
  });

  it("reports missing permission (403) without changing anything", async () => {
    const g = fakeGraph({ fail: () => json(403, { error: { code: "ErrorAccessDenied", message: "Access is denied. Check credentials and try again." } }) });
    const out = await run(g, { links: [], calendarId: null }, [ev(1)]);
    expect(out.problem?.reason).toBe("consent");
    expect(out.created).toBe(0);
    expect(g.writes()).toHaveLength(0);
  });

  it("reports an expired sign-in (401) as reconnect", async () => {
    const g = fakeGraph({ fail: () => json(401, { error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } }) });
    expect((await run(g, { links: [], calendarId: null }, [ev(1)])).problem?.reason).toBe("reconnect");
  });

  it("keeps what was done before Microsoft started refusing, so the next run does not repeat it", async () => {
    let posts = 0;
    const g = fakeGraph({ fail: (method, path) => (method === "POST" && path.endsWith("/events") && ++posts > 1 ? json(429, { error: { code: "TooManyRequests", message: "Slow down" } }) : undefined) });
    const state = { links: [] as EventLink[], calendarId: null as string | null };
    const out = await run(g, state, [ev(1), ev(2), ev(3)]);
    expect(out.problem).toEqual({ reason: "error", message: "Slow down" });
    expect(out.created).toBe(1);
    expect(state.links).toHaveLength(1);
    expect(state.calendarId).not.toBeNull();
    posts = -10;
    const again = await run(g, state, [ev(1), ev(2), ev(3)]);
    expect([again.created, again.unchanged]).toEqual([2, 1]);
    expect(g.events.size).toBe(3);
    expect(g.calendars.size).toBe(1);
  });

  it("sends a repeat-safe id with each new event", async () => {
    const g = fakeGraph();
    await run(g, { links: [], calendarId: null }, [ev(1)]);
    const post = g.calls.find((c) => c.method === "POST" && c.path.endsWith("/events"))!;
    expect((post.body as Record<string, unknown>)["transactionId"]).toBe(`visit-${ev(1).visitId}`);
  });
});
