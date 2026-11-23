import { describe, expect, test } from "bun:test";
import { AP_BASE, apWorkOrderUrl, describeApiError, idempotencyKey, parseJsonReply, parseMcpToolsList, pickKey, rescheduleKey, workOrderPayload } from "./core";

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
  test("describes the visit and the project for the crew", () => {
    const body = workOrderPayload(visit, project);
    expect(body).toEqual({
      external_source: "bmd_projects",
      external_ref: visit.id,
      title: "26-002 Test Take Off — Install",
      reference: "26-002",
      site_address: { line1: "Winnipeg, MB" },
      site_contact: { name: "Pat Client 204-555-0100" },
      start_at: "2026-12-01T14:00:00Z",
      end_at: "2026-12-01T22:00:00Z",
      crew_hint: "Brodie + 2",
      notes_for_crew: "Level 2, rooms 201-212",
      tags: ["bmd", "install"],
    });
    expect(body).not.toHaveProperty("customer_id");
    expect(noNulls(body)).toBe(true);
  });
  test("a visit with no end runs eight hours from its start", () => {
    expect(workOrderPayload({ ...visit, ends_at: null }, project)["end_at"]).toBe("2026-12-01T22:00:00.000Z");
  });
  test("links the ArrivePing customer when the project has one", () => {
    expect(workOrderPayload(visit, { ...project, arriveping_customer_id: "cust_9" })["customer_id"]).toBe("cust_9");
  });
  test("leaves out everything the visit and project do not have", () => {
    const body = workOrderPayload({ ...visit, crew: null, notes: null, site_contact: null }, { ...project, number: null, address: null });
    expect(body["title"]).toBe("Test Take Off — Install");
    for (const key of ["reference", "site_address", "site_contact", "crew_hint", "notes_for_crew", "customer_id"]) expect(body).not.toHaveProperty(key);
    expect(noNulls(body)).toBe(true);
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
  test("other statuses carry the first 200 characters of the body", () => {
    const text = describeApiError(500, "x".repeat(500));
    expect(text).toBe(`ArrivePing error 500: ${"x".repeat(200)}`);
  });
});

describe("work order link", () => {
  test("points at the admin page and escapes the id", () => {
    expect(apWorkOrderUrl("wo 1/2")).toBe(`${AP_BASE}/admin/workorders/wo%201%2F2`);
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
