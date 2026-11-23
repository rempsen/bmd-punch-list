import { AP_BASE, AP_MCP, describeApiError, parseMcpToolsList, pickKey } from "./core";

/** Server only: the key is read from the environment on each call and never reaches the browser. */
export const arrivepingKey = (): string | null => pickKey(process.env);

const TIMEOUT_MS = 15_000;

export type ApResult = { ok: true; status: number; json: unknown } | { ok: false; status: number; error: string };
export type ApRequest = { method: "GET" | "POST" | "PATCH"; body?: unknown; idempotencyKey?: string };

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
  if (!key) return { ok: false, status: 0, error: "ArrivePing is not configured — add secret ArrivePing_Api" };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  try {
    // The host's fetch must be called bare; handing it over as a property makes it throw "Illegal invocation".
    const res = await fetchImpl(`${AP_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: describeApiError(res.status, text) };
    return { ok: true, status: res.status, json: parseJson(text) };
  } catch (error) {
    return { ok: false, status: 0, error: failure(error) };
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
    await init.text();
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId ? { "Mcp-Session-Id": sessionId } : {});
    const text = await list.text();
    if (!list.ok) return { ok: false, error: describeApiError(list.status, text) };
    const parsed = parseMcpToolsList(parseMcpBody(text, list.headers.get("content-type")));
    return "error" in parsed ? { ok: false, error: `Connection failed: ${parsed.error}` } : { ok: true, tools: parsed.tools };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}
