/**
 * Install visits as calendar events, and those events as an iCalendar (.ics) file. Pure: no I/O.
 *
 * Only the fields named here ever reach a calendar. A visit row may carry anything else (it is read with `select *` so
 * the feed keeps working as columns are added); prices, costs and internal notes are never read.
 */
import { SCHEDULE_TZ } from "@/lib/visits/logic";

export type CalEvent = {
  visitId: string;
  /** Stable for the life of the visit, whichever site address the feed is read from. */
  uid: string;
  /** ISO, UTC. */
  start: string;
  end: string;
  summary: string;
  location: string | null;
  description: string;
  url: string;
  cancelled: boolean;
  tentative: boolean;
};

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The part after the @ in an event id. Fixed, so an event keeps its id on every address the app is served from. */
export const UID_DOMAIN = "visits.bmd-projects";
const DEFAULT_LENGTH_MS = 60 * 60_000;

const text = (row: Row | null | undefined, ...names: string[]): string | null => {
  for (const n of names) {
    const v = row?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};
const whole = (row: Row, ...names: string[]): number | null => {
  for (const n of names) {
    const v = row[n];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  }
  return null;
};
const flag = (row: Row, ...names: string[]) => names.some((n) => row[n] === true);

const clock = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone }).format(d);
/** A report-to time as people read it. Takes a full timestamp (shown in site time) or a plain clock time ("06:45:00"). */
function reportTime(v: string | null, timeZone: string): string | null {
  if (!v) return null;
  const hm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (hm) return clock(new Date(Date.UTC(2000, 0, 1, Number(hm[1]), Number(hm[2]))), "UTC");
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : clock(new Date(t), timeZone);
}

/**
 * One event per visit. Reads the newer scheduling fields (day of a run, tentative, report-to, crew confirmation) only
 * when the row has them, under any of the names they are likely to be given.
 */
export function eventsFromVisits(rows: readonly Row[], o: { origin: string; timeZone?: string }): CalEvent[] {
  const tz = o.timeZone ?? SCHEDULE_TZ;
  const out: CalEvent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = text(row, "id");
    const startMs = Date.parse(text(row, "starts_at") ?? "");
    if (!id || !UUID.test(id) || Number.isNaN(startMs)) continue;
    const endRaw = Date.parse(text(row, "ends_at") ?? "");
    const endMs = !Number.isNaN(endRaw) && endRaw > startMs ? endRaw : startMs + DEFAULT_LENGTH_MS;

    const project = (row["project"] && typeof row["project"] === "object" ? row["project"] : {}) as Row;
    const projectId = text(row, "project_id") ?? text(project, "id");
    const tentative = flag(row, "tentative", "is_tentative");
    const day = whole(row, "run_number", "run_day", "day_number", "run_index");
    const of = whole(row, "run_total", "run_days", "day_count", "run_count", "run_length");
    const run = day && of && of > 1 && day <= of ? `Day ${day} of ${of}` : null;

    const job = [text(project, "project_number"), text(project, "name")].filter(Boolean).join(" ") || "Install visit";
    const scope = text(row, "scope");
    const summary = `${job}${scope ? ` — ${scope}` : ""}${run ? ` · ${run}` : ""}${tentative ? " (Tentative)" : ""}`;

    const crew = text(row, "assigned_name", "crew", "arriveping_assigned_to");
    // The schedule stores confirmation as not_sent / waiting / confirmed / declined, and report-to as site / shop / other (+ its own text).
    const confirmationRaw = text(row, "crew_confirmation", "confirmation_status", "crew_confirmation_status", "confirmation");
    const confirmation = confirmationRaw === "not_sent" ? null : confirmationRaw === "declined" ? "can't make it" : confirmationRaw;
    const placeRaw = text(row, "report_to", "report_to_place", "report_place", "report_to_location");
    const place = placeRaw === "site" ? "Site" : placeRaw === "shop" ? "Shop" : placeRaw === "other" ? (text(row, "report_to_other") ?? "See notes") : placeRaw;
    const at = reportTime(text(row, "report_at", "report_to_time", "report_time", "report_to_at"), tz);
    const url = `${o.origin.replace(/\/+$/, "")}/projects/${projectId ?? ""}`;
    const lines = [
      crew ? `Crew: ${crew}${confirmation ? ` (${confirmation.replace(/_/g, " ")})` : ""}` : null,
      place || at ? `Report to: ${[place, at ? `at ${at}` : null].filter(Boolean).join(" ")}` : null,
      text(row, "site_contact") ? `Site contact: ${text(row, "site_contact")}` : null,
      text(row, "notes") ? `Notes: ${text(row, "notes")}` : null,
      projectId ? `Job: ${url}` : null,
    ].filter((l): l is string => l != null);

    out.push({
      visitId: id,
      uid: `visit-${id.toLowerCase()}@${UID_DOMAIN}`,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      summary,
      location: text(project, "address"),
      description: lines.join("\n"),
      url,
      cancelled: text(row, "status") === "cancelled",
      tentative,
    });
  }
  return out;
}

/** TEXT values: backslash, semicolon and comma are escaped, a line break becomes \n, other control characters go. */
export function escapeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const utf8 = new TextEncoder();
/** Content lines are at most 75 octets; a longer one continues on the next line after a single space. Characters stay whole. */
export function foldLine(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    if (size + n > 75) {
      parts.push(cur);
      cur = " ";
      size = 1;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n");
}

/** 2026-12-03T14:00:00.000Z → 20261203T140000Z */
export const icalUtc = (v: string | Date): string => new Date(v).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** The whole .ics file. `now` stamps the events (calendar apps want a stamp; it does not affect identity). */
export function buildICalendar(events: readonly CalEvent[], o: { name: string; now: Date }): string {
  const stamp = icalUtc(o.now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BMD Projects//Install visits//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(o.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icalUtc(e.start)}`,
      `DTEND:${icalUtc(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      `STATUS:${e.cancelled ? "CANCELLED" : e.tentative ? "TENTATIVE" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
