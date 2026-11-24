import { describe, expect, test } from "bun:test";
import { jobDraftFor, matchWorkOrder, readWorkOrder, readWorkOrderPage, visitStatusFor, type ApWorkOrder, type MatchContext } from "./match";

const wo = (over: Partial<ApWorkOrder> = {}): ApWorkOrder => ({
  id: "wo_1",
  title: null,
  reference: null,
  externalSource: null,
  externalRef: null,
  customerId: null,
  customerName: null,
  startAt: "2026-12-01T14:00:00Z",
  endAt: "2026-12-01T22:00:00Z",
  status: "scheduled",
  assignedTo: null,
  siteContact: null,
  notes: null,
  ...over,
});
const ctx: MatchContext = {
  projects: [
    { id: "p1", number: "26-002", name: "Test Take Off", client_id: "c1" },
    { id: "p2", number: "26-003", name: "Hyatt Centric", client_id: "c2" },
    { id: "p3", number: "26-004", name: "Hyatt Centric phase 2", client_id: "c2" },
  ],
  clientLinks: { ap_c1: "c1", ap_c2: "c2" },
};

describe("matching an ArrivePing work order to a BMD job", () => {
  test("BMD's own work orders are left to their visit", () => {
    expect(matchWorkOrder(wo({ externalSource: "bmd_projects", externalRef: "v1" }), ctx)).toEqual({ kind: "bmd" });
  });
  test("a job number in the reference or title wins", () => {
    expect(matchWorkOrder(wo({ reference: "26-002" }), ctx)).toEqual({ kind: "match", projectId: "p1", how: "number" });
    expect(matchWorkOrder(wo({ title: "Service call 26002 kitchen" }), ctx)).toEqual({ kind: "match", projectId: "p1", how: "number" });
  });
  test("the linked client decides when it has exactly one open job", () => {
    expect(matchWorkOrder(wo({ title: "Repair", customerId: "ap_c1" }), ctx)).toEqual({ kind: "match", projectId: "p1", how: "client" });
    expect(matchWorkOrder(wo({ title: "Repair", customerId: "ap_c2" }), ctx)).toEqual({ kind: "unmatched", reason: "Client has 2 open jobs" });
  });
  test("unknown customers and bare work orders are set aside with a reason", () => {
    expect(matchWorkOrder(wo({ customerId: "ap_x" }), ctx)).toEqual({ kind: "unmatched", reason: "Customer is not linked to a BMD client" });
    expect(matchWorkOrder(wo(), ctx).kind).toBe("unmatched");
  });
});

describe("reading work orders as ArrivePing sends them", () => {
  test("reads the fields from a bare or wrapped record", () => {
    const r = readWorkOrder({ data: { id: 7, title: "Hall", reference: "26-002", customer: { id: "ap_c1", name: "Gail" }, schedule: { start_at: "2026-12-01T14:00:00Z", end_at: "2026-12-01T22:00:00Z" }, status: "Scheduled", assigned_techs: [{ name: "Brodie" }, { name: "Dale" }], site_contact: { name: "Pat", phone: "204" }, notes_for_crew: "Side door" } });
    expect(r).toEqual({ id: "7", title: "Hall", reference: "26-002", externalSource: null, externalRef: null, customerId: "ap_c1", customerName: "Gail", startAt: "2026-12-01T14:00:00Z", endAt: "2026-12-01T22:00:00Z", status: "scheduled", assignedTo: "Brodie, Dale", siteContact: "Pat 204", notes: "Side door" });
    expect(readWorkOrder({ ok: true })).toBeNull();
  });
  test("reads a list page in its common shapes", () => {
    expect(readWorkOrderPage({ data: [{ id: "a" }, { id: "b" }], meta: { next_cursor: "c2" } })).toMatchObject({ next: "c2" });
    expect(readWorkOrderPage([{ id: "a" }]).items.map((w) => w.id)).toEqual(["a"]);
    expect(readWorkOrderPage({ items: [], next_cursor: null })).toEqual({ items: [], next: null });
  });
  test("maps ArrivePing statuses onto visit statuses", () => {
    expect(visitStatusFor("on_site")).toBe("arrived");
    expect(visitStatusFor("completed")).toBe("completed");
    expect(visitStatusFor("paused")).toBe("scheduled");
  });
});

describe("a job made from a work order", () => {
  test("takes the title, the site address and the crew notes", () => {
    const d = jobDraftFor(wo({ title: "Bay 4 LVT", reference: "SO-88", notes: "Side door" }), { line1: "100 Main St", city: "Winnipeg", region: "MB", postal_code: "R3C 1A1" });
    expect(d).toEqual({ name: "Bay 4 LVT", street: "100 Main St", city: "Winnipeg", province: "MB", postal_code: "R3C 1A1", notes: "ArrivePing reference SO-88\nSide door" });
  });
  test("falls back to the customer and reference, then the work order id", () => {
    expect(jobDraftFor(wo({ customerName: "Gail", reference: "SO-88" }), null).name).toBe("Gail — SO-88");
    expect(jobDraftFor(wo(), "12 Elm").street).toBe("12 Elm");
    expect(jobDraftFor(wo(), null).name).toBe("ArrivePing work order wo_1");
  });
});
