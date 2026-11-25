import { describe, expect, test } from "bun:test";
import { takeoffQuantities } from "./quantities.js";

const cond = (id, tag, extra = {}) => ({ id, finish_tag: tag, color: "#111111", multiplier: 1, waste_pct: 10, ...extra });
const area = (id, c, sf, extra = {}) => ({ id, condition_id: c, measure_role: "floor_area", computed: { area_sf: sf, perimeter_lf: 40 }, ...extra });

describe("takeoffQuantities", () => {
  test("measured quantities per finish, with no waste added", () => {
    const q = takeoffQuantities({ conditions: [cond("cnd-1", "CPT-1")], shapes: [area("a", "cnd-1", 100), area("b", "cnd-1", 50.5), { id: "d", condition_id: "cnd-1", measure_role: "deduct", computed: { area_sf: 10 } }] });
    expect(q.conditions).toEqual([{ key: "cnd-1", tag: "CPT-1", variant: false, colour: "#111111" }]);
    expect(q.rows).toEqual([{ key: "cnd-1", section: "", floor_sf: 140.5, wall_sf: 0, border_sf: 0, lf: 0, ea: 0 }]);
  });
  test("a shape's area label splits its finish into sections", () => {
    const q = takeoffQuantities({ conditions: [cond("cnd-1", "CPT-1")], shapes: [area("a", "cnd-1", 100, { label: "Level 2" }), area("b", "cnd-1", 50), area("c", "cnd-1", 25, { label: "Level 2" })] });
    expect(q.rows.map((r) => [r.section, r.floor_sf])).toEqual([["Level 2", 125], ["", 50]]);
  });
  test("the same finish measured as an area variant is that finish, in that section", () => {
    const q = takeoffQuantities({ conditions: [cond("cnd-1", "CPT-1"), cond("cnd-2", "CPT-1 – Level 3")], shapes: [area("a", "cnd-2", 80)] });
    expect(q.conditions[1]).toEqual({ key: "cnd-2", tag: "CPT-1", variant: true, colour: "#111111" });
    expect(q.rows).toEqual([{ key: "cnd-2", section: "Level 3", floor_sf: 80, wall_sf: 0, border_sf: 0, lf: 0, ea: 0 }]);
  });
  test("proposals waiting for review are left out", () => {
    const q = takeoffQuantities({ conditions: [cond("cnd-1", "CPT-1")], shapes: [area("a", "cnd-1", 100), area("b", "cnd-1", 999, { origin: { actor: "agent", reviewed: false } })] });
    expect(q.rows[0].floor_sf).toBe(100);
  });
  test("the automatic takeoff's proposals are left out until accepted, floor and base alike", () => {
    const auto = (reviewed) => ({ method: "auto_v1", actor: "auto", reviewed, confidence: 0.9, auto: { kind: "floor", room: "101" } });
    const doc = (reviewed) => ({ conditions: [cond("cnd-1", "CPT-1"), cond("cnd-2", "RB-1")], shapes: [area("a", "cnd-1", 100), area("b", "cnd-1", 250, { origin: auto(reviewed), label: "101 OFFICE" }), { id: "l", condition_id: "cnd-2", measure_role: "linear", computed: { perimeter_lf: 64 }, origin: auto(reviewed) }, area("u", null, 80, { origin: auto(reviewed) })] });
    expect(takeoffQuantities(doc(false)).rows).toEqual([{ key: "cnd-1", section: "", floor_sf: 100, wall_sf: 0, border_sf: 0, lf: 0, ea: 0 }]);
    const after = takeoffQuantities(doc(true)).rows;
    expect(after.map((r) => [r.key, r.section, r.floor_sf, r.lf])).toEqual([["cnd-1", "", 100, 0], ["cnd-1", "101 OFFICE", 250, 0], ["cnd-2", "Common areas", 0, 64]]);   // a shape with no finish never reaches the estimate
  });
  test("lines, counts and the multiplier", () => {
    const q = takeoffQuantities({ conditions: [cond("cnd-1", "RB-1", { multiplier: 3 })], shapes: [{ id: "l", condition_id: "cnd-1", measure_role: "linear", computed: { perimeter_lf: 20 } }, { id: "c", condition_id: "cnd-1", measure_role: "count", computed: { count: 1 } }] });
    expect(q.rows[0]).toMatchObject({ lf: 60, ea: 3 });
  });
  test("a finish with nothing measured sends no rows but is still listed", () => {
    const q = takeoffQuantities({ conditions: [cond("cnd-1", "CPT-1")], shapes: [] });
    expect(q.conditions.length).toBe(1);
    expect(q.rows).toEqual([]);
  });
});
