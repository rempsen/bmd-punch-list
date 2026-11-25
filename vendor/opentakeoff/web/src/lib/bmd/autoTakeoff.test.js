import { describe, expect, test } from "bun:test";
import { createRoomFinder } from "./roomParts.js";
import { baseRuns } from "./baseFromRoom.js";
import { LIMITS, METHOD, applyDecisions, areaGroup, pickScheduleRows, runSheet, runSummary, sheetChoice } from "./autoTakeoff.js";
import { acceptBase, acceptProposals, baseByGroup, idsAbove, idsOnSheet, isProposal, proposalsIn, removeProposals, reviewCount, reviewList, setProposalFinish } from "./autoReview.js";
import { takeoffQuantities } from "./quantities.js";
import { finishTotals } from "./takeoffDoc.js";

// A hand-drawn sheet, as pure data: 18 image pixels to the foot. Three rooms in a row, each 20 ft × 16 ft 8 in
// (333.3 SF, 73.3 LF around). The middle room has a 3 ft door opening in its bottom wall. The right-hand room
// carries two tags. One more tag sits outside the building.
const FT = 18, UPP = 1 / FT, DIMS = { w: 1400, h: 900 };
function drawing() {
  const segs = [], meta = [], lum = [], dashed = [], subpaths = [], points = [];
  const line = (x1, y1, x2, y2) => {
    subpaths.push({ i0: meta.length, i1: meta.length + 1, x0: Math.min(x1, x2), y0: Math.min(y1, y2), x1: Math.max(x1, x2), y1: Math.max(y1, y2), closed: false, flags: 16, fillLum: 0 });
    segs.push(x1, y1, x2, y2); meta.push(16); lum.push(0); dashed.push(0); points.push([x1, y1], [x2, y2]);
  };
  line(100, 100, 1180, 100);                           // top
  line(100, 100, 100, 400); line(1180, 100, 1180, 400); // ends
  line(460, 100, 460, 400); line(820, 100, 820, 400);   // dividers
  line(100, 400, 600, 400); line(654, 400, 1180, 400);  // bottom, with the door opening from 600 to 654
  return { segs, meta: Uint8Array.from(meta), lum: Uint8Array.from(lum), dashed: Uint8Array.from(dashed), subpaths, points };
}
const t = (str, x, y, w = str.length * 8, h = 13) => ({ str, x, y, w, h });
const tagText = (name, number, cx, y) => [t(name, cx - name.length * 4, y - 20), t(number, cx - 11, y, 22)];
const SPANS = [
  ...tagText("OFFICE", "101", 280, 250), ...tagText("STORAGE", "102", 640, 250), ...tagText("LOBBY", "103", 940, 200), ...tagText("RM", "104", 1060, 320),
  ...tagText("PATIO", "000", 700, 700), t("LVT-1", 900, 300, 40),
  t("12", 300, 40, 40, 36), t("2160", 500, 380, 28, 16),   // a grid bubble and a dimension: not rooms
];
function engineFor({ scale = null, linework = true, geo = drawing() } = {}) {
  const finder = createRoomFinder({ geo, texts: [], dims: DIMS, pagePt: { w: DIMS.w / 2, h: DIMS.h / 2 }, renderScale: 2 });
  return {
    dims: DIMS,
    detectedScale: async () => scale,
    hasLinework: async () => linework,
    roomAt: async (x, y, upp) => finder.roomAt(x, y, upp),
    baseAlong: async (ring, upp) => baseRuns(ring, upp, (x, y) => finder.edgeAt(x, y, upp)),
  };
}
const SHEET = { key: "plans.pdf#4", label: "A-100" };
const cond = (id, tag) => ({ id, finish_tag: tag, color: "#111111", fill: "#111111", multiplier: 1, waste_pct: 0, materials: [] });
const blank = (extra = {}) => ({ conditions: [cond("c1", "CPT-1"), cond("c2", "RB-1"), cond("c3", "LVT-1")], shapes: [], sheets: [{ sheet_id: SHEET.key, units_per_px: UPP, scale_source: "standard" }], ...extra });
const SCHEDULE = { reader: "BMD", rows: [
  { number: "101", name: "OFFICE", floor: "CPT 1", base: "RB-1", areaSf: 340 },
  { number: "102", name: "STORAGE", floor: "PORC", base: "RB-1", areaSf: 900 },
] };
const run = (over = {}) => runSheet({ doc: blank(), sheet: SHEET, engine: engineFor(), spans: SPANS, schedule: SCHEDULE, runId: "run-1", now: () => "2026-11-24T12:00:00.000Z", ...over });
const floorOf = (doc, room) => doc.shapes.find((s) => s.origin?.auto?.kind === "floor" && s.origin.auto.room === room);
const baseOf = (doc, room) => doc.shapes.filter((s) => s.origin?.auto?.kind === "base" && s.origin.auto.room === room);

describe("runSheet", () => {
  test("finds the tagged rooms, measures each with the engine and proposes them", async () => {
    const { doc, report } = await run();
    expect(report).toMatchObject({ skipped: null, tags: 5, measured: 3, sameOutline: 1, already: 0, scale: { source: "saved" } });
    expect(report.notMeasured.map((n) => n.room)).toEqual(["000 PATIO"]);
    const floors = doc.shapes.filter((s) => s.measure_role === "floor_area");
    expect(floors.map((s) => s.label)).toEqual(["101 OFFICE", "102 STORAGE", "103 LOBBY"]);
    for (const s of floors) {
      expect(Math.abs(s.computed.area_sf - 333.3)).toBeLessThan(333.3 * 0.04);
      expect(s.origin).toMatchObject({ method: METHOD, reviewed: false, actor: "auto", proposed_ts: "2026-11-24T12:00:00.000Z" });
      expect(s.origin.confidence).toBeGreaterThan(0);
      expect(s.origin.confidence).toBeLessThanOrEqual(1);
      expect(s.origin.seed_norm.length).toBe(2);
    }
    expect(Math.abs(report.sf - 1000)).toBeLessThan(40);
    expect(doc.shape_labels).toEqual(["101 OFFICE", "102 STORAGE", "103 LOBBY"]);
  });
  test("the finish comes from the schedule row, else from a tag in the room, and says which", async () => {
    const { doc, report } = await run();
    expect(report.assigned).toEqual({ schedule: 2, tag: 1, ai: 0, none: 0 });
    const a = floorOf(doc, "101"), b = floorOf(doc, "102"), c = floorOf(doc, "103");
    expect(a.condition_id).toBe("c1");                       // "CPT 1" in the schedule is CPT-1 on the job
    expect(a.origin.auto).toMatchObject({ from: "schedule", room: "101", name: "OFFICE" });
    expect(a.origin.auto.why).toContain("row 101 OFFICE: floor CPT 1");
    expect(a.origin.auto.finish_tag).toBeUndefined();
    expect(b.condition_id).toBeNull();                       // PORC is not on the job: kept as written, not invented
    expect(b.origin.auto.finish_tag).toBe("PORC");
    expect(report.newFinishes).toEqual(["PORC"]);
    expect(doc.conditions.map((x) => x.finish_tag)).toEqual(["CPT-1", "RB-1", "LVT-1"]);
    expect(c.condition_id).toBe("c3");
    expect(c.origin.auto).toMatchObject({ from: "tag", why: "LVT-1 is lettered inside this room." });
  });
  test("two tags in one outline make one proposal, rated lower, and it says so", async () => {
    const { doc } = await run();
    const c = floorOf(doc, "103");
    expect(c.origin.auto.also).toEqual(["104 RM"]);
    expect(c.origin.auto.notes.join(" ")).toContain("103 LOBBY and 104 RM are inside this one outline");
    expect(doc.shapes.filter((s) => s.origin.auto.room === "104")).toEqual([]);
  });
  test("the schedule's printed area raises or lowers the rating", async () => {
    const { doc } = await run();
    const a = floorOf(doc, "101"), b = floorOf(doc, "102");
    expect(a.origin.auto.schedule_sf).toBe(340);
    expect(a.origin.auto.notes[0]).toContain("the schedule prints 340.0 SF");
    expect(b.origin.auto.notes[0]).toContain("probably has more spaces inside");
    expect(a.origin.confidence).toBeGreaterThan(b.origin.confidence);
    expect(b.origin.confidence).toBeLessThan(0.8);
  });
  test("base follows the walls and leaves a door opening out where the drawing shows one", async () => {
    const { doc, report } = await run();
    const a = baseOf(doc, "101"), b = baseOf(doc, "102");
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({ measure_role: "linear", condition_id: "c2", label: "101 OFFICE" });
    expect(Math.abs(a[0].computed.perimeter_lf - 73.3)).toBeLessThan(2);
    expect(a[0].origin.auto).toMatchObject({ kind: "base", of: floorOf(doc, "101").id, openings: 0, openings_deducted: false });
    expect(a[0].origin.auto.notes[0]).toContain("No door openings could be told");
    const lf = b.reduce((n, s) => n + s.computed.perimeter_lf, 0);
    expect(b[0].origin.auto).toMatchObject({ openings: 1, openings_deducted: true });
    expect(lf).toBeGreaterThan(73.3 - 3 - 1.5);
    expect(lf).toBeLessThan(73.3 - 1.5);
    expect(b[0].origin.confidence).toBeGreaterThan(0);
    const c = baseOf(doc, "103");                             // no schedule row: the base is still measured, with no finish chosen
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]).toMatchObject({ measure_role: "linear", condition_id: null });
    expect(c[0].origin.auto).toMatchObject({ kind: "base", from: "none", group: "common" });
    expect(c[0].origin.auto.why).toContain("gives no base");
    expect(report.base).toMatchObject({ rooms: 3 });
  });
  test("with no schedule and no tag in the room, the room is proposed with no finish, rated low", async () => {
    const { doc, report } = await run({ schedule: { rows: [], reader: null }, spans: SPANS.filter((s) => s.str !== "LVT-1") });
    expect(report.assigned).toEqual({ schedule: 0, tag: 0, ai: 0, none: 3 });
    for (const s of doc.shapes) {
      expect(s.condition_id).toBeNull();
      expect(s.origin.auto.finish_tag).toBeUndefined();
      expect(s.origin.auto.from).toBe("none");
      expect(s.origin.confidence).toBeLessThanOrEqual(0.4);
    }
    expect(report.unassigned.map((u) => u.room)).toEqual(["101", "102", "103"]);
    expect(report.unassigned[0].texts).toContain("OFFICE");
  });
  test("two finish tags in one room: no guess", async () => {
    const { doc } = await run({ spans: [...SPANS, t("CPT-1", 900, 330, 40)] });
    expect(floorOf(doc, "103").condition_id).toBeNull();
    expect(floorOf(doc, "103").origin.auto.why).toContain("LVT-1 and CPT-1 are both lettered in this room, so the floor finish was not chosen");
  });
  test("a sheet with no scale is skipped and says why; a scale written on the sheet is used and saved", async () => {
    const none = await run({ doc: blank({ sheets: [] }) });
    expect(none.report.skipped).toBe("No scale could be read on A-100; set it and run again.");
    expect(none.doc.shapes).toEqual([]);
    const two = await run({ doc: blank({ sheets: [] }), engine: engineFor({ scale: { upp: UPP, label: "1:100", multi: true } }) });
    expect(two.report.skipped).toContain("More than one scale is written on A-100");
    const read = await run({ doc: blank({ sheets: [] }), engine: engineFor({ scale: { upp: UPP, label: '1/8" = 1\'-0"', multi: false } }) });
    expect(read.report.scale).toMatchObject({ source: "sheet", label: '1/8" = 1\'-0"' });
    expect(read.doc.sheets).toEqual([{ sheet_id: SHEET.key, units_per_px: UPP, scale_source: "detected" }]);
    expect(read.report.measured).toBe(3);
  });
  test("a scan, and a sheet with no room tags, are skipped with the reason", async () => {
    expect((await run({ engine: engineFor({ linework: false }) })).report.skipped).toContain("is a scan with no drawn linework");
    expect((await run({ spans: [t("GENERAL NOTES", 100, 100)] })).report.skipped).toContain("No room tags");
  });
  test("rooms already measured are left alone, so running twice proposes nothing new", async () => {
    const first = await run();
    const second = await run({ doc: first.doc });
    expect(second.report).toMatchObject({ measured: 0, already: 4 });
    expect(second.doc.shapes.length).toBe(first.doc.shapes.length);
  });
  test("a room measured on another sheet in the same run is not measured again", async () => {
    const taken = new Map([["101", "A-103"]]);
    const { report } = await run({ takenRooms: taken });
    expect(report).toMatchObject({ measured: 2, otherSheet: 1 });
    expect(taken.get("102")).toBe("A-100");
  });
  test("stopping keeps what was proposed so far", async () => {
    let seen = 0;
    const { doc, report } = await run({ shouldStop: () => seen++ >= 1 });
    expect(report).toMatchObject({ stopped: true, measured: 1 });
    expect(doc.shapes.some((s) => s.label === "101 OFFICE")).toBe(true);
  });
  test("progress is reported room by room", async () => {
    const said = [];
    await run({ onProgress: (p) => said.push(p.text) });
    expect(said[0]).toBe("A-100: found 5 rooms");
    expect(said).toContain("A-100: found 5 rooms, measuring 2 of 5");
  });
  test("rooms that all measure well under the schedule's areas raise a doubt about the scale", async () => {
    const spans = [], rows = [];
    for (let i = 0; i < 6; i++) { spans.push(...tagText("OFFICE", `20${i}`, 150 + i * 200, 300)); rows.push({ number: `20${i}`, name: "OFFICE", floor: "CPT-1", base: "", areaSf: 144 }); }
    const box = (x) => { const c = Math.round((x - 150) / 200) * 200 + 150; return [[c - 80, 200], [c + 80, 200], [c + 80, 400], [c - 80, 400]]; };
    const engine = { dims: DIMS, detectedScale: async () => null, hasLinework: async () => true, baseAlong: async () => ({ runs: [] }), roomAt: async (x) => ({ ok: true, kind: "room", pointsPx: box(x), areaSf: 100, perimeterLf: 40, confidence: 0.8, note: null, fixtures: [], withFixtures: null }) };
    rows[5].areaSf = 600;   // one room far below even the sheet's typical difference
    const { doc, report } = await run({ engine, spans, schedule: { rows, reader: "BMD" } });
    expect(report.measured).toBe(6);
    // every room on a doubted sheet is held at 70% or less and says why; the room that is far off still stands out
    for (const s of doc.shapes) expect(s.origin.confidence).toBeLessThanOrEqual(0.7);
    expect(floorOf(doc, "200").origin.auto.notes.join(" ")).toContain("Areas on this sheet run about 69% of the schedule's: check the scale.");
    expect(floorOf(doc, "200").origin.auto.notes.join(" ")).not.toContain("more spaces inside");
    expect(floorOf(doc, "205").origin.auto.notes.join(" ")).toContain("more spaces inside");
    expect(floorOf(doc, "205").origin.confidence).toBeLessThan(floorOf(doc, "200").origin.confidence);
    expect(report.scaleDoubt).toMatchObject({ ratio: 0.69, rooms: 5 });
    expect(report.scaleDoubt.text).toContain("about 69% of the areas printed in the room finish schedule (5 rooms compared)");
    expect(runSummary([report])[0]).toBe(report.scaleDoubt.text);
  });
});

describe("proposals do not count until accepted", () => {
  test("not in the totals on screen and not in what is sent to the estimate", async () => {
    const { doc } = await run();
    expect(proposalsIn(doc).length).toBe(doc.shapes.length);
    expect(takeoffQuantities(doc).rows).toEqual([]);
    expect(finishTotals(doc).every((r) => r.areaSf === 0 && r.lengthLf === 0 && r.shapes === 0)).toBe(true);
    expect(takeoffQuantities(doc).conditions.map((c) => c.tag)).toEqual(["CPT-1", "RB-1", "LVT-1"]);   // no finish was added by proposing
  });
  test("accepting one makes it count, in one step, and leaves the others as proposals", async () => {
    const { doc } = await run();
    const a = floorOf(doc, "101");
    const out = acceptProposals(doc, [a.id], () => "2026-11-24T13:00:00.000Z");
    expect(out).toMatchObject({ accepted: 1, needFinish: 0 });
    const now = out.doc.shapes.find((s) => s.id === a.id);
    expect(now.origin).toMatchObject({ reviewed: true, method: METHOD, accepted_ts: "2026-11-24T13:00:00.000Z" });
    expect(now.verts_norm).toEqual(a.verts_norm);
    const q = takeoffQuantities(out.doc);
    expect(q.rows).toEqual([{ key: "c1", section: "101 OFFICE", floor_sf: a.computed.area_sf, wall_sf: 0, border_sf: 0, lf: 0, ea: 0 }]);
    expect(proposalsIn(out.doc).length).toBe(doc.shapes.length - 1);
    expect(doc.shapes.find((s) => s.id === a.id).origin.reviewed).toBe(false);   // the document before is untouched: undo puts it back
  });
  test("accepting a proposal whose finish is a schedule code adds that finish then, once", async () => {
    const { doc } = await run({ schedule: { reader: "BMD", rows: [...SCHEDULE.rows, { number: "103", name: "LOBBY", floor: "PORC", base: "", areaSf: null }] } });
    const ids = [floorOf(doc, "102").id, floorOf(doc, "103").id];
    const out = acceptProposals(doc, ids);
    expect(out.accepted).toBe(2);
    expect(out.doc.conditions.map((c) => c.finish_tag)).toEqual(["CPT-1", "RB-1", "LVT-1", "PORC"]);
    const porc = out.doc.conditions[3].id;
    expect(out.doc.shapes.filter((s) => ids.includes(s.id)).map((s) => s.condition_id)).toEqual([porc, porc]);
    expect(out.doc.shapes.find((s) => s.id === ids[0]).origin.auto.finish_tag).toBeUndefined();
  });
  test("a proposal with no finish cannot be accepted until one is chosen", async () => {
    const { doc } = await run({ schedule: { rows: [], reader: null }, spans: SPANS.filter((s) => s.str !== "LVT-1") });
    const id = floorOf(doc, "101").id;
    expect(acceptProposals(doc, [id])).toMatchObject({ accepted: 0, needFinish: 1, doc });
    const chosen = setProposalFinish(doc, [id], "c3");
    expect(chosen.shapes.find((s) => s.id === id)).toMatchObject({ condition_id: "c3", origin: { reviewed: false, auto: { from: "person" } } });
    expect(acceptProposals(chosen, [id]).accepted).toBe(1);
    expect(() => setProposalFinish(doc, [id], "nope")).toThrow();
  });
  test("removing a room's proposal removes its base too, and never touches accepted work", async () => {
    const { doc } = await run();
    const a = floorOf(doc, "101");
    const out = removeProposals(doc, [a.id]);
    expect(out.shapes.some((s) => s.origin.auto.room === "101")).toBe(false);
    expect(out.shapes.length).toBe(doc.shapes.length - 2);
    const accepted = acceptProposals(doc, [a.id]).doc;
    expect(removeProposals(accepted, [a.id]).shapes.some((s) => s.id === a.id)).toBe(true);
  });
  test("accept all above 80%, and all on one sheet", async () => {
    const { doc } = await run();
    const above = idsAbove(doc, 0.8);
    expect(above.length).toBeGreaterThan(0);
    expect(above.length).toBeLessThan(doc.shapes.length);
    for (const s of doc.shapes) expect(above.includes(s.id)).toBe(s.origin.confidence > 0.8);
    expect(idsOnSheet(doc, SHEET.key).length).toBe(doc.shapes.length);
    expect(idsOnSheet(doc, "other#1")).toEqual([]);
    expect(isProposal({ origin: { method: "one_click_v1", reviewed: true } })).toBe(false);
  });
});

describe("reviewList", () => {
  test("by sheet, then finish, lowest confidence first, with a room's base as one item", async () => {
    const { doc } = await run();
    const list = reviewList(doc, [{ key: "other#1", label: "A-000", page: 1 }, { key: SHEET.key, label: "A-100", page: 4 }]);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ sheetKey: SHEET.key, sheetLabel: "A-100", count: 6 });
    expect(reviewCount(doc.shapes)).toBe(6);   // three floors and three rooms' base, however many lines the base is drawn as
    expect(reviewCount(acceptProposals(doc, [floorOf(doc, "101").id]).doc.shapes)).toBe(5);
    expect(list[0].groups.map((g) => [g.finish, g.isNew, g.items.length])).toEqual([[null, false, 1], ["CPT-1", false, 1], ["LVT-1", false, 1], ["PORC", true, 1], ["RB-1", false, 2]]);
    const base = list[0].groups[4].items;
    expect(base[0].confidence).toBeLessThanOrEqual(base[1].confidence);
    const b102 = base.find((i) => i.room === "102");
    expect(b102).toMatchObject({ kind: "base", unit: "LF", from: "schedule" });
    expect(b102.ids.length).toBe(baseOf(doc, "102").length);
    expect(b102.qty).toBeCloseTo(baseOf(doc, "102").reduce((n, s) => n + s.computed.perimeter_lf, 0), 1);
    const office = list[0].groups[1].items[0];
    expect(office).toMatchObject({ kind: "floor", room: "101", name: "OFFICE", unit: "SF", finish: "CPT-1", from: "schedule" });
    expect(office.qty).toBe(floorOf(doc, "101").computed.area_sf);
  });
  test("rooms with no finish chosen come first", async () => {
    const { doc } = await run({ schedule: { rows: [SCHEDULE.rows[0]], reader: "BMD" }, spans: SPANS.filter((s) => s.str !== "LVT-1") });
    expect(reviewList(doc, [])[0].groups[0]).toMatchObject({ finish: null });
    expect(reviewList({ shapes: [] }, [])).toEqual([]);
  });
});

describe("applyDecisions (the optional AI helper)", () => {
  test("an answer is used only for a room left without a finish, only for a finish on the job, and is marked", async () => {
    const { doc } = await run({ schedule: { rows: [], reader: null }, spans: SPANS.filter((s) => s.str !== "LVT-1") });
    const [a, b, c] = ["101", "102", "103"].map((r) => floorOf(doc, r));
    const out = applyDecisions(doc, [{ shapeId: a.id, tag: "cpt 1", reason: "Offices take carpet per the schedule." }, { shapeId: b.id, tag: "MARBLE-9", reason: "made up" }, { shapeId: "nope", tag: "CPT-1" }]);
    expect(out.applied).toBe(1);
    const got = out.doc.shapes.find((s) => s.id === a.id);
    expect(got.condition_id).toBe("c1");
    expect(got.origin.auto).toMatchObject({ from: "ai", why: "AI suggestion: Offices take carpet per the schedule." });
    expect(got.origin.confidence).toBeLessThanOrEqual(0.6);
    expect(got.origin.reviewed).toBe(false);
    expect(out.doc.shapes.find((s) => s.id === b.id).condition_id).toBeNull();
    expect(out.doc.shapes.find((s) => s.id === c.id)).toEqual(c);
  });
  test("a code the schedule uses is allowed even when it is not on the job yet; no answers change nothing", async () => {
    const { doc } = await run({ schedule: { rows: [], reader: null }, spans: SPANS.filter((s) => s.str !== "LVT-1") });
    const a = floorOf(doc, "101");
    const out = applyDecisions(doc, [{ shapeId: a.id, tag: "PORC" }], ["PORC", "RWB"]);
    expect(out.doc.shapes.find((s) => s.id === a.id).origin.auto).toMatchObject({ from: "ai", finish_tag: "PORC" });
    expect(applyDecisions(doc, []).doc).toBe(doc);
    expect(applyDecisions(doc, null)).toEqual({ doc, applied: 0 });
  });
  test("a room that already has a finish from the drawings is never overruled", async () => {
    const { doc } = await run();
    const a = floorOf(doc, "101");
    expect(applyDecisions(doc, [{ shapeId: a.id, tag: "LVT-1" }]).applied).toBe(0);
  });
});

describe("sheetChoice", () => {
  test("floor plans with room tags are ticked", () => {
    expect(sheetChoice({ title: "MAIN FLOOR PLAN -", role: "plan", roomTags: 46 })).toEqual({ ticked: true, why: "Floor plan with 46 room tags" });
    expect(sheetChoice({ title: "FINISH PLAN - LEVEL 2", role: "plan", roomTags: 12 }).ticked).toBe(true);
  });
  test("ceiling, roof, furniture and other plans are not, and say what they are", () => {
    expect(sheetChoice({ title: "MAIN FLOOR CEILING PLAN", role: "plan", roomTags: 48 })).toEqual({ ticked: false, why: "Main floor ceiling plan: not a floor finish plan" });
    expect(sheetChoice({ title: "FURNITURE PLAN - MAIN", role: "plan", roomTags: 47 }).ticked).toBe(false);
    expect(sheetChoice({ title: "ROOF PLAN NOTES:", role: "plan", roomTags: 2 }).ticked).toBe(false);
  });
  test("a floor plan with no room tags, a schedule, and everything else", () => {
    expect(sheetChoice({ title: "SECOND FLOOR PLAN", role: "plan", roomTags: 0 })).toEqual({ ticked: false, why: "Floor plan, but no room tags found" });
    expect(sheetChoice({ title: "Room Finish Schedule", role: "schedule", roomTags: 0 })).toEqual({ ticked: false, why: "Schedule or legend: read for finishes, not measured" });
    expect(sheetChoice({ title: "ELEVATIONS", role: "elevation", roomTags: 80 }).ticked).toBe(false);
    expect(sheetChoice({}).ticked).toBe(false);
  });
});

describe("pickScheduleRows", () => {
  const good = [{ number: "101", floor: "LVT 2" }, { number: "102", floor: "CPT" }];
  test("the reader with more rows that look like rooms is used; OpenTakeoff's wins a tie", () => {
    expect(pickScheduleRows(good, good)).toEqual({ rows: good, reader: "OpenTakeoff" });
    expect(pickScheduleRows([good[0]], good)).toEqual({ rows: good, reader: "BMD" });
  });
  test("jumbled rows count for nothing", () => {
    const jumbled = [{ number: "839SF", floor: "839 SF CPT RWB GWB VWC" }, { number: "223", floor: "" }];
    expect(pickScheduleRows(jumbled, good).reader).toBe("BMD");
    expect(pickScheduleRows(jumbled, [])).toEqual({ rows: [], reader: null });
  });
});

describe("runSummary", () => {
  test("says plainly what was skipped and why", async () => {
    const skipped = (await run({ doc: blank({ sheets: [] }) })).report;
    const ran = (await run()).report;
    const lines = runSummary([skipped, ran]);
    expect(lines[0]).toBe("No scale could be read on A-100; set it and run again.");
    expect(lines.join("\n")).toContain("1 tagged room could not be measured (000 PATIO)");
    expect(lines.join("\n")).toContain("door openings could not be told on 2 rooms");
    expect(LIMITS).toContain("strongest on drawings exported from CAD");
  });
});

// A second hand-drawn sheet: suite 201 (20 ft × 16 ft 8 in, 333.3 SF) with a bathroom beside it (10 ft wide,
// 166.7 SF) that carries only its name, reached through a 3 ft opening; and a corridor below (333.3 SF) reached
// from the suite through another 3 ft opening. The schedule prints 500 SF for the suite: the room and its bathroom.
function suiteDrawing() {
  const segs = [], meta = [], lum = [], dashed = [], subpaths = [], points = [];
  const line = (x1, y1, x2, y2, flags = 16) => {
    subpaths.push({ i0: meta.length, i1: meta.length + 1, x0: Math.min(x1, x2), y0: Math.min(y1, y2), x1: Math.max(x1, x2), y1: Math.max(y1, y2), closed: false, flags, fillLum: 0 });
    segs.push(x1, y1, x2, y2); meta.push(flags); lum.push(0); dashed.push(0); points.push([x1, y1], [x2, y2]);
  };
  // a door: its leaf from the hinge, and the swing (curved linework) round to the far jamb
  const door = (hx, hy, ax, ay, bx, by) => {
    line(hx, hy, ax, ay);
    const a0 = Math.atan2(ay - hy, ax - hx), a1 = Math.atan2(by - hy, bx - hx), r = Math.hypot(ax - hx, ay - hy);
    let p = [ax, ay];
    for (let k = 1; k <= 8; k++) { const a = a0 + ((a1 - a0) * k) / 8, q = [hx + r * Math.cos(a), hy + r * Math.sin(a)]; line(p[0], p[1], q[0], q[1], 17); p = q; }
  };
  door(460, 200, 406, 200, 460, 254); door(200, 400, 200, 346, 254, 400);
  line(100, 100, 640, 100); line(100, 100, 100, 600); line(640, 100, 640, 600); line(100, 600, 640, 600);
  line(460, 100, 460, 200); line(460, 254, 460, 400);   // suite | bath, opening from 200 to 254
  line(100, 400, 200, 400); line(254, 400, 640, 400);   // suite over corridor, opening from 200 to 254
  return { segs, meta: Uint8Array.from(meta), lum: Uint8Array.from(lum), dashed: Uint8Array.from(dashed), subpaths, points };
}
const SUITE_SPANS = [...tagText("SUITE", "201", 280, 250), t("BATH", 534, 250), ...tagText("CORRIDOR", "200", 400, 500), t("EXISTING", 520, 330), t("CLOSET", 900, 700)];
const SUITE_SCHEDULE = { reader: "BMD", rows: [{ number: "201", name: "SUITE", floor: "LVT-1", base: "RB-1", areaSf: 500 }, { number: "200", name: "CORRIDOR", floor: "CPT-1", base: "RB-1", areaSf: 333 }] };
const suiteRun = (over = {}) => runSheet({ doc: blank(), sheet: SHEET, engine: engineFor({ geo: suiteDrawing() }), spans: SUITE_SPANS, schedule: SUITE_SCHEDULE, runId: "run-2", now: () => "2026-11-24T12:00:00.000Z", ...over });
const kindOf = (doc, kind) => doc.shapes.filter((s) => s.origin?.auto?.kind === kind);

describe("spaces inside a suite that carry only a name", () => {
  test("the bathroom is measured and proposed under the suite's number, with no finish chosen for it", async () => {
    const { doc, report } = await suiteRun();
    expect(report.inside).toMatchObject({ rooms: 1 });
    const suite = floorOf(doc, "201"), bath = doc.shapes.find((s) => s.label === "201 BATH");
    expect(bath).toMatchObject({ measure_role: "floor_area", condition_id: null });
    expect(Math.abs(bath.computed.area_sf - 166.7)).toBeLessThan(1);   // exactly the bathroom: its door swings into the suite, so the swing is the suite's floor (hard rule)
    expect(bath.origin).toMatchObject({ method: METHOD, reviewed: false });
    expect(bath.origin.auto).toMatchObject({ kind: "inside", room: "201", name: "BATH", of: suite.id, from: "none" });
    expect(bath.origin.auto.why).toContain("inside 201 SUITE");
    expect(bath.origin.auto.why).toContain("LVT-1");
    expect(bath.origin.confidence).toBeLessThanOrEqual(0.5);
    expect(report.unassigned.map((u) => u.shapeId)).toContain(bath.id);
    expect(doc.shapes.some((s) => s.label?.includes("EXISTING") || s.label?.includes("CLOSET"))).toBe(false);   // a note, and a name in no enclosed space
  });
  test("the suite's area is then compared with the schedule together with what was found inside it", async () => {
    const { doc } = await suiteRun();
    const notes = floorOf(doc, "201").origin.auto.notes.join(" ");
    expect(notes).toContain("with the 1 space found inside it");
    expect(notes).toContain("the schedule prints 500.0 SF");
    expect(notes).not.toContain("probably has more spaces inside it");
    const alone = await suiteRun({ spans: SUITE_SPANS.filter((s) => s.str !== "BATH") });
    expect(floorOf(doc, "201").origin.confidence).toBeGreaterThan(floorOf(alone.doc, "201").origin.confidence);
  });
  test("a finish lettered in the space is used", async () => {
    const { doc } = await suiteRun({ doc: blank({ conditions: [...blank().conditions, cond("c4", "CT-1")] }), spans: [...SUITE_SPANS, t("CT-1", 530, 300, 32)] });
    const bath = doc.shapes.find((s) => s.label === "201 BATH");
    expect(bath.condition_id).toBe("c4");
    expect(bath.origin.auto).toMatchObject({ from: "tag" });
  });
  test("removing the suite's proposal removes the spaces found inside it", async () => {
    const { doc } = await suiteRun();
    expect(removeProposals(doc, [floorOf(doc, "201").id]).shapes.some((s) => s.label === "201 BATH")).toBe(false);
  });
  test("a space already measured is left alone", async () => {
    const first = await suiteRun();
    const again = await suiteRun({ doc: first.doc });
    expect(again.report.inside.rooms).toBe(0);
    expect(again.doc.shapes.length).toBe(first.doc.shapes.length);
  });
});

describe("transitions where two floor finishes meet", () => {
  test("a strip is proposed across the opening between the suite (LVT-1) and the corridor (CPT-1)", async () => {
    const { doc, report } = await suiteRun();
    const tr = kindOf(doc, "transition");
    expect(tr.length).toBe(1);
    expect(tr[0]).toMatchObject({ measure_role: "linear", condition_id: null, label: "200/201" });
    expect(Math.abs(tr[0].computed.perimeter_lf - 3)).toBeLessThan(0.8);
    expect(tr[0].origin.auto).toMatchObject({ kind: "transition", room: "200/201", name: "CPT-1 to LVT-1", from: "none" });
    expect(tr[0].origin.auto.why).toContain("different floor finishes meet");
    expect(tr[0].origin.auto.between.sort()).toEqual([floorOf(doc, "200").id, floorOf(doc, "201").id].sort());
    expect(report.transitions).toMatchObject({ count: 1 });
    expect(tr[0].verts_norm.length).toBe(2);
    for (const [, y] of tr[0].verts_norm) expect(Math.abs(y * DIMS.h - 400)).toBeLessThan(3);   // on the wall line between them
  });
  test("none where one side's finish is not known (the bathroom), or both sides are the same finish", async () => {
    const same = await suiteRun({ schedule: { reader: "BMD", rows: SUITE_SCHEDULE.rows.map((r) => ({ ...r, floor: "LVT-1" })) } });
    expect(kindOf(same.doc, "transition")).toEqual([]);
    expect(same.report.transitions.count).toBe(0);
  });
  test("when the job has exactly one transition finish it is chosen, and says why", async () => {
    const { doc } = await suiteRun({ doc: blank({ conditions: [...blank().conditions, cond("c5", "TR-1")] }) });
    const tr = kindOf(doc, "transition")[0];
    expect(tr.condition_id).toBe("c5");
    expect(tr.origin.auto).toMatchObject({ from: "job" });
    expect(tr.origin.auto.why).toContain("TR-1 is the only transition on this job");
  });
  test("it is one item in the review list, in LF, and goes when either room's proposal is removed", async () => {
    const { doc } = await suiteRun();
    const items = reviewList(doc, []).flatMap((s) => s.groups.flatMap((g) => g.items));
    expect(items.find((i) => i.kind === "transition")).toMatchObject({ unit: "LF", room: "200/201", name: "CPT-1 to LVT-1" });
    expect(items.find((i) => i.kind === "inside")).toMatchObject({ unit: "SF", room: "201", name: "BATH" });
    expect(kindOf(removeProposals(doc, [floorOf(doc, "200").id]), "transition")).toEqual([]);
  });
  test("the run's summary says what was found inside rooms and where finishes meet", async () => {
    const { report } = await suiteRun();
    const lines = runSummary([report]).join(" ");
    expect(lines).toContain("1 space inside a tagged room was found by its name");
    expect(lines).toContain("1 opening where two floor finishes meet");
  });
});

describe("base is measured for every room and broken out by area", () => {
  test("which area a room belongs to", () => {
    expect(["SUITE TYPE A", "UNIT 4", "GUEST ROOM", "APT B"].map((n) => areaGroup(n))).toEqual(["suite", "suite", "suite", "suite"]);
    expect(["W/C", "STAFF WASHROOM", "BATH", "ENSUITE", "UNIVERSAL W.C.", "SHOWER"].map((n) => areaGroup(n))).toEqual(Array(6).fill("washroom"));
    expect(["CORRIDOR", "LOBBY", "KITCHEN", "STORAGE", "", "BATHHOUSE OFFICE"].map((n) => areaGroup(n))).toEqual(Array(6).fill("common"));
    expect(areaGroup("BEDROOM", "SUITE TYPE A")).toBe("suite");     // a space inside a suite
    expect(areaGroup("CLOSET", "CORRIDOR")).toBe("common");
    expect(areaGroup("BATH", "SUITE TYPE A")).toBe("washroom");     // a washroom is a washroom wherever it is
  });
  test("the bathroom inside the suite gets base too, with no finish assumed; the suite and corridor keep the schedule's", async () => {
    const { doc, report } = await suiteRun();
    const bath = doc.shapes.find((s) => s.label === "201 BATH");
    const b = doc.shapes.filter((s) => s.origin?.auto?.kind === "base" && s.origin.auto.of === bath.id);
    expect(b.length).toBeGreaterThan(0);
    expect(b[0]).toMatchObject({ measure_role: "linear", condition_id: null, label: "201 BATH" });
    expect(b[0].origin.auto).toMatchObject({ group: "washroom", from: "none", room: "201", name: "BATH" });
    expect(baseOf(doc, "200")[0].origin.auto).toMatchObject({ group: "common", from: "schedule" });
    expect(doc.shapes.find((s) => s.origin?.auto?.kind === "base" && s.origin.auto.of === floorOf(doc, "201").id).origin.auto).toMatchObject({ group: "suite", from: "schedule" });
    expect(report.base.rooms).toBe(3);
    expect(report.base.byGroup.washroom).toBeGreaterThan(30);
  });
  test("a bedroom inside a suite takes the suite's base", async () => {
    const { doc } = await suiteRun({ spans: SUITE_SPANS.map((s) => (s.str === "BATH" ? { ...s, str: "BEDROOM" } : s)) });
    const bed = doc.shapes.find((s) => s.label === "201 BEDROOM");
    const b = doc.shapes.find((s) => s.origin?.auto?.kind === "base" && s.origin.auto.of === bed.id);
    expect(b.condition_id).toBe("c2");
    expect(b.origin.auto).toMatchObject({ group: "suite", from: "schedule" });
    expect(b.origin.auto.why).toContain("201 SUITE");
  });
  test("the base by area: suites, common areas and washrooms, proposed and accepted", async () => {
    const { doc } = await suiteRun();
    const g = baseByGroup(doc);
    expect(g.map((x) => [x.group, x.label, x.rooms])).toEqual([["suite", "Suites", 1], ["common", "Common areas", 1], ["washroom", "Washrooms", 1]]);
    for (const x of g) { expect(x.proposedLf).toBeGreaterThan(30); expect(x.acceptedLf).toBe(0); expect(x.ids.length).toBeGreaterThan(0); }
    expect(g[2].needFinish).toBe(g[2].ids.length);
    expect(g[0].needFinish).toBe(0);
    const total = doc.shapes.filter((s) => s.origin?.auto?.kind === "base").reduce((n, s) => n + s.computed.perimeter_lf, 0);
    expect(g.reduce((n, x) => n + x.proposedLf, 0)).toBeCloseTo(total, 0);
    // accept the suites and common areas, leave the washrooms out
    const next = acceptProposals(doc, [...g[0].ids, ...g[1].ids]).doc;
    const after = baseByGroup(next);
    expect(after[0]).toMatchObject({ proposedLf: 0, rooms: 0 });
    expect(after[0].acceptedLf).toBeCloseTo(g[0].proposedLf, 1);
    expect(after[2].proposedLf).toBeCloseTo(g[2].proposedLf, 1);
    expect(takeoffQuantities(next).rows.reduce((n, r) => n + r.lf, 0)).toBeCloseTo(g[0].proposedLf + g[1].proposedLf, 0);
  });
  test("base proposed before areas were recorded is sorted by its room's name", () => {
    const old = (name) => ({ id: name, sheet_id: "s", condition_id: "c2", measure_role: "linear", computed: { perimeter_lf: 10 }, origin: { method: METHOD, reviewed: false, auto: { kind: "base", of: `f-${name}`, room: "1", name } } });
    expect(baseByGroup({ conditions: [], shapes: [old("SUITE TYPE B"), old("W/C"), old("LOBBY")] }).map((x) => x.proposedLf)).toEqual([10, 10, 10]);
  });
  test("the summary breaks the base out", async () => {
    const { report } = await suiteRun();
    expect(runSummary([report]).join(" ")).toMatch(/base by area: suites [\d.,]+ LF, common areas [\d.,]+ LF, washrooms [\d.,]+ LF/);
  });
});

describe("accepting the base for the ticked areas in one step", () => {
  test("with a finish chosen, every line takes it; without one, lines with no finish are left and counted", async () => {
    const { doc } = await suiteRun();
    const wash = baseByGroup(doc)[2];
    const none = acceptBase(doc, wash.ids, null);
    expect(none).toMatchObject({ accepted: 0, needFinish: wash.ids.length });
    expect(none.doc).toBe(doc);
    const all = baseByGroup(doc).flatMap((g) => g.ids);
    const out = acceptBase(doc, all, "c2");
    expect(out).toMatchObject({ accepted: all.length, needFinish: 0 });
    expect(out.doc.shapes.filter((s) => all.includes(s.id)).every((s) => s.condition_id === "c2" && s.origin.reviewed === true)).toBe(true);
    expect(baseByGroup(out.doc).map((g) => g.proposedLf)).toEqual([0, 0, 0]);
    expect(baseByGroup(out.doc)[2].acceptedLf).toBeCloseTo(wash.proposedLf, 1);
  });
});
