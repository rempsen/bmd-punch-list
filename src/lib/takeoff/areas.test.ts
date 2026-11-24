import { describe, expect, test } from "bun:test";
import { areasByFinish, areasText, docAreaRows, lineAreas, type AreaRow } from "./areas";

const base = (id: string, cond: string, lf: number, group: string | null, extra: Record<string, unknown> = {}) => ({
  id, condition_id: cond, measure_role: "linear", label: "", computed: { perimeter_lf: lf },
  origin: { method: "auto_v1", reviewed: true, auto: { kind: "base", name: "", ...(group ? { group } : {}) } }, ...extra,
});
const doc = {
  conditions: [{ id: "c-rb", finish_tag: "RB-1", multiplier: 1 }, { id: "c-cpt", finish_tag: "CPT-1" }, { id: "c-rb3", finish_tag: "RB-1 – Level 3", multiplier: 2 }],
  shapes: [
    base("a", "c-rb", 100, "suite"), base("b", "c-rb", 40.5, "suite"), base("c", "c-rb", 60, "common"), base("d", "c-rb", 12, "washroom"),
    base("p", "c-rb", 999, "suite", { origin: { method: "auto_v1", reviewed: false, auto: { kind: "base", group: "suite" } } }),   // not accepted: not counted
    { id: "h", condition_id: "c-rb", measure_role: "linear", computed: { perimeter_lf: 8 }, origin: { method: "manual", reviewed: true } },   // drawn by hand
    { id: "f", condition_id: "c-cpt", measure_role: "floor_area", computed: { area_sf: 500, perimeter_lf: 90 }, origin: { method: "manual", reviewed: true } },   // a floor: not base
    base("o", "c-rb", 20, null, { origin: { method: "auto_v1", reviewed: true, auto: { kind: "base", name: "STAFF W/C" } } }),   // accepted before areas were recorded
    base("l3", "c-rb3", 10, "common", { label: "East wing" }),
  ],
};
const LINKS = [{ condition_key: "c-rb", finish_id: "fin-rb" }, { condition_key: "c-rb3", finish_id: "fin-rb" }, { condition_key: "c-cpt", finish_id: "fin-cpt" }];

describe("docAreaRows", () => {
  test("accepted lines by finish, section and area; the finish's multiplier applies; floors and proposals are left out", () => {
    const rows = docAreaRows(doc);
    const sum = (area: string, cond = "c-rb") => rows.filter((r) => r.condition_key === cond && r.area === area).reduce((n, r) => n + r.lf, 0);
    expect(sum("suite")).toBe(140.5);
    expect(sum("common")).toBe(60);
    expect(sum("washroom")).toBe(32);          // 12 recorded, 20 sorted by the room's name
    expect(sum("other")).toBe(8);              // drawn by hand: no area recorded
    expect(rows.some((r) => r.condition_key === "c-cpt")).toBe(false);
    expect(rows.find((r) => r.condition_key === "c-rb3")).toEqual({ condition_key: "c-rb3", section: "East wing", area: "common", lf: 20 });
  });
  test("a section with no name of its own takes the finish's variant name, as the quantities do", () => {
    const d = { conditions: [{ id: "v", finish_tag: "RB-1 – Level 3" }], shapes: [base("x", "v", 5, "suite")] };
    expect(docAreaRows(d)[0]).toMatchObject({ section: "Level 3" });
  });
  test("no takeoff: nothing", () => {
    expect(docAreaRows(null)).toEqual([]);
    expect(docAreaRows({})).toEqual([]);
  });
});

describe("areasByFinish and lineAreas", () => {
  const areas = areasByFinish(docAreaRows(doc), LINKS);
  const line = (over: Record<string, unknown> = {}) => ({ id: "L1", finish_id: "fin-rb", source: "takeoff", detached: false, driver_qty: 260.5, driver_uom: "LF", section: "General", ...over });
  test("a finish measured under several takeoff conditions is added up", () => {
    expect(areas["fin-rb"]!.total).toEqual({ suite: 140.5, common: 80, washroom: 32, other: 8 });
    expect(areas["fin-rb"]!.bySection["East wing"]).toEqual({ suite: 0, common: 20, washroom: 0, other: 0 });
    expect(areas["fin-cpt"]).toBeUndefined();
  });
  test("a line that follows the takeoff in LF gets its finish's breakdown, and says whether it adds up to the line", () => {
    const l = line({ section: "Whole job" });   // not one of the takeoff's sections: the line follows the whole finish
    expect(lineAreas(l, [l], areas)).toEqual({ areas: { suite: 140.5, common: 80, washroom: 32, other: 8 }, matches: true });
    const edited = line({ section: "Whole job", driver_qty: 300 });
    expect(lineAreas(edited, [edited], areas)!.matches).toBe(false);
  });
  test("lines split by section each take their own section", () => {
    const east = line({ id: "L2", section: "East wing", driver_qty: 20 }), rest = line({ driver_qty: 240.5 });
    expect(lineAreas(east, [east, rest], areas)).toEqual({ areas: { suite: 0, common: 20, washroom: 0, other: 0 }, matches: true });
    expect(lineAreas(rest, [east, rest], areas)!.areas).toEqual({ suite: 140.5, common: 60, washroom: 32, other: 8 });
  });
  test("no breakdown for a line typed by hand, detached, not in LF, or with nothing sorted into an area", () => {
    for (const l of [line({ source: "manual" }), line({ detached: true }), line({ driver_uom: "SF" }), line({ finish_id: "fin-cpt" }), line({ finish_id: null })]) expect(lineAreas(l, [l], areas)).toBeNull();
    const byHand = areasByFinish([{ condition_key: "c-rb", section: "", area: "other", lf: 50 } as AreaRow], LINKS);
    expect(lineAreas(line({ driver_qty: 50 }), [line({ driver_qty: 50 })], byHand)).toBeNull();
  });
});

describe("areasText", () => {
  test("the areas in a fixed order, empty ones left out, anything unsorted named plainly", () => {
    expect(areasText({ suite: 1248.5, common: 1622.3, washroom: 145.1, other: 0 })).toBe("Suites 1,248.5 LF · Common areas 1,622.3 LF · Washrooms 145.1 LF");
    expect(areasText({ suite: 100, common: 0, washroom: 0, other: 8 })).toBe("Suites 100 LF · Other 8 LF");
    expect(areasText({ suite: 0, common: 0, washroom: 0, other: 50 })).toBeNull();
  });
});
