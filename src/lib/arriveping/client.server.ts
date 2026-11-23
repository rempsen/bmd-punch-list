import { AP_BASE, AP_MCP, describeApiError, mcpErrorMessage, parseJsonReply, parseMcpToolsList, pickKey, wireIdempotencyKey } from "./core";

/** Server only: the key is read from the environment on each call and never reaches the browser. */
export const arrivepingKey = (): string | null => pickKey(process.env);

const TIMEOUT_MS = 15_000;

/** `not_configured` and `unreachable` have status 0; `http` is a reply ArrivePing sent that we could not use, with its body in `json` when it was JSON (a 409 hands back the existing record there). */
export type ApResult = { ok: true; status: number; json: unknown } | { ok: false; status: number; code: "not_configured" | "unreachable" | "http"; error: string; json?: unknown };
export type ApRequest = { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; idempotencyKey?: string };

const failure = (error: unknown): string => `Could not reach ArrivePing: ${error instanceof Error ? error.message : String(error)}`;

/** The reply as JSON, or null when it is empty or not JSON (a proxy's HTML page, say). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** An MCP reply may be plain JSON or a server-sent event stream; in a stream the answer is the last `data:` line. */
function parseMcpBody(text: string, contentType: string | null): unknown {
  if (!contentType?.includes("text/event-stream")) return parseJson(text);
  const data = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).pop();
  return data ? parseJson(data.slice("data:".length).trim()) : null;
}

/** Calls the ArrivePing REST API with the key. Never throws: a missing key, a refusal and a timeout all come back as `ok: false`. */
export async function apFetch(path: string, init: ApRequest, fetchImpl: typeof fetch = fetch): Promise<ApResult> {
  const key = arrivepingKey();
  if (!key) return { ok: false, status: 0, code: "not_configured", error: "ArrivePing is not configured — add secret ArrivePing_Api" };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  // BMD's key stays the same per record; the wire key also fingerprints the body (see wireIdempotencyKey).
  if (init.idempotencyKey) headers["Idempotency-Key"] = wireIdempotencyKey(init.idempotencyKey, init.body);
  try {
    // The host's fetch must be called bare; handing it over as a property makes it throw "Illegal invocation".
    const res = await fetchImpl(`${AP_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, code: "http", error: describeApiError(res.status, text), json: parseJson(text) };
    const reply = parseJsonReply(res.status, text);
    return reply.ok ? { ok: true, status: res.status, json: reply.json } : { ok: false, status: res.status, code: "http", error: reply.error };
  } catch (error) {
    return { ok: false, status: 0, code: "unreachable", error: failure(error) };
  }
}

/** Asks ArrivePing's MCP endpoint which tools the key can use. A quick way to prove the key and the connection work. */
export async function mcpProbe(fetchImpl: typeof fetch = fetch): Promise<{ ok: true; tools: string[] } | { ok: false; error: string }> {
  const key = arrivepingKey();
  if (!key) return { ok: false, error: "ArrivePing is not configured — add secret ArrivePing_Api" };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const rpc = async (body: unknown, extra: Record<string, string> = {}) =>
    fetchImpl(AP_MCP, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "bmd-projects", version: "1.0" } } });
    if (!init.ok) return { ok: false, error: describeApiError(init.status, await init.text()) };
    const sessionId = init.headers.get("Mcp-Session-Id");
    const initError = mcpErrorMessage(parseMcpBody(await init.text(), init.headers.get("content-type")));
    if (initError) return { ok: false, error: initError };
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId ? { "Mcp-Session-Id": sessionId } : {});
    const text = await list.text();
    if (!list.ok) return { ok: false, error: describeApiError(list.status, text) };
    const parsed = parseMcpToolsList(parseMcpBody(text, list.headers.get("content-type")));
    return "error" in parsed ? { ok: false, error: `Connection failed: ${parsed.error}` } : { ok: true, tools: parsed.tools };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}
