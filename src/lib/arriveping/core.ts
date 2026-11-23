/** ArrivePing: where it lives, how we name our calls to it, and what we send. Pure: no env, no network. */
export const AP_BASE = "https://arriveping.com";
export const AP_MCP = `${AP_BASE}/api/mcp`;
/** Every ArrivePing API path in one place, so a wrong guess is a one-line fix. */
export const AP_PATHS = { workorders: "/api/v1/workorders", clients: "/api/v1/clients" } as const;
/** How ArrivePing knows a record came from BMD Projects; `external_ref` is the BMD id. */
export const EXTERNAL_SOURCE = "bmd_projects";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

/** Link to a work order in the ArrivePing admin. */
export const apWorkOrderUrl = (id: string): string => `${AP_BASE}/admin/workorders/${encodeURIComponent(id)}`;

/** The API key from the environment, or null when it is missing or blank. */
export function pickKey(env: Record<string, string | undefined>): string | null {
  return (env["ArrivePing_Api"] ?? "").trim() || (env["ARRIVEPING_API_KEY"] ?? "").trim() || null;
}

/** Same visit, same key: a retry after a timeout cannot create a second work order. */
export const idempotencyKey = (kind: "create" | "cancel", visitId: string): string =>
  kind === "create" ? `bmd-visit-${visitId}` : `bmd-visit-${visitId}-cancel`;

/** Each reschedule is its own action, so it carries the moment it was made. */
export const rescheduleKey = (visitId: string, nowMs: number): string => `bmd-visit-${visitId}-reschedule-${nowMs}`;

export type VisitForPush = { id: string; starts_at: string; ends_at: string | null; crew: string | null; notes: string | null; site_contact: string | null };
export type ProjectForPush = { id: string; name: string; number: string | null; address: string | null; client: string | null; client_id?: string | null };
/** A BMD client as ArrivePing needs it. */
export type ClientForPush = { id: string; name: string; email: string | null; phone: string | null; billing_address: string | null };

/** The visit's end, or eight hours after its start when none was set. Null when the start is not a date. */
function endOf(visit: VisitForPush): string | null {
  if (visit.ends_at) return visit.ends_at;
  const start = Date.parse(visit.starts_at);
  return Number.isNaN(start) ? null : new Date(start + EIGHT_HOURS_MS).toISOString();
}

/** The work order ArrivePing creates for an install visit. Anything we do not know is left out, never sent as null. */
/** A trimmed value, or nothing when it is blank. */
const filled = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * The body ArrivePing's POST /api/v1/workorders takes. Only fields ArrivePing reads are sent: the crew hint goes into the crew's notes.
 * `clientId` is the ArrivePing client the work order belongs to; ArrivePing requires it, so it is only left out of the copy logged before the client is known.
 */
export function workOrderPayload(visit: VisitForPush, project: ProjectForPush, clientId?: string | null): Record<string, unknown> {
  const end = endOf(visit);
  const crew = filled(visit.crew);
  const notes = [crew ? `Crew: ${crew}` : null, filled(visit.notes)].filter(Boolean).join("\n");
  return {
    external_source: EXTERNAL_SOURCE,
    external_ref: visit.id,
    ...(clientId ? { client_id: clientId } : {}),
    title: `${project.number ? `${project.number} ` : ""}${project.name} — Install`,
    ...(filled(project.address) ? { address: filled(project.address) } : {}),
    ...(filled(visit.site_contact) ? { site_contact: { name: filled(visit.site_contact) } } : {}),
    start_at: visit.starts_at,
    ...(end ? { end_at: end } : {}),
    ...(notes ? { notes_for_crew: notes } : {}),
  };
}

/** The body ArrivePing's POST /api/v1/clients takes. `withEmail: false` is for an email that already belongs to someone on the ArrivePing team. */
export function clientPayload(client: ClientForPush, opts: { withEmail: boolean } = { withEmail: true }): Record<string, unknown> {
  const email = opts.withEmail ? filled(client.email) : null;
  return {
    external_source: EXTERNAL_SOURCE,
    external_ref: client.id,
    name: client.name.trim(),
    ...(email ? { email } : {}),
    ...(filled(client.phone) ? { phone: filled(client.phone) } : {}),
    ...(filled(client.billing_address) ? { billing_address: filled(client.billing_address) } : {}),
  };
}

/** The Idempotency-Key for creating a client: one per BMD client, and a second for the retry without email. */
export const clientKey = (clientId: string, variant: "create" | "no-email" = "create"): string =>
  variant === "create" ? `bmd-client-${clientId}` : `bmd-client-${clientId}-no-email`;

const pick = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

/** ArrivePing's error code from an error reply, e.g. `duplicate_external_ref`. */
export const errorCode = (json: unknown): string | null => {
  const code = pick(pick(json, "error"), "code");
  return typeof code === "string" ? code : null;
};

/**
 * A 409 from ArrivePing that hands back a record that already exists: our own earlier create (`duplicate_external_ref`)
 * or, for clients, one with the same email (`client_exists`). Anything else is not a match.
 */
export function existingFromConflict(json: unknown, kind: "client" | "work_order"): { id: string; via: "external_ref" | "email" } | null {
  const code = errorCode(json);
  const via = code === "duplicate_external_ref" ? "external_ref" : code === "client_exists" && kind === "client" ? "email" : null;
  const id = pick(pick(json, kind), "id");
  return via && typeof id === "string" && id.trim() !== "" ? { id, via } : null;
}

/** The message of a JSON-RPC error reply, or null when the body is not one. */
export function mcpErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && message !== "" ? message : null;
}

/** Tool names out of a JSON-RPC `tools/list` reply. Anything else (an HTML error page, an empty body) is reported, not guessed at. */
export function parseMcpToolsList(body: unknown): { tools: string[] } | { error: string } {
  const rpcError = mcpErrorMessage(body);
  if (rpcError) return { error: rpcError };
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
  const said = apErrorText(body);
  if (status === 403) return `ArrivePing refused: the API key lacks the scope for this call (403)${said ? `. ${said}` : ""}`;
  if (status === 401) return "ArrivePing rejected the API key (401)";
  if (status === 404 && !said) return "ArrivePing endpoint not found (404) — check AP_PATHS";
  if (said) return `ArrivePing refused (${status}): ${said}`;
  const detail = body.slice(0, 200);
  return detail === "" ? `ArrivePing error ${status}` : `ArrivePing error ${status}: ${detail}`;
}

/** ArrivePing's own words from an `{ error: { message, fields } }` body, e.g. "Some fields need attention. client_id: …". Null when the body is not one. */
function apErrorText(body: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const error = pick(json, "error");
  const message = pick(error, "message");
  if (typeof message !== "string" || message.trim() === "") return null;
  const fields = pick(error, "fields");
  const parts =
    fields && typeof fields === "object"
      ? Object.entries(fields as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => `${k}: ${v as string}`)
      : [];
  return [message.trim(), ...parts].join(" ").slice(0, 400);
}

/** A successful reply's JSON. An empty body (204) is `null`; anything else that is not JSON means we reached the wrong place. */
export function parseJsonReply(status: number, text: string): { ok: true; json: unknown } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, json: null };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, error: `ArrivePing returned a non-JSON reply (${status}) — check AP_PATHS` };
  }
}

/** A row still pending after this long was interrupted mid-push (the process stopped between recording and sending). */
export const STALE_PENDING_MS = 10 * 60 * 1000;

/** Whether a person may retry this outbox row: failed outbound rows, and outbound rows stuck pending past STALE_PENDING_MS. Inbound rows are never retried here; ArrivePing redelivers them. */
export function retryable(
  row: { direction: "out" | "in"; status: string; created_at: string },
  nowMs = Date.now(),
): boolean {
  if (row.direction !== "out") return false;
  if (row.status === "failed") return true;
  if (row.status !== "pending") return false;
  const created = Date.parse(row.created_at);
  return Number.isFinite(created) && nowMs - created >= STALE_PENDING_MS;
}
