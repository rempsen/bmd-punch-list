/** ArrivePing: where it lives, how we name our calls to it, and what we send. Pure: no env, no network. */
import { reportLine } from "@/lib/scheduling/assignments";
import { workBlock, type VisitLine } from "@/lib/visits/lines";

export const AP_BASE = "https://arriveping.com";
export const AP_MCP = `${AP_BASE}/api/mcp`;
/** Every ArrivePing API path in one place, so a wrong guess is a one-line fix. */
export const AP_PATHS = { workorders: "/api/v1/workorders", clients: "/api/v1/clients" } as const;
/** How ArrivePing knows a record came from BMD Projects; `external_ref` is the BMD id. */
export const EXTERNAL_SOURCE = "bmd_projects";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

/** Link to a work order in the ArrivePing admin. */
/** The work order in ArrivePing's office app; ArrivePing opens it from its Work orders page. */
export const apWorkOrderUrl = (id: string): string => `${AP_BASE}/admin/work-orders?open=${encodeURIComponent(id)}`;

/** The API key from the environment, or null when it is missing or blank. */
export function pickKey(env: Record<string, string | undefined>): string | null {
  return (env["ArrivePing_Api"] ?? "").trim() || (env["ARRIVEPING_API_KEY"] ?? "").trim() || null;
}

/** Same visit, same key: a retry after a timeout cannot create a second work order. */
export const idempotencyKey = (kind: "create" | "cancel", visitId: string): string =>
  kind === "create" ? `bmd-visit-${visitId}` : `bmd-visit-${visitId}-cancel`;

/** Each reschedule is its own action, so it carries the moment it was made. */
export const rescheduleKey = (visitId: string, nowMs: number): string => `bmd-visit-${visitId}-reschedule-${nowMs}`;

export type VisitForPush = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  crew: string | null;
  notes: string | null;
  site_contact: string | null;
  /** Not yet firm: never sent to ArrivePing until the tick is cleared. */
  tentative?: boolean | null;
  /** Where and when the crew reports. When present, it leads the notes for the crew. */
  report_to?: string | null;
  report_to_other?: string | null;
  report_time?: string | null;
  /** The estimate items this work order covers; they lead the crew's notes as a "Work:" block. */
  lines?: VisitLine[] | null;
};

/** Why a visit must not go to ArrivePing at all, or null when it may. Every send checks this one rule. */
export function visitSendBlock(visit: { tentative?: boolean | null }): "tentative" | null {
  return visit.tentative ? "tentative" : null;
}
export const TENTATIVE_MESSAGE = "This visit is tentative, so it was not sent to ArrivePing. Clear Tentative on the visit to send it.";
export type ProjectForPush = {
  id: string;
  name: string;
  number: string | null;
  address: string | null;
  client: string | null;
  client_id?: string | null;
  /** Address parts, used when the one-line address is blank. */
  street?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
};
/** A BMD client as ArrivePing needs it. */
export type ClientForPush = { id: string; name: string; email: string | null; phone: string | null; billing_address: string | null };

/** The visit's end, or eight hours after its start when none was set. Null when the start is not a date. */
function endOf(visit: VisitForPush): string | null {
  if (visit.ends_at) return visit.ends_at;
  const start = Date.parse(visit.starts_at);
  return Number.isNaN(start) ? null : new Date(start + EIGHT_HOURS_MS).toISOString();
}

/** The work order ArrivePing creates for an install visit. Anything we do not know is left out, never sent as null. */
/** The site address on one line: the project's address, or else its street, city, province and postal code. Null when there is none. */
export function siteAddress(project: ProjectForPush): string | null {
  const one = (project.address ?? "").trim();
  if (one) return one;
  const parts = [project.street, project.city, project.province, project.postal_code].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** ArrivePing takes one visit of up to 24 hours per work order. */
export const MAX_WORK_ORDER_MS = 24 * 60 * 60 * 1000;

/** Why ArrivePing would refuse this visit before it is sent, in words for the person scheduling it; null when it can go. */
export function visitPushProblem(visit: VisitForPush, project: ProjectForPush): string | null {
  if (!siteAddress(project)) return "The project has no site address, and ArrivePing needs one. Add it under Overview → Details → Edit, then send again.";
  const end = endOf(visit);
  if (end && Date.parse(end) - Date.parse(visit.starts_at) > MAX_WORK_ORDER_MS)
    return "ArrivePing takes one day per work order, and this visit runs longer than 24 hours. Schedule one visit per day, then send each.";
  return null;
}

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
  // "Report to: Shop for 7:00 a.m." leads, when the visit carries it (visits read before it existed do not).
  const report = visit.report_to !== undefined ? reportLine(visit) : null;
  const work = visit.lines?.length ? workBlock(visit.lines) : null;
  const notes = [work, report, crew ? `Crew: ${crew}` : null, filled(visit.notes)].filter(Boolean).join("\n");
  return {
    external_source: EXTERNAL_SOURCE,
    external_ref: visit.id,
    ...(clientId ? { client_id: clientId } : {}),
    title: `${project.number ? `${project.number} ` : ""}${project.name} — Install`,
    ...(siteAddress(project) ? { address: siteAddress(project) } : {}),
    ...(filled(visit.site_contact) ? { site_contact: { name: filled(visit.site_contact) } } : {}),
    start_at: visit.starts_at,
    ...(end ? { end_at: end } : {}),
    ...(notes ? { notes_for_crew: notes } : {}),
  };
}

/** One line of what a work order pays its installer, in the shape ArrivePing's charges are expected to take. */
export type InstallerPayLine = { description: string; quantity: number; uom: string; tech_pay_cents: number; charge_cents: number };

/**
 * What the crew is paid for each line of a work order (quantity × the rate it was valued at), as installer pay with no
 * customer charge. Lines with no rate are left out rather than sent as 0.
 *
 * TODO: not yet sent. ArrivePing's live API shape for charges / installer pay is unverified and unknown fields may 422,
 * so `workOrderPayload` does not carry this until it is confirmed — see status/outstanding-items-2026-11-24.md in the
 * BMD ERP & Estimating project.
 */
export function installerPayLines(visit: Pick<VisitForPush, "lines">): InstallerPayLine[] {
  return (visit.lines ?? [])
    .filter((l) => l.unit_labour_cost_cents !== null && l.unit_labour_cost_cents !== undefined && Number.isFinite(Number(l.unit_labour_cost_cents)))
    .map((l) => {
      const quantity = Number(l.quantity) || 0;
      return { description: l.description.trim(), quantity, uom: l.uom, tech_pay_cents: Math.round(Number(l.unit_labour_cost_cents) * quantity), charge_cents: 0 };
    });
}

/** The body ArrivePing's PATCH /api/v1/workorders/{id} takes when BMD re-times a visit: the schedule, and the site contact and crew notes as they now stand. */
export function reschedulePayload(visit: VisitForPush): Record<string, unknown> {
  const { start_at, end_at, site_contact, notes_for_crew } = workOrderPayload(visit, { id: "", name: "", number: null, address: null, client: null });
  // Contact and notes always travel, so a value the user blanked is cleared in ArrivePing too (an omitted field would keep the old text).
  return { start_at, ...(end_at ? { end_at } : {}), site_contact: site_contact ?? null, notes_for_crew: notes_for_crew ?? "" };
}

/** A completion photo as ArrivePing describes it (§9 of the API requirements): a signed, time-limited `url` and whatever else it knows. */
export type ApPhoto = { id: string; url: string; contentType: string | null; takenAt: string | null; takenBy: string | null; caption: string | null };

/**
 * The photos on a work order, from `photos[]` and `completion_photos[]` (on the record itself, or under `work_order`).
 * A bare URL counts as a photo; its URL (without its signature) is its id. Anything without an https URL is skipped.
 */
export function parseWorkOrderPhotos(workOrder: unknown): ApPhoto[] {
  const wo = pick(workOrder, "work_order") && typeof pick(workOrder, "work_order") === "object" ? pick(workOrder, "work_order") : workOrder;
  const lists = [pick(wo, "photos"), pick(wo, "completion_photos")].filter(Array.isArray) as unknown[][];
  const out: ApPhoto[] = [];
  const seen = new Set<string>();
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  for (const raw of lists.flat()) {
    const url = typeof raw === "string" ? raw : str(pick(raw, "url"));
    if (!url || !/^https:\/\//i.test(url)) continue;
    const rawId = typeof raw === "string" ? null : pick(raw, "id");
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? String(rawId) : (str(rawId) ?? url.split("?")[0]!);
    if (seen.has(id)) continue;
    seen.add(id);
    const takenAt = str(pick(raw, "taken_at"));
    const parsedAt = takenAt && !Number.isNaN(Date.parse(takenAt)) ? new Date(Date.parse(takenAt)).toISOString() : null;
    const by = pick(raw, "taken_by");
    out.push({
      id,
      url,
      contentType: str(pick(raw, "content_type")),
      takenAt: parsedAt,
      takenBy: str(by) ?? str(pick(by, "name")),
      caption: str(pick(raw, "caption")),
    });
  }
  return out;
}

const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/gif": "gif" };

/** Where a copied ArrivePing photo lives in the photo bucket: under the visit (which is how the bucket's read rule finds the job), named by ArrivePing's id. */
export function photoStoragePath(visitId: string, photo: Pick<ApPhoto, "id" | "contentType" | "url">): string {
  const ext = IMAGE_EXT[(photo.contentType ?? "").toLowerCase()] ?? (/\.(png|webp|heic|heif|gif)(\?|$)/i.exec(photo.url)?.[1]?.toLowerCase() ?? "jpg");
  const safe = photo.id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "photo";
  return `${visitId}/ap-${safe}.${ext}`;
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

/**
 * The Idempotency-Key sent to ArrivePing: BMD's own key plus a fingerprint of the request body.
 * ArrivePing keeps a key's answer (4xx included) for 24 hours and refuses the key with a different body, so a fixed key would
 * block a corrected retry for a day. With the fingerprint an identical retry is still replayed, and a corrected one runs;
 * duplicates stay impossible because ArrivePing also matches on `external_ref`.
 */
export function wireIdempotencyKey(key: string, body: unknown): string {
  // FNV-1a, 32-bit: a fingerprint, not a security measure.
  const text = JSON.stringify(body ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${key.slice(0, 190)}-${(h >>> 0).toString(16).padStart(8, "0")}`;
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

/**
 * Checks an integration webhook's X-ArrivePing-Signature: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` made
 * with the subscription's secret. Old or future-dated signatures (beyond `toleranceSecs`) fail, so a captured delivery
 * cannot be replayed later.
 */
export async function verifyArrivePingSignature(secret: string, rawBody: string, header: string | null | undefined, nowSecs = Math.floor(Date.now() / 1000), toleranceSecs = 300): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const t = Number(parts.get("t"));
  const got = parts.get("v1") ?? "";
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/i.test(got) || Math.abs(nowSecs - t) > toleranceSecs) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`)));
  const want = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  let diff = 0;
  const lower = got.toLowerCase();
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ lower.charCodeAt(i);
  return diff === 0;
}

/** The integration events BMD wants: who is on a job, when it is, and where the crew is. `subscriptionEvents` trims this to what ArrivePing offers. */
export const AP_WEBHOOK_EVENTS = [
  "workorder.assigned",
  "workorder.accepted",
  "assignment.accepted",
  "workorder.unassigned",
  "workorder.rescheduled",
  "workorder.enroute",
  "workorder.arrived",
  "workorder.started",
  "workorder.completed",
  "workorder.status_changed",
  "workorder.cancelled",
  "workorder.deleted",
] as const;

/** Plain words for an ArrivePing refusal while managing the webhook subscription. */
export function webhookSetupError(status: number, error: string): string {
  if (status === 401) return "ArrivePing did not accept the API key. Check that ArrivePing_Api holds a current key.";
  if (status === 403) return "The ArrivePing API key is missing the “Manage webhook subscriptions” permission. Create a key that has it and replace ArrivePing_Api.";
  if (status === 404) return "ArrivePing does not offer integration webhooks on this account yet.";
  if (status === 409) return "ArrivePing already has 10 webhooks for BMD Materials. Delete one in ArrivePing first.";
  return error;
}

/** Event names ArrivePing's GET /api/v1/events/types lists, from whichever shape it answers in (bare strings, `{name}`/`{type}`/`{event}` rows, or an object keyed by name). Unknown shape → null. */
export function offeredEventTypes(json: unknown): string[] | null {
  const root = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const list = Array.isArray(json) ? json : root && Array.isArray(root["data"]) ? root["data"] : root && Array.isArray(root["types"]) ? root["types"] : root && Array.isArray(root["events"]) ? root["events"] : null;
  if (list) {
    const names = list
      .map((row) => (typeof row === "string" ? row : row && typeof row === "object" ? (row as Record<string, unknown>)["name"] ?? (row as Record<string, unknown>)["type"] ?? (row as Record<string, unknown>)["event"] ?? (row as Record<string, unknown>)["id"] : null))
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    return names.length ? names : null;
  }
  if (root) {
    const keys = Object.keys(root).filter((k) => k.includes("."));
    return keys.length ? keys : null;
  }
  return null;
}

/** Events only subscribed to when ArrivePing's catalogue lists them: `status_changed` (the live API refused it, 422) and the
 *  dedicated acceptance events, which the catalogue may not have (acceptance is then read from `workorder.assigned`). */
export const AP_OPTIONAL_EVENTS = ["workorder.status_changed", "workorder.accepted", "assignment.accepted"] as const;

/** The events to subscribe to: the ones BMD wants that ArrivePing offers. With no usable list (`null`), everything BMD wants
 *  except the optional ones above. A readable list that offers none of BMD's
 *  events is a real answer, not a gap: the result is empty and the caller reports it instead of guessing. */
export function subscriptionEvents(offered: string[] | null): string[] {
  const wanted = [...AP_WEBHOOK_EVENTS] as string[];
  if (!offered) return wanted.filter((e) => !(AP_OPTIONAL_EVENTS as readonly string[]).includes(e));
  const have = new Set(offered);
  return wanted.filter((e) => have.has(e));
}
