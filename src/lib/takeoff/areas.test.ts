import { describe, expect, test } from "bun:test";
import { areaSection, areasByFinish, areasText, docAreaRows, lineAreas, type AreaRow } from "./areas";

const base = (id: string, cond: string, lf: number, room: string, name: string, auto: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id, condition_id: cond, measure_role: "linear", label: `${room} ${name}`.trim(), computed: { perimeter_lf: lf },
  origin: { method: "auto_v1", reviewed: true, auto: { kind: "base", room, name, ...auto } }, ...extra,
});
const doc = {
  conditions: [{ id: "c-rb", finish_tag: "RB-1", multiplier: 1 }, { id: "c-cpt", finish_tag: "CPT-1" }, { id: "c-rb3", finish_tag: "RB-1 – Level 3", multiplier: 2 }],
  shapes: [
    base("a", "c-rb", 100, "101", "SUITE TYPE B", { group: "suite", section: "Suite Type B" }),
    base("b", "c-rb", 40.5, "103", "SUITE TYPE B", { group: "suite", section: "Suite Type B" }),
    base("d2", "c-rb", 70, "102", "SUITE TYPE D", { group: "suite", section: "Suite Type D" }),
    base("c", "c-rb", 60, "5", "CORRIDOR", { group: "common", section: "Common areas" }),
    base("d", "c-rb", 12, "101", "BATH", { group: "washroom", section: "Washrooms" }),
    base("p", "c-rb", 999, "104", "SUITE TYPE B", { group: "suite", section: "Suite Type B" }, { origin: { method: "auto_v1", reviewed: false, auto: { kind: "base", room: "104", name: "SUITE TYPE B", group: "suite" } } }),   // not accepted: not counted
    { id: "h", condition_id: "c-rb", measure_role: "linear", computed: { perimeter_lf: 8 }, origin: { method: "manual", reviewed: true } },   // drawn by hand
    { id: "f", condition_id: "c-cpt", measure_role: "floor_area", computed: { area_sf: 500, perimeter_lf: 90 }, origin: { method: "manual", reviewed: true } },   // a floor: not base
    base("o", "c-rb", 20, "121", "STAFF W/C"),   // accepted before areas were recorded
    base("l3", "c-rb3", 10, "300", "LOUNGE", { group: "common", section: "Common areas" }, { label: "East wing" }),   // someone typed an area name over the room's
  ],
};
const LINKS = [{ condition_key: "c-rb", finish_id: "fin-rb" }, { condition_key: "c-rb3", finish_id: "fin-rb" }, { condition_key: "c-cpt", finish_id: "fin-cpt" }];
const TOTAL = [{ label: "Suite Type B", qty: 140.5 }, { label: "Suite Type D", qty: 70 }, { label: "Common areas", qty: 80 }, { label: "Washrooms", qty: 32 }, { label: "Other", qty: 8 }];

describe("docAreaRows", () => {
  test("accepted lines by finish, estimate section and area; suites by their type; floors and proposals are left out", () => {
    const rows = docAreaRows(doc);
    const sum = (label: string, cond = "c-rb") => rows.filter((r) => r.condition_key === cond && r.label === label).reduce((n, r) => n + r.lf, 0);
    expect(sum("Suite Type B")).toBe(140.5);
    expect(sum("Suite Type D")).toBe(70);
    expect(sum("Common areas")).toBe(60);
    expect(sum("Washrooms")).toBe(32);         // 12 recorded, 20 sorted by the room's name
    expect(sum("Other")).toBe(8);              // drawn by hand: no area recorded
    expect(rows.some((r) => r.condition_key === "c-cpt")).toBe(false);
    expect(rows.find((r) => r.condition_key === "c-rb3")).toEqual({ condition_key: "c-rb3", section: "East wing", area: "common", label: "Common areas", lf: 20 });
  });
  test("the section is the area, not the room: every Suite Type B is under one section, as the quantities are", () => {
    const rows = docAreaRows(doc).filter((r) => r.condition_key === "c-rb");
    expect([...new Set(rows.map((r) => r.section))].sort()).toEqual(["", "Common areas", "Suite Type B", "Suite Type D", "Washrooms"]);
  });
  test("a section with no name of its own takes the finish's variant name, as the quantities do", () => {
    const d = { conditions: [{ id: "v", finish_tag: "RB-1 – Level 3" }], shapes: [{ id: "x", condition_id: "v", measure_role: "linear", computed: { perimeter_lf: 5 }, origin: { method: "manual", reviewed: true } }] };
    expect(docAreaRows(d)[0]).toMatchObject({ section: "Level 3" });
  });
  test("no takeoff: nothing", () => {
    expect(docAreaRows(null)).toEqual([]);
    expect(docAreaRows({})).toEqual([]);
  });
});

describe("areasByFinish and lineAreas", () => {
  const areas = areasByFinish(docAreaRows(doc), LINKS);
  const line = (over: Record<string, unknown> = {}) => ({ id: "L1", finish_id: "fin-rb", source: "takeoff", detached: false, driver_qty: 330.5, driver_uom: "LF", section: "Flooring", ...over });
  test("a finish measured under several takeoff conditions is added up, suites listed by type first", () => {
    expect(areas["fin-rb"]!.total.map((p) => ({ label: p.label, qty: p.qty }))).toEqual(TOTAL);
    expect(areas["fin-cpt"]).toBeUndefined();
  });
  test("one line for the whole finish lists every area, and says whether it adds up to the line", () => {
    const l = line();
    const got = lineAreas(l, [l], areas)!;
    expect(got.areas.map((p) => ({ label: p.label, qty: p.qty }))).toEqual(TOTAL);
    expect(got.matches).toBe(true);
    const edited = line({ driver_qty: 300 });
    expect(lineAreas(edited, [edited], areas)!.matches).toBe(false);
  });
  test("a line that is itself one area needs no breakdown", () => {
    const b = line({ id: "L2", section: "Suite Type B", driver_qty: 140.5 }), w = line({ id: "L3", section: "Washrooms", driver_qty: 32 });
    expect(lineAreas(b, [b, w], areas)).toBeNull();
    expect(lineAreas(w, [b, w], areas)).toBeNull();
  });
  test("no breakdown for a line typed by hand, detached, not in LF, or with nothing sorted into an area", () => {
    for (const l of [line({ source: "manual" }), line({ detached: true }), line({ driver_uom: "SF" }), line({ finish_id: "fin-cpt" }), line({ finish_id: null })]) expect(lineAreas(l, [l], areas)).toBeNull();
    const byHand = areasByFinish([{ condition_key: "c-rb", section: "", area: "other", label: "Other", lf: 50 } as AreaRow], LINKS);
    expect(lineAreas(line({ driver_qty: 50 }), [line({ driver_qty: 50 })], byHand)).toBeNull();
  });
});

describe("areasText", () => {
  test("suites by type, then common areas, washrooms and anything unsorted", () => {
    const areas = areasByFinish(docAreaRows(doc), LINKS);
    expect(areasText(areas["fin-rb"]!.total)).toBe("Suite Type B 140.5 LF · Suite Type D 70 LF · Common areas 80 LF · Washrooms 32 LF · Other 8 LF");
    expect(areasText([{ label: "Other", area: "other", qty: 50 }])).toBeNull();
  });
});

describe("areaSection (the same cases as the takeoff's own rule)", () => {
  test("suites under their type; everything else one line per area", () => {
    expect((["SUITE TYPE B", "SUITE TYPE  D", "UNIT 2BR", "GUEST ROOM KING", "SUITE", "", "B.F. SUITE TYPE C"] as const).map((n) => areaSection("suite", n))).toEqual(["Suite Type B", "Suite Type D", "Unit 2BR", "Guest Room King", "Suites", "Suites", "B.F. Suite Type C"]);
    expect(areaSection("common", "CORRIDOR")).toBe("Common areas");
    expect(areaSection("washroom", "UNIV. W/C")).toBe("Washrooms");
  });
});
