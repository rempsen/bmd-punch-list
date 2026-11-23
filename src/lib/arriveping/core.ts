/** ArrivePing: where it lives, how we name our calls to it, and what we send. Pure: no env, no network. */
export const AP_BASE = "https://arriveping.com";
export const AP_MCP = `${AP_BASE}/api/mcp`;
/** Every ArrivePing API path in one place, so a wrong guess is a one-line fix. */
export const AP_PATHS = { workorders: "/api/v1/workorders" } as const;

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

/** Link to a work order in the ArrivePing admin. */
export const apWorkOrderUrl = (id: string): string => `${AP_BASE}/admin/workorders/${encodeURIComponent(id)}`;

/** The API key from the environment, or null when it is missing or blank. */
export function pickKey(env: Record<string, string | undefined>): string | null {
  const key = (env["ArrivePing_Api"] ?? env["ARRIVEPING_API_KEY"] ?? "").trim();
  return key === "" ? null : key;
}

/** Same visit, same key: a retry after a timeout cannot create a second work order. */
export const idempotencyKey = (kind: "create" | "cancel", visitId: string): string =>
  kind === "create" ? `bmd-visit-${visitId}` : `bmd-visit-${visitId}-cancel`;

/** Each reschedule is its own action, so it carries the moment it was made. */
export const rescheduleKey = (visitId: string, nowMs: number): string => `bmd-visit-${visitId}-reschedule-${nowMs}`;

export type VisitForPush = { id: string; starts_at: string; ends_at: string | null; crew: string | null; notes: string | null; site_contact: string | null };
export type ProjectForPush = { id: string; name: string; number: string | null; address: string | null; client: string | null; arriveping_customer_id?: string | null };

/** The visit's end, or eight hours after its start when none was set. Null when the start is not a date. */
function endOf(visit: VisitForPush): string | null {
  if (visit.ends_at) return visit.ends_at;
  const start = Date.parse(visit.starts_at);
  return Number.isNaN(start) ? null : new Date(start + EIGHT_HOURS_MS).toISOString();
}

/** The work order ArrivePing creates for an install visit. Anything we do not know is left out, never sent as null. */
export function workOrderPayload(visit: VisitForPush, project: ProjectForPush): Record<string, unknown> {
  const end = endOf(visit);
  return {
    external_source: "bmd_projects",
    external_ref: visit.id,
    title: `${project.number ? `${project.number} ` : ""}${project.name} — Install`,
    ...(project.number ? { reference: project.number } : {}),
    ...(project.arriveping_customer_id ? { customer_id: project.arriveping_customer_id } : {}),
    ...(project.address ? { site_address: { line1: project.address } } : {}),
    ...(visit.site_contact ? { site_contact: { name: visit.site_contact } } : {}),
    start_at: visit.starts_at,
    ...(end ? { end_at: end } : {}),
    ...(visit.crew ? { crew_hint: visit.crew } : {}),
    ...(visit.notes ? { notes_for_crew: visit.notes } : {}),
    tags: ["bmd", "install"],
  };
}

/** Tool names out of a JSON-RPC `tools/list` reply. Anything else (an HTML error page, an empty body) is reported, not guessed at. */
export function parseMcpToolsList(body: unknown): { tools: string[] } | { error: string } {
  const unexpected = { error: "unexpected response" };
  if (!body || typeof body !== "object") return unexpected;
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object") return unexpected;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return unexpected;
  const names: string[] = [];
  for (const tool of tools) {
    const name = tool && typeof tool === "object" ? (tool as { name?: unknown }).name : undefined;
    if (typeof name !== "string") return unexpected;
    names.push(name);
  }
  return { tools: names };
}

/** A sentence a person can act on for a failed ArrivePing call. */
export function describeApiError(status: number, body: string): string {
  if (status === 403) return "ArrivePing refused: the API key lacks the scope for this call (403)";
  if (status === 401) return "ArrivePing rejected the API key (401)";
  if (status === 404) return "ArrivePing endpoint not found (404) — check AP_PATHS";
  return `ArrivePing error ${status}: ${body.slice(0, 200)}`;
}
