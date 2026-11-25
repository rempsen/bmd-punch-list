import { describe, expect, test } from "bun:test";
import { areaGroup, areaSection, sectionOf } from "./areaSection.js";
import { takeoffQuantities } from "./quantities.js";

describe("areaSection: the estimate section a room's quantities go under", () => {
  test("suites go under their type, so every Suite Type B is one line", () => {
    expect(areaSection("suite", "SUITE TYPE B")).toBe("Suite Type B");
    expect(areaSection("suite", "SUITE TYPE  D")).toBe("Suite Type D");
    expect(areaSection("suite", "UNIT 2BR")).toBe("Unit 2BR");
    expect(areaSection("suite", "GUEST ROOM KING")).toBe("Guest Room King");
    expect(areaSection("suite", "SUITE")).toBe("Suites");
    expect(areaSection("suite", "")).toBe("Suites");
    expect(areaSection("suite", "B.F. SUITE TYPE C")).toBe("B.F. Suite Type C");
  });
  test("everything else is one line per area", () => {
    expect(areaSection("common", "CORRIDOR")).toBe("Common areas");
    expect(areaSection("washroom", "UNIV. W/C")).toBe("Washrooms");
  });
});

const auto = (id, cond, role, room, name, extra = {}, shape = {}) => ({
  id, condition_id: cond, measure_role: role, label: `${room} ${name}`.trim(), computed: role === "linear" ? { perimeter_lf: 100 } : { area_sf: 400, perimeter_lf: 80 },
  origin: { method: "auto_v1", reviewed: true, auto: { kind: role === "linear" ? "base" : "floor", room, name, ...extra } }, ...shape,
});
describe("sectionOf and the quantities sent to the estimate", () => {
  test("a room's own name is not a section: accepted automatic work rolls up by area", () => {
    expect(sectionOf(auto("a", "c", "floor_area", "106", "SUITE TYPE A", { group: "suite", section: "Suite Type A" }))).toBe("Suite Type A");
    expect(sectionOf(auto("a", "c", "linear", "5", "CORRIDOR", { group: "common", section: "Common areas" }))).toBe("Common areas");
    // accepted before sections were recorded: worked out from the room's name
    expect(sectionOf(auto("a", "c", "floor_area", "108", "SUITE TYPE A"))).toBe("Suite Type A");
    expect(sectionOf(auto("a", "c", "linear", "132", "W/C"))).toBe("Washrooms");
    expect(sectionOf(auto("a", "c", "linear", "126", "DINING"))).toBe("Common areas");
  });
  test("an area name someone typed over it wins; hand-drawn work keeps its own; a transition has none", () => {
    expect(sectionOf(auto("a", "c", "floor_area", "106", "SUITE TYPE A", { section: "Suite Type A" }, { label: "Phase 2" }))).toBe("Phase 2");
    expect(sectionOf({ id: "h", label: "Level 3", origin: { method: "manual", reviewed: true } })).toBe("Level 3");
    expect(sectionOf({ id: "h", origin: { method: "manual", reviewed: true } })).toBe("");
    expect(sectionOf({ id: "t", label: "124/126", origin: { method: "auto_v1", reviewed: true, auto: { kind: "transition", room: "124/126", name: "LVT-1 to PORC" } } })).toBe("");
  });
  test("six suites of two types and a corridor become three lines of base, not seven", () => {
    const doc = {
      conditions: [{ id: "rb", finish_tag: "RB-1", color: "#111111", multiplier: 1 }],
      shapes: [
        ...["101", "103", "104", "109"].map((n) => auto(`b${n}`, "rb", "linear", n, "SUITE TYPE B", { group: "suite", section: "Suite Type B" })),
        ...["102", "145"].map((n) => auto(`c${n}`, "rb", "linear", n, "SUITE TYPE C", { group: "suite", section: "Suite Type C" })),
        auto("cor", "rb", "linear", "5", "CORRIDOR", { group: "common", section: "Common areas" }),
        auto("bath", "rb", "linear", "101", "BATH", { group: "washroom", section: "Washrooms" }),
      ],
    };
    expect(takeoffQuantities(doc).rows.map((r) => [r.section, r.lf])).toEqual([["Suite Type B", 400], ["Suite Type C", 200], ["Common areas", 100], ["Washrooms", 100]]);
  });
  test("areaGroup is unchanged", () => {
    expect(areaGroup("BEDROOM", "SUITE TYPE A")).toBe("suite");
  });
});
