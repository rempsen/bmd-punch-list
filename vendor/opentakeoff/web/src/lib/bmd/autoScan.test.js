import { describe, expect, test } from "bun:test";
import { engineScheduleRows, scanSheets, scheduleLine } from "./autoScan.js";

const t = (str, x, y, h = 13, w = str.length * 8) => ({ str, x, y, w, h });
const plan = [t("MAIN FLOOR PLAN -", 400, 3000, 36), t("OFFICE", 480, 480), t("101", 493, 500, 13, 22), t("LOBBY", 880, 480), t("102", 893, 500, 13, 22), t("STORAGE", 1280, 480), t("103", 1293, 500, 13, 22)];
const ceiling = [t("MAIN FLOOR CEILING PLAN", 400, 3000, 36), ...plan.slice(1)];
const schedule = [
  t("Room Finish Schedule", 1211, 168, 25), t("Room", 325, 216, 24, 44), t("Approx.", 635, 216, 24, 60), t("Floor", 739, 216, 24, 42), t("Base", 835, 216, 24, 40), t("N. WALL", 933, 216, 24, 60),
  t("101", 319, 272, 24, 33), t("OFFICE", 405, 272, 24, 66), t("136 SF", 656, 272, 24, 58), t("LVT 1", 741, 272, 24, 50), t("RWB", 839, 272, 24, 38),
];
// OpenTakeoff's sheet graph, stood in for: it titles sheets, and here its own schedule reading comes back jumbled
const graph = (tables = []) => ({
  classifySheetRole: (s) => { const title = s.spans.find((x) => /PLAN|Schedule/.test(x.str)); return title ? { role: /Schedule/.test(title.str) ? "schedule" : "plan", evidence: { text: title.str } } : { role: "unknown", evidence: null }; },
  buildSheetGraph: () => ({ tables }),
});
const SHEETS = [{ key: "a#1", label: "A-100", page: 1, file: "a" }, { key: "a#2", label: "A-109", page: 2, file: "a" }, { key: "a#3", label: "A-800", page: 3, file: "a" }, { key: "a#4", label: null, page: 4, file: "a" }];
const TEXT = { "a#1": plan, "a#2": ceiling, "a#3": schedule, "a#4": [] };

describe("scanSheets", () => {
  test("floor plans with room tags are ticked; ceiling plans, schedules and scans are not, each with its reason", async () => {
    const said = [];
    const out = await scanSheets({ sheets: SHEETS, spansOf: async (s) => TEXT[s.key], graph: graph(), onProgress: (x) => said.push(x) });
    expect(out.rows.map((r) => [r.label, r.ticked, r.why])).toEqual([
      ["A-100", true, "Floor plan with 3 room tags"],
      ["A-109", false, "Main floor ceiling plan: not a floor finish plan"],
      ["A-800", false, "Schedule or legend: read for finishes, not measured"],
      [null, false, "No text on this sheet (a scan): room tags cannot be read"],
    ]);
    expect(out.rows[0].title).toBe("MAIN FLOOR PLAN");
    expect(out.spans.get("a#1")).toBe(plan);
    expect(said[0]).toBe("Reading the sheets… 1 of 4 (A-100)");
    expect(said[3]).toContain("(Page 4)");
  });
  test("the schedule is read wherever it is in the set, by whichever reader read it properly", async () => {
    const jumbled = [{ kind: "room-finish", rows: [{ key: "136SF", cells: { "FLOOR AREA": { text: "136 SF LVT 1 RWB GWB" } } }] }];
    const out = await scanSheets({ sheets: SHEETS, spansOf: async (s) => TEXT[s.key], graph: graph(jumbled) });
    expect(out.schedule).toEqual({ reader: "BMD", sheets: ["A-800"], rows: [{ number: "101", name: "OFFICE", floor: "LVT 1", base: "RWB", areaSf: 136 }] });
    expect(scheduleLine(out.schedule)).toBe("Room finish schedule read on A-800: 1 rooms.");
    const good = [{ kind: "room-finish", rows: [{ key: "101", cells: { NAME: { text: "OFFICE" }, FLOOR: { text: "CPT-1" }, BASE: { text: "N/A" } } }, { key: "102", cells: { FLOOR: { text: "CPT-1" } } }] }, { kind: "finish", rows: [{ key: "CPT-1", cells: {} }] }];
    const two = await scanSheets({ sheets: SHEETS, spansOf: async (s) => TEXT[s.key], graph: graph(good) });
    expect(two.schedule.reader).toBe("OpenTakeoff");
    expect(two.schedule.rows[0]).toEqual({ number: "101", name: "OFFICE", floor: "CPT-1", base: "", areaSf: null });
  });
  test("a sheet whose number is not known yet is read from its title block and named by it", async () => {
    const out = await scanSheets({ sheets: [{ key: "a#3", label: null, page: 3, file: "a" }], spansOf: async (s) => TEXT[s.key], labelOf: async () => "A-800", graph: graph() });
    expect(out.rows[0].label).toBe("A-800");
    expect(out.schedule.sheets).toEqual(["A-800"]);
  });
  test("no schedule anywhere, a sheet whose text cannot be read, and stopping early", async () => {
    const out = await scanSheets({ sheets: SHEETS.slice(0, 2), spansOf: async (s) => { if (s.key === "a#2") throw new Error("broken page"); return TEXT[s.key]; }, graph: graph() });
    expect(out.schedule).toEqual({ rows: [], reader: null, sheets: [] });
    expect(scheduleLine(out.schedule)).toContain("No room finish schedule could be read");
    expect(out.rows[1].ticked).toBe(false);
    let n = 0;
    expect((await scanSheets({ sheets: SHEETS, spansOf: async (s) => TEXT[s.key], graph: graph(), shouldStop: () => n++ >= 1 })).rows.length).toBe(1);
  });
  test("engineScheduleRows ignores tables that are not room finish schedules", () => {
    expect(engineScheduleRows({ tables: [{ kind: "finish", rows: [{ key: "PT-1", cells: {} }] }] })).toEqual([]);
    expect(engineScheduleRows(null)).toEqual([]);
  });
});
