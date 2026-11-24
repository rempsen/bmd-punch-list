import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appOrigin } from "@/lib/app-url";
import { ReconnectError } from "@/lib/ms/core";
import { buildICalendar, eventsFromVisits } from "./ical";
import { CALENDAR_APP_NAME, calendarTitle, dueForSync, sha256Hex, syncSummary, type FeedResult, type FeedScope } from "./feed";
import { hasCalendarScope, syncOutlook, type EventLink } from "./outlook";

/** The calendar tables and functions are server-side only (and newer than the generated types). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => supabaseAdmin as any;
type Row = Record<string, unknown>;

/**
 * The .ics file for a calendar link. The database decides everything about access: it finds the link by the hash of its
 * token, checks the owner is still active, and returns only the visits that person may see today.
 */
export async function readFeed(token: string, requestUrl: string, now: Date = new Date()): Promise<FeedResult> {
  const { data, error } = await admin().rpc("calendar_feed_read", { _hash: await sha256Hex(token) });
  if (error || !data) return { status: 404 };
  const feed = data as { limited?: boolean; scope?: FeedScope; job?: string | null; visits?: Row[] };
  if (feed.limited) return { status: 429 };
  const events = eventsFromVisits(feed.visits ?? [], { origin: appOrigin(requestUrl) });
  return { status: 200, ics: buildICalendar(events, { name: calendarTitle(CALENDAR_APP_NAME, feed.scope === "all" ? "all" : "mine", feed.job), now }) };
}

export type OutlookState = { configured: boolean; account_email: string | null; consented: boolean };

export async function outlookState(userId: string): Promise<OutlookState & { scopes: string | null }> {
  const { msEnv } = await import("@/lib/ms/graph.server");
  const { data } = await admin().from("ms_connections").select("account_email,scopes").eq("user_id", userId).maybeSingle();
  return { configured: !!msEnv(), account_email: data?.account_email ?? null, consented: hasCalendarScope(data?.scopes), scopes: data?.scopes ?? null };
}

export async function setOutlookEnabled(userId: string, on: boolean): Promise<void> {
  const { error } = await admin()
    .from("calendar_feeds")
    .upsert({ user_id: userId, outlook_enabled: on, updated_at: new Date().toISOString(), ...(on ? {} : { outlook_error: null }) }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

export type SyncReply =
  | { ok: true; skipped: boolean; message: string }
  | { ok: false; reason: "off" | "not_set_up" | "consent" | "reconnect" | "error"; message: string };

/**
 * Makes one person's Outlook calendar match their visits. `force` false is the quiet check made when Scheduling is
 * opened: it does nothing if the last sync was under 15 minutes ago.
 */
export async function syncOutlookFor(userId: string, o: { force: boolean; requestUrl: string }): Promise<SyncReply> {
  const { data: feed } = await admin().from("calendar_feeds").select("outlook_enabled,outlook_calendar_id,outlook_synced_at").eq("user_id", userId).maybeSingle();
  if (!feed?.outlook_enabled) return { ok: false, reason: "off", message: "Connect your Outlook calendar first." };
  if (!o.force && !dueForSync(feed.outlook_synced_at)) return { ok: true, skipped: true, message: "Synced a few minutes ago." };

  const state = await outlookState(userId);
  if (!state.configured) return { ok: false, reason: "not_set_up", message: "Microsoft 365 is not set up yet." };
  const note = async (message: string | null, done: boolean, calendarId?: string | null) => {
    await admin()
      .from("calendar_feeds")
      .update({ outlook_error: message, ...(done ? { outlook_synced_at: new Date().toISOString() } : {}), ...(calendarId !== undefined ? { outlook_calendar_id: calendarId } : {}) })
      .eq("user_id", userId);
  };
  if (!state.consented) {
    const message = "Outlook has not given permission to add to your calendar. Connect your Outlook calendar again.";
    await note(message, false);
    return { ok: false, reason: "consent", message };
  }

  const { msGraph } = await import("@/lib/ms/graph.server");
  const g = msGraph();
  let accessToken: string;
  try {
    accessToken = await g.getAccessToken(userId, (state.scopes ?? "").split(/\s+/).filter(Boolean));
  } catch (e) {
    const reconnect = e instanceof ReconnectError;
    const message = reconnect ? "Your Outlook connection has expired. Connect your Outlook calendar again." : "Microsoft could not be reached. Try again in a minute.";
    await note(message, false);
    return { ok: false, reason: reconnect ? "reconnect" : "error", message };
  }

  const [{ data: visits, error: visitsError }, { data: links, error: linksError }] = await Promise.all([
    admin().rpc("calendar_visits_for", { _user: userId }),
    admin().from("calendar_outlook_events").select("visit_id,event_id,fingerprint").eq("user_id", userId),
  ]);
  // Without both lists a sync could remove or repeat events, so it does not run.
  if (visitsError || linksError) return { ok: false, reason: "error", message: "The schedule could not be read. Try again in a minute." };

  const out = await syncOutlook({
    graph: (path, init) => g.graph(accessToken, path, init),
    events: eventsFromVisits((visits ?? []) as Row[], { origin: appOrigin(o.requestUrl) }),
    links: (links ?? []) as EventLink[],
    calendarId: feed.outlook_calendar_id ?? null,
    calendarName: CALENDAR_APP_NAME,
  });

  // Store what was done even when it stopped part-way, so the next run carries on instead of starting over.
  if (out.forget.length) await admin().from("calendar_outlook_events").delete().eq("user_id", userId).in("visit_id", out.forget);
  if (out.save.length) {
    const stamp = new Date().toISOString();
    const { error } = await admin()
      .from("calendar_outlook_events")
      .upsert(out.save.map((l) => ({ user_id: userId, ...l, updated_at: stamp })), { onConflict: "user_id,visit_id" });
    if (error) {
      await note("Outlook was updated but the record of it could not be saved.", false, out.calendarId);
      return { ok: false, reason: "error", message: "Outlook was updated but the record of it could not be saved. Press Sync again." };
    }
  }
  await note(out.problem?.message ?? null, !out.problem, out.calendarId);
  if (out.problem) return { ok: false, reason: out.problem.reason, message: out.problem.message };
  return { ok: true, skipped: false, message: syncSummary(out) };
}
