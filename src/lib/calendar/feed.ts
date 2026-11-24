/** Small pure rules for calendar links and the Outlook sync. No I/O. */

/** The app's own name, as it shows in a person's calendar list (the subscribed calendar and the Outlook calendar). */
export const CALENDAR_APP_NAME = "BMD Projects";
export const FEED_PATH = "/api/public/calendar";
/** How often visits are pushed to Outlook when the person opens Scheduling. */
export const SYNC_EVERY_MS = 15 * 60_000;
export type FeedScope = "mine" | "all";

const TOKEN = /^[0-9a-f]{64}$/;

export const feedUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${FEED_PATH}/${token}.ics`;

/** The token in "<token>.ics" (the .ics is optional), or null when it is not one of ours. */
export function tokenFromFile(file: string | null | undefined): string | null {
  const t = String(file ?? "").toLowerCase().replace(/\.ics$/, "");
  return TOKEN.test(t) ? t : null;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const calendarTitle = (app: string, scope: FeedScope, job: string | null | undefined) => `${app} — ${job?.trim() ? job.trim() : scope === "all" ? "All visits" : "My visits"}`;

export function dueForSync(lastSyncedAt: string | null | undefined, now: number = Date.now()): boolean {
  const t = Date.parse(lastSyncedAt ?? "");
  return Number.isNaN(t) || now - t >= SYNC_EVERY_MS;
}

export function syncSummary(r: { created: number; updated: number; removed: number; unchanged: number; remaining: number }): string {
  const parts = [r.created ? `${r.created} added` : null, r.updated ? `${r.updated} changed` : null, r.removed ? `${r.removed} removed` : null].filter(Boolean);
  const did = parts.length ? `${parts.join(", ")}.` : "Nothing to change.";
  return r.remaining ? `${did} ${r.remaining} more to go: press Sync again.` : `${did} Your Outlook calendar is up to date.`;
}

export type FeedResult = { status: 200; ics: string } | { status: 404 } | { status: 429 };
/** The HTTP answer for a calendar link. An unknown, replaced or turned-off link gets a 404 with no detail. */
export function feedHttp(r: FeedResult): { status: number; body: string; headers: Record<string, string> } {
  if (r.status === 200) {
    return {
      status: 200,
      body: r.ics,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="visits.ics"',
        "cache-control": "private, max-age=300",
        "x-robots-tag": "noindex",
        "referrer-policy": "no-referrer",
      },
    };
  }
  if (r.status === 429) return { status: 429, body: "Too many requests", headers: { "retry-after": "300", "cache-control": "no-store" } };
  return { status: 404, body: "Not found", headers: { "cache-control": "no-store" } };
}
