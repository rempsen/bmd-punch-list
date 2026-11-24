import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { priceEstimateLine, type SnapComponent } from "@/lib/estimating/assemble";
import {
  MATERIAL_ITEM_KEYS,
  REQUEST_STATUS_LABEL,
  canChangeLog,
  canMoveRequest,
  filterLogs,
  isOpenRequest,
  looksLikeNeed,
  nextRequestMoves,
  orderQuantity,
  requestMovePatch,
  requestOffers,
  saveTarget,
  shapeMaterialList,
  sortRequests,
  toolsToCopy,
  weatherLine,
  winnipegDate,
  type MaterialRaw,
} from "./logic";

const log = (o: Partial<{ id: string; author_id: string; log_date: string }>) => ({ id: "l1", author_id: "me", log_date: "2026-11-24", ...o });

describe("one log per job, per day, per person", () => {
  test("the day is the Winnipeg day, not the UTC day", () => {
    expect(winnipegDate(new Date("2026-11-25T03:30:00Z"))).toBe("2026-11-24");
    expect(winnipegDate(new Date("2026-11-25T06:30:00Z"))).toBe("2026-11-25");
  });
  test("saving again today changes today's log instead of adding a second one", () => {
    expect(saveTarget([log({})], "me", "2026-11-24")).toEqual({ mode: "update", id: "l1" });
  });
  test("a new day, or another person's log today, means a new log", () => {
    expect(saveTarget([log({ log_date: "2026-11-23" })], "me", "2026-11-24")).toEqual({ mode: "create" });
    expect(saveTarget([log({ author_id: "sam" })], "me", "2026-11-24")).toEqual({ mode: "create" });
  });
  test("you can change or delete your own log the same day; office staff any log; nobody else", () => {
    expect(canChangeLog(log({}), { userId: "me", today: "2026-11-24", office: false })).toBe(true);
    expect(canChangeLog(log({ log_date: "2026-11-23" }), { userId: "me", today: "2026-11-24", office: false })).toBe(false);
    expect(canChangeLog(log({ author_id: "sam" }), { userId: "me", today: "2026-11-24", office: false })).toBe(false);
    expect(canChangeLog(log({ author_id: "sam", log_date: "2026-01-02" }), { userId: "me", today: "2026-11-24", office: true })).toBe(true);
  });
  test("the list filters by person and by date range", () => {
    const logs = [log({ id: "a" }), log({ id: "b", author_id: "sam", log_date: "2026-11-20" }), log({ id: "c", log_date: "2026-11-10" })];
    expect(filterLogs(logs, { authorId: "sam" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLogs(logs, { from: "2026-11-15" }).map((l) => l.id)).toEqual(["a", "b"]);
    expect(filterLogs(logs, { from: "2026-11-15", to: "2026-11-21" }).map((l) => l.id)).toEqual(["b"]);
    expect(filterLogs(logs, {}).length).toBe(3);
  });
});

describe("which next-step lines are offered as requests", () => {
  test("lines that read like a need are suggested", () => {
    for (const s of ["Need 2 more pails of adhesive", "need transition strips", "Pick up reducer from the shop", "Order 3 boxes LVT", "Please bring the floor roller", "We needed more primer", "Needs a second pail", "pickup stair nosing"])
      expect(looksLikeNeed(s)).toBe(true);
  });
  test("ordinary notes are not suggested", () => {
    for (const s of ["Finish corridor tomorrow", "Border tile is done", "Start level 3 on Thursday", "Reordering of rooms agreed with the super", ""]) expect(looksLikeNeed(s)).toBe(false);
  });
  test("every line can become a request, bullets are dropped, and need-like lines are flagged", () => {
    const offers = requestOffers("- Finish corridor\n• Need 2 pails of adhesive\n\n3. bring the roller  ", []);
    expect(offers).toEqual([
      { line: "Finish corridor", suggested: false, requested: false },
      { line: "Need 2 pails of adhesive", suggested: true, requested: false },
      { line: "bring the roller", suggested: true, requested: false },
    ]);
  });
  test("a line already made into a request is marked, so it is not offered twice", () => {
    const offers = requestOffers("Need 2 pails of adhesive", [{ what: "need 2 pails of  adhesive" }]);
    expect(offers[0]).toEqual({ line: "Need 2 pails of adhesive", suggested: true, requested: true });
  });
});

describe("request status moves", () => {
  test("open goes to ordered, on its way, done or can't do", () => {
    expect(nextRequestMoves("open")).toEqual(["ordered", "on_its_way", "done", "cant_do"]);
    expect(canMoveRequest("open", "ordered")).toBe(true);
    expect(canMoveRequest("ordered", "on_its_way")).toBe(true);
    expect(canMoveRequest("on_its_way", "done")).toBe(true);
    expect(canMoveRequest("ordered", "done")).toBe(true);
  });
  test("a finished request can only be reopened; nothing moves to itself", () => {
    expect(nextRequestMoves("done")).toEqual(["open"]);
    expect(nextRequestMoves("cant_do")).toEqual(["open"]);
    expect(canMoveRequest("done", "ordered")).toBe(false);
    expect(canMoveRequest("open", "open")).toBe(false);
    expect(canMoveRequest("on_its_way", "ordered")).toBe(false);
  });
  test("can't do needs a reason; other moves clear any old reason", () => {
    expect(() => requestMovePatch("open", "cant_do", {})).toThrow("Say why");
    expect(() => requestMovePatch("open", "cant_do", { reason: "   " })).toThrow("Say why");
    expect(requestMovePatch("open", "cant_do", { reason: " Discontinued " })).toEqual({ status: "cant_do", status_reason: "Discontinued" });
    expect(requestMovePatch("cant_do", "open", {})).toEqual({ status: "open", status_reason: null });
    expect(() => requestMovePatch("done", "ordered", {})).toThrow();
  });
  test("open means still waiting on something; labels are plain words", () => {
    expect(["open", "ordered", "on_its_way", "done", "cant_do"].map((s) => isOpenRequest(s as never))).toEqual([true, true, true, false, false]);
    expect(REQUEST_STATUS_LABEL).toEqual({ open: "Open", ordered: "Ordered", on_its_way: "On its way", done: "Done", cant_do: "Can't do" });
  });
  test("open requests list first, soonest needed-by first, then finished ones", () => {
    const r = (id: string, status: string, needed_by: string | null, created_at: string) => ({ id, status, needed_by, created_at }) as never;
    const out = sortRequests([r("done", "done", null, "2026-11-24"), r("later", "open", "2026-12-05", "2026-11-20"), r("nodate", "ordered", null, "2026-11-23"), r("soon", "on_its_way", "2026-11-26", "2026-11-21")]);
    expect(out.map((x: { id: string }) => x.id)).toEqual(["soon", "later", "nodate", "done"]);
  });
});

describe("materials for the crew", () => {
  const comp = (o: Partial<SnapComponent>): SnapComponent => ({
    kind: "material", label: "LVT Oak", source: "catalogue", catalogue_material_id: "m1", labour_rate_id: null, unit_cost_cents: 5000, cost_uom: "carton", purchase_uom: "carton",
    coverage_per_purchase_unit: 23.6, qty_per_driver: 1, waste_pct: 10, round_up: true, pst_applies: true, on_gross: false, cost_overridden: false, not_applicable: false, sort_order: 1, ...o,
  });
  const line = { driver_qty: 1000, driver_uom: "SF" as const, markup_pct: 30, price_basis: "markup" as const, margin_pct: null, fixed_sell_cents: null, tax_code: "GST" as const };
  const raw = (c: SnapComponent, l = line, extra: Partial<MaterialRaw> = {}): MaterialRaw => ({
    item_key: `k${c.sort_order}`, section: "Level 1", description: c.label, line_description: "Corridor LVT", driver_qty: l.driver_qty, driver_uom: l.driver_uom,
    qty_per_driver: c.qty_per_driver, waste_pct: c.waste_pct, coverage_per_purchase_unit: c.coverage_per_purchase_unit, round_up: c.round_up, purchase_uom: c.purchase_uom, ...extra,
  });

  test("the quantity is the estimate's own Order quantity, for cartons, pails, rolls and area units", () => {
    const comps = [
      comp({}),
      comp({ label: "Adhesive", purchase_uom: "pail", cost_uom: "pail", coverage_per_purchase_unit: 250, waste_pct: 0, sort_order: 2 }),
      comp({ label: "Carpet", purchase_uom: "SY", cost_uom: "SY", coverage_per_purchase_unit: null, waste_pct: 8, round_up: false, sort_order: 3 }),
      comp({ label: "Underlay", purchase_uom: "roll", cost_uom: "SF", coverage_per_purchase_unit: 360, waste_pct: 5, qty_per_driver: 1, sort_order: 4 }),
      comp({ label: "Base", purchase_uom: "SF", cost_uom: "SF", coverage_per_purchase_unit: null, waste_pct: 0, qty_per_driver: 0.33, round_up: false, sort_order: 5 }),
    ];
    const priced = priceEstimateLine(line, comps, { pstPct: 7 });
    expect(priced.error).toBeNull();
    comps.forEach((c, i) => expect(orderQuantity(raw(c))).toBe(priced.components[i]!.purchaseQty));
    expect(orderQuantity(raw(comps[0]!))).toBe(47); // 1000 SF + 10% at 23.6 SF a carton, rounded up
    expect(orderQuantity(raw(comps[1]!))).toBe(4);
    expect(orderQuantity(raw(comps[2]!))).toBe(120);
  });
  test("numbers arriving as text from the database are read the same way", () => {
    const c = comp({});
    expect(orderQuantity({ ...raw(c), driver_qty: "1000" as never, waste_pct: "10" as never, coverage_per_purchase_unit: "23.6" as never, qty_per_driver: "1" as never })).toBe(47);
  });
  test("a material with no known cost still gets its quantity: the crew list never depends on price", () => {
    expect(orderQuantity(raw(comp({ unit_cost_cents: null })))).toBe(47);
  });
  test("units that cannot be worked out give no quantity rather than a guess", () => {
    expect(orderQuantity(raw(comp({ purchase_uom: "LF", coverage_per_purchase_unit: null })))).toBeNull();
  });
  test("rows are grouped by section and carry only description, quantity, unit and the tick: never a cost", () => {
    const leaked = { ...raw(comp({})), unit_cost_cents: 5000, markup_pct: 30, supplier_id: "s1", supplier_name: "Prosol" } as MaterialRaw;
    const groups = shapeMaterialList([leaked, raw(comp({ label: "Adhesive", sort_order: 2 }), line, { section: "Level 2" })], [{ item_key: "k1", loaded: true }]);
    expect(groups.map((g) => g.section)).toEqual(["Level 1", "Level 2"]);
    const item = groups[0]!.items[0]!;
    expect(Object.keys(item).sort()).toEqual([...MATERIAL_ITEM_KEYS].sort());
    expect(Object.keys(item).sort()).toEqual(["description", "key", "loaded", "quantity", "unit", "where"]);
    expect(item).toEqual({ key: "k1", description: "LVT Oak", where: "Corridor LVT", quantity: 47, unit: "carton", loaded: true });
    expect(groups[1]!.items[0]!.loaded).toBe(false);
    expect(JSON.stringify(groups)).not.toMatch(/cost|cents|markup|supplier|Prosol|price|margin/i);
  });
  test("the database function that feeds the list returns no cost, price, markup or supplier column", () => {
    const sql = readFileSync(new URL("../../../drizzle/migrations/0084_daily_logs_and_requests.sql", import.meta.url), "utf8");
    const m = /FUNCTION public\.job_material_list\(_project uuid\)\s+RETURNS TABLE\(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const cols = m![1]!.split(",").map((c) => c.trim().split(/\s+/)[0]!);
    expect(cols).toEqual(["item_key", "section", "description", "line_description", "driver_qty", "driver_uom", "qty_per_driver", "waste_pct", "coverage_per_purchase_unit", "round_up", "purchase_uom", "sort_a", "sort_b", "sort_c"]);
    for (const c of cols) expect(c).not.toMatch(/cost|cents|price|markup|margin|supplier|sell/i);
    const body = sql.slice(sql.indexOf("FUNCTION public.job_material_list"), sql.indexOf("FUNCTION public.job_material_list(uuid) FROM"));
    expect(body).not.toMatch(/unit_cost_cents|markup_pct|margin_pct|fixed_sell|suppliers|supplier_id/);
  });
});

describe("tool list", () => {
  test("copying the standard list adds only what the job does not have yet, in order, after the job's own items", () => {
    const out = toolsToCopy([{ name: "Floor roller", sort_order: 1 }, { name: "Knee kicker", sort_order: 2 }, { name: " trowels ", sort_order: 3 }], [{ name: "floor  ROLLER", sort_order: 7 }, { name: "Shop vac", sort_order: 8 }]);
    expect(out).toEqual([{ name: "Knee kicker", sort_order: 9 }, { name: "trowels", sort_order: 10 }]);
  });
  test("copying twice adds nothing the second time; an empty standard list adds nothing", () => {
    const std = [{ name: "Floor roller", sort_order: 1 }];
    const first = toolsToCopy(std, []);
    expect(first).toEqual([{ name: "Floor roller", sort_order: 1 }]);
    expect(toolsToCopy(std, first)).toEqual([]);
    expect(toolsToCopy([], [])).toEqual([]);
  });
});

describe("weather on a log", () => {
  test("shows conditions and temperature when known", () => {
    expect(weatherLine({ weather_status: "ok", weather_conditions: "Light snow", temp_now_c: -8.4, temp_high_c: -5, temp_low_c: -12.2 })).toBe("Light snow · -8°C now · high -5°, low -12°");
    expect(weatherLine({ weather_status: "ok", weather_conditions: "Clear", temp_now_c: null, temp_high_c: 21.6, temp_low_c: 9 })).toBe("Clear · high 22°C, low 9°C");
  });
  test("says so when it is not known, and never shows a made-up value", () => {
    expect(weatherLine({ weather_status: "unavailable", weather_conditions: null, temp_now_c: null, temp_high_c: null, temp_low_c: null })).toBe("Weather unavailable");
    expect(weatherLine({ weather_status: "pending", weather_conditions: null, temp_now_c: null, temp_high_c: null, temp_low_c: null })).toBe("Weather unavailable");
    expect(weatherLine({ weather_status: "ok", weather_conditions: null, temp_now_c: null, temp_high_c: null, temp_low_c: null })).toBe("Weather unavailable");
  });
});
