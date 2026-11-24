/**
 * Puts install visits into one person's Outlook calendar through Microsoft Graph. One direction only: the app writes,
 * Outlook is never read back into a visit. No environment access here: the caller passes the Graph call and the stored
 * links (visit ↔ Outlook event), so the same code runs on the server and under test.
 */
import type { CalEvent } from "./ical";

/** The Graph permission (delegated) that lets the app write to the signed-in person's own calendar. */
export const CALENDAR_SCOPE = "Calendars.ReadWrite";
export const hasCalendarScope = (scopes: string | null | undefined) => (scopes ?? "").split(/\s+/).includes(CALENDAR_SCOPE);

/**
 * What the "Connect my Outlook calendar" sign-in asks for: everything the person has already allowed (so mail and files
 * keep working on the new token) plus their calendar. Someone with no connection who does not send email is asked for the calendar only.
 */
export function connectScopes(existing: string | null | undefined, maySendMail: boolean, mailScopes: readonly string[]): string[] {
  const had = (existing ?? "").split(/\s+/).filter(Boolean);
  const base = had.length ? had : maySendMail ? [...mailScopes] : ["offline_access", "User.Read"];
  return [...new Set([...base, CALENDAR_SCOPE])];
}

export type GraphCall = (path: string, init?: { method?: string; body?: string }) => Promise<Response>;
export type EventLink = { visit_id: string; event_id: string; fingerprint: string };
export type SyncProblem = { reason: "consent" | "reconnect" | "error"; message: string };
export type SyncOutcome = {
  calendarId: string | null;
  /** Links to store (new or changed) and visits whose link is gone. Always returned, problem or not, so a later run never repeats work. */
  save: EventLink[];
  forget: string[];
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Changes still to make because this run reached its limit. */
  remaining: number;
  problem: SyncProblem | null;
};

/** The platform allows a limited number of outgoing calls per request, so one run makes at most this many changes. */
export const MAX_CHANGES = 30;
const MAX_PAGES = 4;

const graphTime = (iso: string) => ({ dateTime: iso.replace(/\.\d{3}Z$/, "").replace(/Z$/, ""), timeZone: "UTC" });

export function graphEventBody(e: CalEvent): Record<string, unknown> {
  return {
    subject: e.summary,
    body: { contentType: "text", content: e.description },
    start: graphTime(e.start),
    end: graphTime(e.end),
    location: { displayName: e.location ?? "" },
    showAs: e.tentative ? "tentative" : "busy",
  };
}

/** A short stamp of what was last sent for a visit, to tell whether it needs sending again. */
export function fingerprint(body: unknown): string {
  const s = JSON.stringify(body);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

class Stop extends Error {
  constructor(public problem: SyncProblem) {
    super(problem.message);
  }
}

async function refuse(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const said = body.error?.message?.split("\n")[0]?.slice(0, 200);
  if (res.status === 401) throw new Stop({ reason: "reconnect", message: "Your Outlook connection has expired. Connect your Outlook calendar again." });
  if (res.status === 403) throw new Stop({ reason: "consent", message: "Outlook has not given permission to add to your calendar. Connect your Outlook calendar again." });
  throw new Stop({ reason: "error", message: said || `Microsoft returned ${res.status}` });
}

/**
 * Makes the person's "BMD Projects" calendar match the visits: adds what is new, changes what changed, removes what was
 * cancelled or is no longer theirs. Running it again with nothing changed makes no changes.
 */
export async function syncOutlook(o: {
  graph: GraphCall;
  events: readonly CalEvent[];
  links: readonly EventLink[];
  calendarId: string | null;
  calendarName: string;
  maxChanges?: number;
}): Promise<SyncOutcome> {
  const out: SyncOutcome = { calendarId: o.calendarId, save: [], forget: [], created: 0, updated: 0, removed: 0, unchanged: 0, remaining: 0, problem: null };
  const max = o.maxChanges ?? MAX_CHANGES;
  let changes = 0;
  const send = (path: string, method: string, body?: unknown) => o.graph(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let links = new Map(o.links.map((l) => [l.visit_id, l]));

  try {
    // 1. The calendar. A stored one that has gone (deleted in Outlook) took its events with it.
    if (out.calendarId) {
      const res = await o.graph(`/me/calendars/${encodeURIComponent(out.calendarId)}?$select=id`);
      if (res.status === 404) {
        out.calendarId = null;
        out.forget.push(...links.keys());
        links = new Map();
      } else if (!res.ok) await refuse(res);
    }
    if (!out.calendarId) {
      const name = o.calendarName.replace(/'/g, "''");
      const found = await o.graph(`/me/calendars?$filter=${encodeURIComponent(`name eq '${name}'`)}&$select=id,name`);
      if (!found.ok) await refuse(found);
      const first = ((await found.json()) as { value?: { id?: string }[] }).value?.[0]?.id;
      if (first) out.calendarId = first;
      else {
        const made = await send("/me/calendars", "POST", { name: o.calendarName });
        if (!made.ok) await refuse(made);
        out.calendarId = ((await made.json()) as { id?: string }).id ?? null;
        if (!out.calendarId) throw new Stop({ reason: "error", message: "Microsoft did not return the new calendar." });
      }
    }
    const calendar = encodeURIComponent(out.calendarId);

    // 2. Which of our events are still there (someone may have deleted one in Outlook). Unknown when the list is too long to read.
    let present: Set<string> | null = new Set();
    let next: string | null = `/me/calendars/${calendar}/events?$select=id&$top=250`;
    for (let page = 0; next; page++) {
      if (page >= MAX_PAGES) {
        present = null;
        break;
      }
      const res: Response = await o.graph(next);
      if (!res.ok) await refuse(res);
      const body = (await res.json()) as { value?: { id?: string }[]; "@odata.nextLink"?: string };
      for (const e of body.value ?? []) if (e.id) present.add(e.id);
      next = body["@odata.nextLink"] ?? null;
    }

    // 3. Remove events for visits that were cancelled or are no longer in the list.
    const wanted = new Map(o.events.filter((e) => !e.cancelled).map((e) => [e.visitId, e]));
    for (const link of links.values()) {
      if (wanted.has(link.visit_id)) continue;
      if (changes >= max) {
        out.remaining++;
        continue;
      }
      changes++;
      const res = await send(`/me/events/${encodeURIComponent(link.event_id)}`, "DELETE");
      if (!res.ok && res.status !== 404) await refuse(res);
      out.forget.push(link.visit_id);
      out.removed++;
    }

    // 4. Add and change.
    for (const e of wanted.values()) {
      const body = graphEventBody(e);
      const stamp = fingerprint(body);
      let link = links.get(e.visitId);
      if (link && present && !present.has(link.event_id)) link = undefined;
      if (link && link.fingerprint === stamp) {
        out.unchanged++;
        continue;
      }
      if (changes >= max) {
        out.remaining++;
        continue;
      }
      changes++;
      if (link) {
        const res = await send(`/me/events/${encodeURIComponent(link.event_id)}`, "PATCH", body);
        if (res.ok) {
          out.save.push({ visit_id: e.visitId, event_id: link.event_id, fingerprint: stamp });
          out.updated++;
          continue;
        }
        if (res.status !== 404) await refuse(res);
      }
      // transactionId lets Microsoft recognise a repeat of the same request instead of making a second event.
      const res = await send(`/me/calendars/${calendar}/events`, "POST", { ...body, transactionId: `visit-${e.visitId}` });
      if (!res.ok) await refuse(res);
      const id = ((await res.json()) as { id?: string }).id;
      if (!id) throw new Stop({ reason: "error", message: "Microsoft did not return the new event." });
      out.save.push({ visit_id: e.visitId, event_id: id, fingerprint: stamp });
      out.created++;
    }
  } catch (err) {
    out.problem = err instanceof Stop ? err.problem : { reason: "error", message: "Microsoft could not be reached. Try again in a minute." };
  }
  return out;
}
