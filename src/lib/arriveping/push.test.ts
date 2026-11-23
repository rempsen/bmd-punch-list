import { describe, expect, mock, test } from "bun:test";
import type { ApResult } from "./client.server";
import { AP_PATHS } from "./core";
import { pushVisitCancel, pushVisitCreate } from "./push";

const visit = {
  id: "v1",
  starts_at: "2026-12-01T14:00:00Z",
  ends_at: null,
  crew: null,
  notes: null,
  site_contact: null,
  arriveping_job_id: null,
};
const project = { id: "p1", name: "Test Take Off", number: "26-002", address: null, client: null };

const replying = (result: ApResult) =>
  mock(
    async (_path: string, _init: { method: "POST"; body: unknown; idempotencyKey: string }) =>
      result,
  );

describe("pushVisitCreate", () => {
  test("a created work order is sent, with the visit's create key", async () => {
    const fetchJson = replying({ ok: true, status: 201, json: { id: "wo_1" } });
    const out = await pushVisitCreate({ fetchJson, visit, project });
    expect(out).toEqual({ outcome: "sent", jobId: "wo_1", key: "bmd-visit-v1" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [path, init] = fetchJson.mock.calls[0]!;
    expect(path).toBe(AP_PATHS.workorders);
    expect(init.method).toBe("POST");
    expect(init.idempotencyKey).toBe("bmd-visit-v1");
    expect(init.body).toMatchObject({ external_ref: "v1", start_at: visit.starts_at });
  });

  test("a refusal is failed with a sentence a person can act on, and keeps the key", async () => {
    const fetchJson = replying({
      ok: false,
      status: 403,
      code: "http",
      error: "ArrivePing refused: the API key lacks the scope for this call (403)",
    });
    const out = await pushVisitCreate({ fetchJson, visit, project });
    expect(out.outcome).toBe("failed");
    if (out.outcome !== "failed") throw new Error("expected failed");
    expect(out.error).toContain("lacks the scope");
    expect(out.key).toBe("bmd-visit-v1");
  });

  test("a missing key is failed, not thrown", async () => {
    const fetchJson = replying({
      ok: false,
      status: 0,
      code: "not_configured",
      error: "ArrivePing is not configured — add secret ArrivePing_Api",
    });
    const out = await pushVisitCreate({ fetchJson, visit, project });
    expect(out).toEqual({
      outcome: "failed",
      error: "ArrivePing is not configured — add secret ArrivePing_Api",
      key: "bmd-visit-v1",
    });
  });

  test("a retry reuses the key it was given", async () => {
    const fetchJson = replying({ ok: true, status: 201, json: { id: "wo_1" } });
    const out = await pushVisitCreate({ fetchJson, visit, project, existingKey: "bmd-visit-x" });
    expect(fetchJson.mock.calls[0]![1].idempotencyKey).toBe("bmd-visit-x");
    expect(out).toEqual({ outcome: "sent", jobId: "wo_1", key: "bmd-visit-x" });
  });

  test("a visit already linked to a work order is skipped without calling ArrivePing", async () => {
    const fetchJson = replying({ ok: true, status: 201, json: { id: "wo_1" } });
    const out = await pushVisitCreate({
      fetchJson,
      visit: { ...visit, arriveping_job_id: "wo_9" },
      project,
    });
    expect(out).toEqual({ outcome: "skipped", reason: "already linked" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  test("the work order id is found under work_order or data", async () => {
    expect(
      await pushVisitCreate({
        fetchJson: replying({ ok: true, status: 201, json: { data: { id: "wo_2" } } }),
        visit,
        project,
      }),
    ).toMatchObject({ outcome: "sent", jobId: "wo_2" });
    expect(
      await pushVisitCreate({
        fetchJson: replying({ ok: true, status: 201, json: { work_order: { id: "wo_3" } } }),
        visit,
        project,
      }),
    ).toMatchObject({ outcome: "sent", jobId: "wo_3" });
  });

  test("a success with no work order id is failed, never sent", async () => {
    const error = "ArrivePing did not return a work order id";
    expect(
      await pushVisitCreate({
        fetchJson: replying({ ok: true, status: 201, json: {} }),
        visit,
        project,
      }),
    ).toEqual({ outcome: "failed", error, key: "bmd-visit-v1" });
    expect(
      await pushVisitCreate({
        fetchJson: replying({ ok: true, status: 204, json: null }),
        visit,
        project,
      }),
    ).toEqual({ outcome: "failed", error, key: "bmd-visit-v1" });
    expect(
      await pushVisitCreate({
        fetchJson: replying({ ok: true, status: 201, json: { id: "" } }),
        visit,
        project,
      }),
    ).toEqual({ outcome: "failed", error, key: "bmd-visit-v1" });
  });

  test("a fetch that throws anyway is failed, not thrown", async () => {
    const fetchJson = mock(async () => {
      throw new Error("boom");
    });
    const out = await pushVisitCreate({ fetchJson, visit, project });
    expect(out).toEqual({
      outcome: "failed",
      error: "Could not reach ArrivePing: boom",
      key: "bmd-visit-v1",
    });
  });
});

describe("pushVisitCancel", () => {
  test("cancels the linked work order with the visit's cancel key", async () => {
    const fetchJson = replying({ ok: true, status: 200, json: null });
    const out = await pushVisitCancel({
      fetchJson,
      visit: { id: "v1", arriveping_job_id: "wo/9" },
    });
    expect(out).toEqual({ outcome: "sent", jobId: "wo/9", key: "bmd-visit-v1-cancel" });
    const [path, init] = fetchJson.mock.calls[0]!;
    expect(path).toBe(`${AP_PATHS.workorders}/wo%2F9/cancel`);
    expect(init.idempotencyKey).toBe("bmd-visit-v1-cancel");
  });

  test("a visit with no work order is skipped without calling ArrivePing", async () => {
    const fetchJson = replying({ ok: true, status: 200, json: null });
    expect(
      await pushVisitCancel({ fetchJson, visit: { id: "v1", arriveping_job_id: null } }),
    ).toEqual({ outcome: "skipped", reason: "not linked" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  test("a refusal is failed and keeps the key", async () => {
    const fetchJson = replying({
      ok: false,
      status: 404,
      code: "http",
      error: "ArrivePing endpoint not found (404) — check AP_PATHS",
    });
    expect(
      await pushVisitCancel({ fetchJson, visit: { id: "v1", arriveping_job_id: "wo_9" } }),
    ).toEqual({
      outcome: "failed",
      error: "ArrivePing endpoint not found (404) — check AP_PATHS",
      key: "bmd-visit-v1-cancel",
    });
  });
});
