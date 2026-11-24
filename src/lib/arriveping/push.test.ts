import { describe, expect, mock, test } from "bun:test";
import type { ApResult } from "./client.server";
import { AP_PATHS } from "./core";
import { ensureArrivePingClient, planRetry, pushVisitCancel, pushVisitCreate, pushVisitReschedule } from "./push";

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
    async (_path: string, _init: { method: "POST" | "PATCH"; body: unknown; idempotencyKey?: string }) =>
      result,
  );

describe("pushVisitCreate", () => {
  test("a created work order is sent, with the visit's create key", async () => {
    const fetchJson = replying({ ok: true, status: 201, json: { id: "wo_1" } });
    const out = await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_1" });
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
    const out = await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_1" });
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
    const out = await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_1" });
    expect(out).toEqual({
      outcome: "failed",
      error: "ArrivePing is not configured — add secret ArrivePing_Api",
      key: "bmd-visit-v1",
    });
  });

  test("a retry reuses the key it was given", async () => {
    const fetchJson = replying({ ok: true, status: 201, json: { id: "wo_1" } });
    const out = await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_1", existingKey: "bmd-visit-x" });
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
    const out = await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_1" });
    expect(out).toEqual({
      outcome: "failed",
      error: "Could not reach ArrivePing: boom",
      key: "bmd-visit-v1",
    });
  });
});

describe("pushVisitCreate and the ArrivePing client", () => {
  test("the work order is sent for the ArrivePing client", async () => {
    const fetchJson = replying({ ok: true, status: 201, json: { id: "wo_1" } });
    await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_9" });
    expect(fetchJson.mock.calls[0]![1].body).toMatchObject({ client_id: "cl_9" });
  });
  test("a 409 handing back our own earlier work order is sent, not failed", async () => {
    const fetchJson = replying({ ok: false, status: 409, code: "http", error: "duplicate", json: { error: { code: "duplicate_external_ref" }, work_order: { id: "wo_7" } } });
    expect(await pushVisitCreate({ fetchJson, visit, project, clientId: "cl_9" })).toEqual({ outcome: "sent", jobId: "wo_7", key: "bmd-visit-v1" });
  });
});

describe("ensureArrivePingClient", () => {
  const client = { id: "c0ffee00-0000-4000-8000-000000000001", name: "Brian & Gail Chornoboy", email: "brian@example.com", phone: null, billing_address: null };
  const key = `bmd-client-${client.id}`;
  const sequence = (...results: ApResult[]) => {
    let i = 0;
    return mock(async (_path: string, _init: { method: "POST" | "PATCH"; body: unknown; idempotencyKey?: string }) => results[Math.min(i++, results.length - 1)]!);
  };

  test("an already linked client is used without calling ArrivePing", async () => {
    const fetchJson = sequence({ ok: true, status: 200, json: {} });
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: "cl_1" })).toEqual({ outcome: "linked", clientId: "cl_1", via: "linked" });
    expect(fetchJson).not.toHaveBeenCalled();
  });
  test("a new client is created with BMD's id as its reference", async () => {
    const fetchJson = sequence({ ok: true, status: 201, json: { id: "cl_2" } });
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: null })).toEqual({ outcome: "linked", clientId: "cl_2", via: "created" });
    const [path, init] = fetchJson.mock.calls[0]!;
    expect(path).toBe(AP_PATHS.clients);
    expect(init).toMatchObject({ method: "POST", idempotencyKey: key });
    expect(init.body).toMatchObject({ external_source: "bmd_projects", external_ref: client.id, name: client.name, email: client.email });
  });
  test("a client ArrivePing already has under our reference is used as is", async () => {
    const fetchJson = sequence({ ok: false, status: 409, code: "http", error: "dup", json: { error: { code: "duplicate_external_ref" }, client: { id: "cl_3" } } });
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: null })).toEqual({ outcome: "linked", clientId: "cl_3", via: "external_ref" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  test("a client matched by email is used, and our reference added to it", async () => {
    const fetchJson = sequence(
      { ok: false, status: 409, code: "http", error: "exists", json: { error: { code: "client_exists" }, client: { id: "cl_4" } } },
      { ok: true, status: 200, json: { id: "cl_4" } },
    );
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: null })).toEqual({ outcome: "linked", clientId: "cl_4", via: "email" });
    const [path, init] = fetchJson.mock.calls[1]!;
    expect(path).toBe(`${AP_PATHS.clients}/cl_4`);
    expect(init).toMatchObject({ method: "PATCH", body: { external_source: "bmd_projects", external_ref: client.id } });
  });
  test("a match by email that already belongs to another record is refused, never overwritten", async () => {
    const fetchJson = sequence({ ok: false, status: 409, code: "http", error: "exists", json: { error: { code: "client_exists" }, client: { id: "cl_4", external_source: "bmd_projects", external_ref: "someone-else" } } });
    const out = await ensureArrivePingClient({ fetchJson, client, linkedId: null });
    expect(out.outcome).toBe("failed");
    if (out.outcome === "failed") expect(out.error).toContain("another BMD client");
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  test("a match by email already tagged as this BMD client is used without a PATCH", async () => {
    const fetchJson = sequence({ ok: false, status: 409, code: "http", error: "exists", json: { error: { code: "client_exists" }, client: { id: "cl_4", external_source: "bmd_projects", external_ref: client.id } } });
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: null })).toEqual({ outcome: "linked", clientId: "cl_4", via: "email" });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  test("a 409 for our reference with no record handed back is failed", async () => {
    const fetchJson = sequence({ ok: false, status: 409, code: "http", error: "dup", json: { error: { code: "duplicate_external_ref" }, client: null } });
    expect((await ensureArrivePingClient({ fetchJson, client, linkedId: null })).outcome).toBe("failed");
  });
  test("a matched client is still used when adding our reference fails", async () => {
    const fetchJson = sequence(
      { ok: false, status: 409, code: "http", error: "exists", json: { error: { code: "client_exists" }, client: { id: "cl_4" } } },
      { ok: false, status: 500, code: "http", error: "boom" },
    );
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: null })).toMatchObject({ outcome: "linked", clientId: "cl_4" });
  });
  test("an email that belongs to ArrivePing staff is created again without the email", async () => {
    const fetchJson = sequence(
      { ok: false, status: 409, code: "http", error: "taken", json: { error: { code: "email_taken" } } },
      { ok: true, status: 201, json: { id: "cl_5" } },
    );
    expect(await ensureArrivePingClient({ fetchJson, client, linkedId: null })).toEqual({ outcome: "linked", clientId: "cl_5", via: "created" });
    const [, init] = fetchJson.mock.calls[1]!;
    expect(init.idempotencyKey).toBe(`${key}-no-email`);
    expect(init.body).not.toHaveProperty("email");
  });
  test("a refusal is failed with ArrivePing's reason", async () => {
    const fetchJson = sequence({ ok: false, status: 403, code: "http", error: "ArrivePing refused: the API key lacks the scope for this call (403)" });
    const out = await ensureArrivePingClient({ fetchJson, client, linkedId: null });
    expect(out.outcome).toBe("failed");
    if (out.outcome === "failed") expect(out.error).toContain("Couldn't create the client in ArrivePing");
  });
  test("a success with no id is failed", async () => {
    const fetchJson = sequence({ ok: true, status: 201, json: {} });
    expect((await ensureArrivePingClient({ fetchJson, client, linkedId: null })).outcome).toBe("failed");
  });
  test("a fetch that throws is failed, not thrown", async () => {
    const fetchJson = mock(async () => {
      throw new Error("socket hang up");
    });
    expect((await ensureArrivePingClient({ fetchJson, client, linkedId: null })).outcome).toBe("failed");
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

describe("pushVisitReschedule", () => {
  const linked = { ...visit, arriveping_job_id: "wo_7", ends_at: "2026-12-01T22:00:00Z", site_contact: "Gail" };
  test("the new schedule is PATCHed onto the work order under the key it was given", async () => {
    const fetchJson = replying({ ok: true, status: 200, json: { id: "wo_7" } });
    const out = await pushVisitReschedule({ fetchJson, visit: linked, key: "bmd-visit-v1-reschedule-5" });
    expect(out).toEqual({ outcome: "sent", jobId: "wo_7", key: "bmd-visit-v1-reschedule-5" });
    const [path, init] = fetchJson.mock.calls[0]!;
    expect(path).toBe(`${AP_PATHS.workorders}/wo_7`);
    expect(init.method).toBe("PATCH");
    expect(init.idempotencyKey).toBe("bmd-visit-v1-reschedule-5");
    expect(init.body).toEqual({ start_at: linked.starts_at, end_at: linked.ends_at, site_contact: { name: "Gail" }, notes_for_crew: expect.any(String) });
  });
  test("a visit that was never sent has nothing to reschedule", async () => {
    const fetchJson = replying({ ok: true, status: 200, json: {} });
    expect(await pushVisitReschedule({ fetchJson, visit, key: "k" })).toEqual({ outcome: "skipped", reason: "not linked" });
    expect(fetchJson).not.toHaveBeenCalled();
  });
  test("a refusal is failed, with ArrivePing's reason", async () => {
    const fetchJson = replying({ ok: false, status: 422, code: "http", error: "ArrivePing refused (422): end_at: must be after start_at" });
    expect(await pushVisitReschedule({ fetchJson, visit: linked, key: "k" })).toEqual({ outcome: "failed", error: "ArrivePing refused (422): end_at: must be after start_at", key: "k" });
  });
});

describe("planRetry: reschedule", () => {
  test("a failed reschedule is sent again with the visit's current times under its own key", () => {
    expect(planRetry({ direction: "out", entity_type: "visit", event_type: "reschedule", entity_id: "v1", idempotency_key: "bmd-visit-v1-reschedule-5", external_id: "wo_7", status: "failed" })).toEqual({ action: "reschedule", visitId: "v1", key: "bmd-visit-v1-reschedule-5" });
  });
});
