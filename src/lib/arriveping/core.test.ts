import { describe, expect, test } from "bun:test";
import { verifyArrivePingSignature, webhookSetupError, AP_BASE, apWorkOrderUrl, siteAddress, visitPushProblem, wireIdempotencyKey, clientKey, clientPayload, describeApiError, existingFromConflict, idempotencyKey, parseJsonReply, parseMcpToolsList, pickKey, rescheduleKey, workOrderPayload, retryable } from "./core";

const visit = { id: "11111111-1111-1111-1111-111111111111", starts_at: "2026-12-01T14:00:00Z", ends_at: "2026-12-01T22:00:00Z", crew: "Brodie + 2", notes: "Level 2, rooms 201-212", site_contact: "Pat Client 204-555-0100" };
const project = { id: "p1", name: "Test Take Off", number: "26-002", address: "Winnipeg, MB", client: "Brian & Gail Chornoboy" };

const noNulls = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.every(noNulls);
  if (typeof value === "object") return Object.values(value).every(noNulls);
  return true;
};

describe("API key", () => {
  test("prefers ArrivePing_Api and falls back to ARRIVEPING_API_KEY", () => {
    expect(pickKey({ ArrivePing_Api: " primary ", ARRIVEPING_API_KEY: "fallback" })).toBe("primary");
    expect(pickKey({ ARRIVEPING_API_KEY: "fallback" })).toBe("fallback");
  });
  test("a missing, empty or blank key is null", () => {
    expect(pickKey({})).toBeNull();
    expect(pickKey({ ArrivePing_Api: "   " })).toBeNull();
    expect(pickKey({ ArrivePing_Api: "", ARRIVEPING_API_KEY: undefined })).toBeNull();
  });
  test("a blank primary falls back to the other name", () => {
    expect(pickKey({ ArrivePing_Api: "  ", ARRIVEPING_API_KEY: " fallback " })).toBe("fallback");
  });
});

describe("idempotency keys", () => {
  test("create and cancel are stable per visit", () => {
    expect(idempotencyKey("create", visit.id)).toBe(`bmd-visit-${visit.id}`);
    expect(idempotencyKey("cancel", visit.id)).toBe(`bmd-visit-${visit.id}-cancel`);
  });
  test("a reschedule key carries the moment it was made", () => {
    expect(rescheduleKey(visit.id, 1700000000000)).toBe(`bmd-visit-${visit.id}-reschedule-1700000000000`);
  });
});

describe("work order payload", () => {
  test("matches ArrivePing's work order fields, with the client it belongs to", () => {
    const body = workOrderPayload(visit, project, "cl_42");
    expect(body).toEqual({
      external_source: "bmd_projects",
      external_ref: visit.id,
      client_id: "cl_42",
      title: "26-002 Test Take Off — Install",
      address: "Winnipeg, MB",
      site_contact: { name: "Pat Client 204-555-0100" },
      start_at: "2026-12-01T14:00:00Z",
      end_at: "2026-12-01T22:00:00Z",
      notes_for_crew: "Crew: Brodie + 2\nLevel 2, rooms 201-212",
    });
    expect(noNulls(body)).toBe(true);
  });
  test("sends nothing ArrivePing would silently drop", () => {
    const body = workOrderPayload(visit, project, "cl_42");
    for (const key of ["reference", "crew_hint", "tags", "customer_id", "site_address"]) expect(body).not.toHaveProperty(key);
  });
  test("without a client yet, client_id is left out (logged payload before the client is resolved)", () => {
    expect(workOrderPayload(visit, project)).not.toHaveProperty("client_id");
  });
  test("a visit with no end runs eight hours from its start", () => {
    expect(workOrderPayload({ ...visit, ends_at: null }, project, "cl_42")["end_at"]).toBe("2026-12-01T22:00:00.000Z");
  });
  test("crew alone, or notes alone, still reach the crew", () => {
    expect(workOrderPayload({ ...visit, notes: null }, project, "c")["notes_for_crew"]).toBe("Crew: Brodie + 2");
    expect(workOrderPayload({ ...visit, crew: null }, project, "c")["notes_for_crew"]).toBe("Level 2, rooms 201-212");
  });
  test("leaves out everything the visit and project do not have", () => {
    const body = workOrderPayload({ ...visit, crew: null, notes: null, site_contact: null }, { ...project, number: null, address: null }, "c");
    expect(body["title"]).toBe("Test Take Off — Install");
    for (const key of ["address", "site_contact", "notes_for_crew"]) expect(body).not.toHaveProperty(key);
    expect(noNulls(body)).toBe(true);
  });
});

describe("site address and the checks before sending", () => {
  test("the one-line address wins; otherwise the parts are joined", () => {
    expect(siteAddress(project)).toBe("Winnipeg, MB");
    expect(siteAddress({ ...project, address: " ", street: "325 Broadway", city: "Winnipeg", province: "MB", postal_code: "" })).toBe("325 Broadway, Winnipeg, MB");
    expect(siteAddress({ ...project, address: null })).toBeNull();
  });
  test("the work order uses the joined parts when the one-line address is blank", () => {
    expect(workOrderPayload(visit, { ...project, address: null, street: "325 Broadway", city: "Winnipeg" }, "c")["address"]).toBe("325 Broadway, Winnipeg");
  });
  test("a visit with an address, within a day, can go", () => {
    expect(visitPushProblem(visit, project)).toBeNull();
  });
  test("no address is caught before sending", () => {
    expect(visitPushProblem(visit, { ...project, address: null })).toContain("no site address");
  });
  test("a visit over 24 hours is caught before sending, with the one-per-day rule", () => {
    expect(visitPushProblem({ ...visit, ends_at: "2026-12-04T22:00:00Z" }, project)).toContain("one day per work order");
    expect(visitPushProblem({ ...visit, ends_at: "2026-12-02T14:00:00Z" }, project)).toBeNull();
  });
});

describe("client payload", () => {
  const client = { id: "11111111-2222-4333-8444-555555555555", name: "Brian & Gail Chornoboy", email: "brian@example.com", phone: "204-555-0100", billing_address: "1 Main St, Winnipeg, MB" };
  test("carries BMD's id so a repeat create finds the same client", () => {
    expect(clientPayload(client)).toEqual({
      external_source: "bmd_projects",
      external_ref: client.id,
      name: "Brian & Gail Chornoboy",
      email: "brian@example.com",
      phone: "204-555-0100",
      billing_address: "1 Main St, Winnipeg, MB",
    });
  });
  test("can leave the email out, for when it belongs to someone on the ArrivePing team", () => {
    expect(clientPayload(client, { withEmail: false })).not.toHaveProperty("email");
  });
  test("blank fields are left out, never sent empty", () => {
    const body = clientPayload({ ...client, email: "  ", phone: null, billing_address: "" });
    for (const key of ["email", "phone", "billing_address"]) expect(body).not.toHaveProperty(key);
    expect(noNulls(body)).toBe(true);
  });
  test("keys are stable per client", () => {
    expect(clientKey(client.id)).toBe(`bmd-client-${client.id}`);
    expect(clientKey(client.id, "no-email")).toBe(`bmd-client-${client.id}-no-email`);
  });
});

describe("the Idempotency-Key sent on the wire", () => {
  const key = "bmd-visit-v1";
  test("the same request always sends the same key, so a lost reply is replayed, not repeated", () => {
    expect(wireIdempotencyKey(key, { a: 1, b: "x" })).toBe(wireIdempotencyKey(key, { a: 1, b: "x" }));
  });
  test("a corrected request gets a new key, so ArrivePing does not refuse it as a reused key", () => {
    expect(wireIdempotencyKey(key, { a: 1 })).not.toBe(wireIdempotencyKey(key, { a: 2 }));
  });
  test("it stays readable and inside ArrivePing's 200-character limit", () => {
    const out = wireIdempotencyKey(key, { big: "x".repeat(10_000) });
    expect(out.startsWith(`${key}-`)).toBe(true);
    expect(out).toMatch(/^bmd-visit-v1-[0-9a-f]{8}$/);
    expect(wireIdempotencyKey("k".repeat(300), {}).length).toBeLessThanOrEqual(200);
  });
});

describe("409 replies that hand back the existing record", () => {
  test("a client already linked to our reference", () => {
    expect(existingFromConflict({ error: { code: "duplicate_external_ref" }, client: { id: "cl_1" } }, "client")).toEqual({ id: "cl_1", via: "external_ref" });
  });
  test("a client found by email", () => {
    expect(existingFromConflict({ error: { code: "client_exists" }, client: { id: "cl_2" } }, "client")).toEqual({ id: "cl_2", via: "email" });
  });
  test("a work order already linked to our reference", () => {
    expect(existingFromConflict({ error: { code: "duplicate_external_ref" }, work_order: { id: "wo_1" } }, "work_order")).toEqual({ id: "wo_1", via: "external_ref" });
  });
  test("anything else is not a match", () => {
    expect(existingFromConflict({ error: { code: "email_taken" } }, "client")).toBeNull();
    expect(existingFromConflict({ error: { code: "duplicate_external_ref" }, client: null }, "client")).toBeNull();
    expect(existingFromConflict(null, "client")).toBeNull();
  });
});

describe("MCP tools list", () => {
  test("reads tool names from a JSON-RPC result", () => {
    expect(parseMcpToolsList({ jsonrpc: "2.0", result: { tools: [{ name: "list_workorders" }, { name: "create_workorder" }] } })).toEqual({ tools: ["list_workorders", "create_workorder"] });
  });
  test("a JSON-RPC error keeps its message", () => {
    expect(parseMcpToolsList({ jsonrpc: "2.0", id: 2, error: { code: -32001, message: "Invalid session" } })).toEqual({ error: "Invalid session" });
  });
  test("anything else is an unexpected response", () => {
    expect(parseMcpToolsList("<html>")).toEqual({ error: "unexpected response" });
    expect(parseMcpToolsList(null)).toEqual({ error: "unexpected response" });
    expect(parseMcpToolsList({ result: {} })).toEqual({ error: "unexpected response" });
    expect(parseMcpToolsList({ result: { tools: [{ title: "no name" }] } })).toEqual({ error: "unexpected response" });
  });
});

describe("API errors", () => {
  test("say what to fix for the statuses we expect", () => {
    expect(describeApiError(403, "")).toContain("lacks the scope");
    expect(describeApiError(401, "")).toBe("ArrivePing rejected the API key (401)");
    expect(describeApiError(404, "")).toContain("check AP_PATHS");
  });
  test("an empty body leaves no dangling colon", () => {
    expect(describeApiError(500, "")).toBe("ArrivePing error 500");
  });
  test("ArrivePing's error body is read out field by field", () => {
    const body = JSON.stringify({ error: { code: "validation_error", message: "Some fields need attention.", fields: { client_id: "Invalid input: expected string, received undefined" } } });
    expect(describeApiError(422, body)).toBe("ArrivePing refused (422): Some fields need attention. client_id: Invalid input: expected string, received undefined");
  });
  test("a scope refusal keeps ArrivePing's own words", () => {
    const body = JSON.stringify({ error: { code: "forbidden", message: "This key needs the clients:write scope." } });
    expect(describeApiError(403, body)).toBe("ArrivePing refused: the API key lacks the scope for this call (403). This key needs the clients:write scope.");
  });
  test("other statuses carry the first 200 characters of the body", () => {
    const text = describeApiError(500, "x".repeat(500));
    expect(text).toBe(`ArrivePing error 500: ${"x".repeat(200)}`);
  });
});

describe("work order link", () => {
  test("points at the admin page and escapes the id", () => {
    expect(apWorkOrderUrl("wo 1/2")).toBe(`${AP_BASE}/admin/work-orders?open=wo%201%2F2`);
  });
});

describe("success replies", () => {
  test("JSON is parsed and an empty body is null", () => {
    expect(parseJsonReply(201, '{"id":"wo_1"}')).toEqual({ ok: true, json: { id: "wo_1" } });
    expect(parseJsonReply(204, "")).toEqual({ ok: true, json: null });
  });
  test("a 200 that is not JSON is a failure, not a push", () => {
    expect(parseJsonReply(200, "<!doctype html><html>")).toEqual({ ok: false, error: "ArrivePing returned a non-JSON reply (200) — check AP_PATHS" });
  });
});

describe("retryable", () => {
  const now = Date.parse("2026-12-01T12:00:00Z");
  const row = (o: Partial<{ direction: "out" | "in"; status: string; created_at: string }>) => ({
    direction: "out" as const, status: "failed", created_at: "2026-12-01T11:00:00Z", ...o,
  });
  test("a failed outbound row may be retried", () => expect(retryable(row({}), now)).toBe(true));
  test("an inbound row is never retried here", () => expect(retryable(row({ direction: "in" }), now)).toBe(false));
  test("a fresh pending row is still in flight", () => expect(retryable(row({ status: "pending", created_at: "2026-12-01T11:55:00Z" }), now)).toBe(false));
  test("a pending row older than the stale window may be retried", () => expect(retryable(row({ status: "pending", created_at: "2026-12-01T11:40:00Z" }), now)).toBe(true));
  test("sent, acked and ignored rows are not retried", () => {
    for (const status of ["sent", "acked", "ignored"]) expect(retryable(row({ status }), now)).toBe(false);
  });
});

describe("ArrivePing webhook signatures", () => {
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const secret = "whsec_test";
  const body = '{"id":"evt_1","type":"workorder.assigned"}';
  const sign = (t: number, b = body, s = secret) => `t=${t},v1=${createHmac("sha256", s).update(`${t}.${b}`).digest("hex")}`;
  const now = 1_800_000_000;

  test("a signature made with the subscription's secret over the raw body passes", async () => {
    expect(await verifyArrivePingSignature(secret, body, sign(now), now)).toBe(true);
    expect(await verifyArrivePingSignature(secret, body, sign(now - 200), now)).toBe(true);
  });
  test("a changed body, another secret, an old or future time, or a mangled header fails", async () => {
    expect(await verifyArrivePingSignature(secret, body + " ", sign(now), now)).toBe(false);
    expect(await verifyArrivePingSignature(secret, body, sign(now, body, "whsec_other"), now)).toBe(false);
    expect(await verifyArrivePingSignature(secret, body, sign(now - 301), now)).toBe(false);
    expect(await verifyArrivePingSignature(secret, body, sign(now + 301), now)).toBe(false);
    expect(await verifyArrivePingSignature(secret, body, "v1=abc", now)).toBe(false);
    expect(await verifyArrivePingSignature(secret, body, null, now)).toBe(false);
    expect(await verifyArrivePingSignature("", body, sign(now), now)).toBe(false);
  });
  test("a refusal while setting up the webhook reads as what to do", () => {
    expect(webhookSetupError(403, "x")).toContain("Manage webhook subscriptions");
    expect(webhookSetupError(500, "Server error")).toBe("Server error");
  });
});
