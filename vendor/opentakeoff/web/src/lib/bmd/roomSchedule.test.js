import { describe, expect, test } from "bun:test";
import { cellFinish, matchFinish, readRoomSchedule, sameRoomName, scheduleRowFor } from "./roomSchedule.js";

const t = (str, x, y, h = 24, w = str.length * 11) => ({ str, x, y, w, h });
// A schedule as Revit prints it: two header lines, the room number and name under one "Room" heading.
function table(x, lines) {
  const out = [
    t("Room", x + 6, 216), t("Approx.", x + 316, 216), t("Floor", x + 420, 216), t("Base", x + 516, 216), t("N. WALL", x + 614, 216), t("N. WALL", x + 736, 216),
    t("#", x + 31, 240), t("Room Type", x + 129, 240), t("Area", x + 347, 240), t("Finish", x + 416, 240), t("Finish", x + 511, 240), t("MATERIAL", x + 602, 240), t("FINISH", x + 744, 240),
  ];
  lines.forEach(([no, name, area, floor, base], i) => {
    const y = 272 + i * 32;
    out.push(t(no, x, y), t(name, x + 86, y), t(area, x + 337, y), t(floor, x + 422, y), t(base, x + 521, y), t("GWB", x + 638, y), t("PT", x + 771, y));
  });
  return out;
}

describe("readRoomSchedule", () => {
  const left = table(319, [["000", "PATIO", "1043 SF", "CONC.", "N/A"], ["1", "CORRIDOR", "839 SF", "CPT", "RWB"], ["101", "SUITE TYPE D", "900 SF", "LVT 2", "WD"], ["276", "ELEVATOR", "122 SF", "LVT 1", "MANUF."]]);
  const right = table(2419, [["220", "SUITE TYPE B", "622 SF", "LVT 2", "WD"], ["230", "EXIT STAIRS 3", "191 SF", "LVT 1", "RWB"]]);
  test("each room's floor finish, base finish and printed area", () => {
    const { rows, tables } = readRoomSchedule(left);
    expect(tables).toBe(1);
    expect(rows).toEqual([
      { number: "000", name: "PATIO", floor: "CONC", base: "", areaSf: 1043 },
      { number: "1", name: "CORRIDOR", floor: "CPT", base: "RWB", areaSf: 839 },
      { number: "101", name: "SUITE TYPE D", floor: "LVT 2", base: "WD", areaSf: 900 },
      { number: "276", name: "ELEVATOR", floor: "LVT 1", base: "", areaSf: 122 },
    ]);
  });
  test("two tables side by side are both read, and neither takes the other's cells", () => {
    const { rows, tables } = readRoomSchedule([...left, ...right]);
    expect(tables).toBe(2);
    expect(rows.length).toBe(6);
    expect(rows.find((r) => r.number === "220")).toEqual({ number: "220", name: "SUITE TYPE B", floor: "LVT 2", base: "WD", areaSf: 622 });
    expect(rows.find((r) => r.number === "1").floor).toBe("CPT");
  });
  test("notes beside the table and a comment on its own line make no rows", () => {
    const extra = [t("HANDRAIL, VWC ABOVE", 2035, 360), t("DO NOT scale the drawings.", 4569, 416), t("T: 807-737-3858", 4735, 264)];
    expect(readRoomSchedule([...left, ...extra]).rows.length).toBe(4);
  });
  test("a name that runs onto a second line is joined", () => {
    const spans = table(319, [["121", "STAFF W/C &", "104 SF", "LVT 1", "RWB"]]);
    spans.push(t("LOCKERS", 405, 296));
    expect(readRoomSchedule(spans).rows[0].name).toBe("STAFF W/C & LOCKERS");
  });
  test("a sheet with no room finish schedule reads as nothing", () => {
    expect(readRoomSchedule([t("DOOR SCHEDULE", 100, 100), t("Floor", 300, 300), t("101", 100, 340)])).toEqual({ rows: [], tables: 0 });
    expect(readRoomSchedule([])).toEqual({ rows: [], tables: 0 });
  });
  test("a metric area is not reported as square feet", () => {
    const spans = table(319, [["101", "OFFICE", "12.5 m2", "CPT-1", "RB-1"]]);
    expect(readRoomSchedule(spans).rows[0]).toMatchObject({ floor: "CPT-1", base: "RB-1", areaSf: null });
  });
});

describe("cellFinish", () => {
  test("cells that name no finish", () => {
    for (const s of ["N/A", "-", "", "MANUF.", "n/a", "EXISTING", "NIC"]) expect(cellFinish(s)).toBe("");
    expect(cellFinish("PORC.")).toBe("PORC");
    expect(cellFinish(" LVT  2 ")).toBe("LVT 2");
  });
});

describe("scheduleRowFor", () => {
  const rows = [
    { number: "4", name: "COAT CLOSET", floor: "PORC", base: "PORC", areaSf: 20 },
    { number: "4", name: "CORRIDOR", floor: "CPT", base: "RWB", areaSf: 496 },
    { number: "116", name: "HEALTH SERVICES RM", floor: "LVT 1", base: "RWB", areaSf: 294 },
    { number: "9", name: "A", floor: "X", base: "", areaSf: null },
    { number: "9", name: "B", floor: "Y", base: "", areaSf: null },
  ];
  test("a number listed once is that row, whatever the plan calls the room", () => {
    expect(scheduleRowFor(rows, { number: "116", name: "SERVICES RM" }).row.floor).toBe("LVT 1");
  });
  test("a number listed twice is settled by the name", () => {
    expect(scheduleRowFor(rows, { number: "4", name: "CORRIDOR" }).row.floor).toBe("CPT");
    expect(scheduleRowFor(rows, { number: "4", name: "COAT CLOSET" }).row.floor).toBe("PORC");
  });
  test("when the name does not settle it there is no answer, and the reason says so", () => {
    const r = scheduleRowFor(rows, { number: "9", name: "LOBBY" });
    expect(r.row).toBeNull();
    expect(r.why).toContain("2 times");
  });
  test("a room the schedule does not list", () => {
    expect(scheduleRowFor(rows, { number: "500", name: "X" })).toEqual({ row: null, why: "The room finish schedule has no row for 500." });
  });
  test("names match when one holds all the other's words", () => {
    expect(sameRoomName("HEALTH OFFICE", "HEALTH OFFICE 1")).toBe(true);
    expect(sameRoomName("ELEV. LOBBY", "ELEV LOBBY")).toBe(true);
    expect(sameRoomName("KITCHEN", "DINING")).toBe(false);
    expect(sameRoomName("", "DINING")).toBe(false);
  });
});

describe("matchFinish", () => {
  const job = [{ id: "c1", finish_tag: "CPT-1" }, { id: "c2", finish_tag: "LVT-1" }, { id: "c3", finish_tag: "LVT -1" }, { id: "c4", finish_tag: "WD-1" }, { id: "c5", finish_tag: "RB-1" }];
  test("the same tag, punctuation aside", () => {
    expect(matchFinish("LVT 1", job)).toEqual({ how: "exact", conditionId: "c2", tag: "LVT-1" });
    expect(matchFinish("cpt-1", job)).toEqual({ how: "exact", conditionId: "c1", tag: "CPT-1" });
  });
  test("a code with no number means the only finish of that kind on the job", () => {
    expect(matchFinish("CPT", job)).toEqual({ how: "like", conditionId: "c1", tag: "CPT-1" });
    expect(matchFinish("WD", job)).toMatchObject({ how: "like", conditionId: "c4" });
    expect(matchFinish("LVT", job)).toMatchObject({ how: "like", conditionId: "c2" });   // LVT-1 twice over is still one finish
  });
  test("two finishes of that kind: no guess", () => {
    expect(matchFinish("CPT", [...job, { id: "c9", finish_tag: "CPT-2" }])).toEqual({ how: "new", conditionId: null, tag: "CPT" });
  });
  test("a code that is not on the job is kept as written, and nothing like it is guessed", () => {
    expect(matchFinish("LVT 2", job)).toEqual({ how: "new", conditionId: null, tag: "LVT 2" });
    expect(matchFinish("RWB", job)).toEqual({ how: "new", conditionId: null, tag: "RWB" });
    expect(matchFinish("PORC", [])).toEqual({ how: "new", conditionId: null, tag: "PORC" });
  });
});
