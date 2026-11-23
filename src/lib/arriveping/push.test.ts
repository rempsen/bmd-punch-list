import { describe, expect, mock, test } from "bun:test";
import type { ApResult } from "./client.server";
import { AP_PATHS } from "./core";
import { planRetry, pushVisitCancel, pushVisitCreate } from "./push";

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

  test("a cancel already requested is skipped, not sent again", async () => {
    const fetchJson = replying({ ok: true, status: 200, json: null });
    const out = await pushVisitCancel({
      fetchJson,
      visit: { id: "v1", arriveping_job_id: "wo_9", arriveping_status: "cancel_requested" },
    });
    expect(out).toEqual({ outcome: "skipped", reason: "already requested" });
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

describe("planRetry", () => {
  const row = {
    direction: "out",
    entity_type: "visit",
    event_type: "create",
    entity_id: "v1",
    idempotency_key: "bmd-visit-v1",
    external_id: null,
    status: "failed",
  };

  test("a failed send with no work order id is sent again with its own key", () => {
    expect(planRetry(row)).toEqual({ action: "resend", visitId: "v1", key: "bmd-visit-v1" });
  });

  test("a work order ArrivePing already created is re-linked, never sent again", () => {
    expect(planRetry({ ...row, external_id: "wo_7" })).toEqual({
      action: "relink",
      visitId: "v1",
      jobId: "wo_7",
    });
  });

  test("a stuck pending row is retried like a failed one", () => {
    expect(planRetry({ ...row, status: "pending" })).toEqual({
      action: "resend",
      visitId: "v1",
      key: "bmd-visit-v1",
    });
  });

  test("a row that is already done is left alone", () => {
    expect(planRetry({ ...row, status: "sent" })).toEqual({
      action: "skip",
      reason: "already sent",
    });
    expect(planRetry({ ...row, status: "ignored" })).toEqual({
      action: "skip",
      reason: "already ignored",
    });
  });

  test("a row with no idempotency key is set aside rather than guessed", () => {
    expect(planRetry({ ...row, idempotency_key: null })).toEqual({
      action: "ignore",
      reason: "no idempotency key",
    });
  });

  test("a failed cancel is sent again, so the work order does not stay live in ArrivePing", () => {
    const cancel = {
      ...row,
      event_type: "cancel",
      idempotency_key: "bmd-visit-v1-cancel",
      external_id: "wo_7",
    };
    expect(planRetry(cancel)).toEqual({ action: "cancel", visitId: "v1" });
    expect(planRetry({ ...cancel, status: "pending" })).toEqual({
      action: "cancel",
      visitId: "v1",
    });
    expect(planRetry({ ...cancel, status: "sent" })).toEqual({
      action: "skip",
      reason: "already sent",
    });
  });

  test("a failed incoming event is left failed for ArrivePing to redeliver, never set aside", () => {
    const inbound = { ...row, direction: "in", event_type: "arrived", idempotency_key: "ap-evt-1" };
    const redeliver = { action: "skip", reason: "ArrivePing will redeliver" };
    expect(planRetry(inbound)).toEqual(redeliver);
    expect(planRetry({ ...inbound, status: "pending" })).toEqual(redeliver);
    expect(planRetry({ ...inbound, entity_id: null })).toEqual(redeliver);
  });

  test("anything else is not retried yet", () => {
    const notYet = { action: "ignore", reason: "retry not supported yet" };
    expect(planRetry({ ...row, event_type: "update" })).toEqual(notYet);
    expect(planRetry({ ...row, entity_type: "project" })).toEqual(notYet);
    expect(planRetry({ ...row, entity_id: null })).toEqual(notYet);
    expect(planRetry({ ...row, event_type: "cancel", entity_id: null })).toEqual(notYet);
  });
});
