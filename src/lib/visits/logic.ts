/** Install visits and what ArrivePing tells us about them. */
export type VisitStatus = "scheduled" | "en_route" | "arrived" | "completed" | "cancelled";
export type Visit = { id: string; starts_at: string; ends_at: string | null; crew: string | null; notes: string | null; site_contact: string | null; arriveping_job_id: string | null; status: VisitStatus };

/** Compares the secret a caller sent with ours without leaking where they differ. No secret configured means nobody gets in. */
export function secretMatches(got: string | null | undefined, expected: string | null | undefined): boolean {
  if (!got || !expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: Record<string, VisitStatus> = { en_route: "en_route", enroute: "en_route", on_the_way: "en_route", arrived: "arrived", arrival: "arrived", completed: "completed", complete: "completed", cancelled: "cancelled", canceled: "cancelled" };

/** Picks the status and the visit out of a webhook body. Anything it does not recognise is ignored, never guessed at. */
export function parseArrivePingEvent(body: unknown): { status: VisitStatus; jobId: string | null; visitId: string | null; at: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const d = (b["data"] && typeof b["data"] === "object" ? b["data"] : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => b[k] ?? d[k]).find((v) => typeof v === "string" || typeof v === "number");
  const name = String(pick("event", "type", "status") ?? "").toLowerCase().split(/[.:]/).pop()!;
  const status = STATUSES[name];
  if (!status) return null;
  const job = pick("job_id", "jobId");
  const ext = pick("external_id", "externalId", "reference");
  const visitId = typeof ext === "string" && UUID.test(ext) ? ext : null;
  if (job == null && !visitId) return null;
  const at = pick("occurred_at", "timestamp", "at");
  return { status, jobId: job == null ? null : String(job), visitId, at: typeof at === "string" ? at : null };
}

const ORDER: VisitStatus[] = ["scheduled", "en_route", "arrived", "completed"];
const NOTES: Record<VisitStatus, string> = { scheduled: "Install visit scheduled", en_route: "Crew on the way", arrived: "Crew arrived on site", completed: "Install visit completed", cancelled: "Install visit cancelled" };

/** The visit's next state for an incoming status, or null when it changes nothing (a repeat, or a step backwards). */
export function applyVisitEvent(visit: Pick<Visit, "status" | "crew">, to: VisitStatus): { status: VisitStatus; note: string } | null {
  if (visit.status === "cancelled" || visit.status === "completed" || visit.status === to) return null;
  if (to !== "cancelled" && ORDER.indexOf(to) <= ORDER.indexOf(visit.status)) return null;
  return { status: to, note: `${NOTES[to]}${visit.crew ? ` (${visit.crew})` : ""}` };
}
export const visitNote = (status: VisitStatus, crew: string | null) => `${NOTES[status]}${crew ? ` (${crew})` : ""}`;

const cell = (v: string | null | undefined) => {
  // A leading =, +, - or @ would be run as a formula by a spreadsheet; an apostrophe makes it plain text.
  const s = /^[=+\-@]/.test(v ?? "") ? `'${v}` : (v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Visits as a CSV to load into ArrivePing by hand. The Reference column is what ArrivePing should send back as external_id. */
export function visitsCsv(visits: Visit[], project: { name: string; number: string | null; address: string | null; client: string | null }): string {
  const iso = (s: string | null) => (s ? new Date(s).toISOString().replace(".000Z", "Z") : "");
  const rows = visits.map((v) => [v.id, `${project.number ? `${project.number} ` : ""}${project.name}`, project.client, project.address, iso(v.starts_at), iso(v.ends_at), v.crew, v.site_contact, v.notes].map(cell).join(","));
  return ["Reference,Project,Client,Address,Start,End,Crew,Site contact,Notes", ...rows].join("\r\n");
}
