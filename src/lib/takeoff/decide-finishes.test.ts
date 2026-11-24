import { describe, expect, it } from "bun:test";
import { allowedFinishes, buildDecideRequest, cleanDecideInput, parseDecisions } from "./decide-finishes";

const input = cleanDecideInput({
  rooms: [{ id: "shp-1", number: "128", name: "RM", texts: ["RM", "128", "DW"] }, { id: "shp-2", number: "136", name: "PARKING", texts: [] }],
  finishes: ["CPT-1", "LVT-1"],
  schedule: [{ number: "126", name: "DINING", floor: "LVT 1", base: "RWB" }, { number: "135", name: "VESTIBULE", floor: "PORC", base: "PORC" }],
});

describe("the takeoff's AI helper: which finish does a room get", () => {
  it("accepts only the expected shape, and trims what it is given", () => {
    expect(input.rooms[0]).toEqual({ id: "shp-1", number: "128", name: "RM", texts: ["RM", "128", "DW"] });
    for (const bad of [null, {}, { rooms: [], finishes: [] }, { rooms: [{ number: "1" }], finishes: [] }, { rooms: "x", finishes: [] }, { rooms: Array.from({ length: 201 }, (_, i) => ({ id: `r${i}` })), finishes: [] }]) {
      expect(() => cleanDecideInput(bad)).toThrow("Invalid request");
    }
    const long = cleanDecideInput({ rooms: [{ id: "a", name: "x".repeat(500), texts: Array.from({ length: 80 }, () => "y".repeat(200)) }], finishes: [] });
    expect(long.rooms[0]!.name.length).toBe(80);
    expect(long.rooms[0]!.texts.length).toBe(30);
    expect(long.rooms[0]!.texts[0]!.length).toBe(60);
  });
  it("lets an answer name the job's finishes and the schedule's codes, each once", () => {
    expect(allowedFinishes(input)).toEqual(["CPT-1", "LVT-1", "PORC"]);   // "LVT 1" in the schedule is LVT-1 on the job
  });
  it("sends text only: the rooms, the schedule and the allowed finishes", () => {
    const req = buildDecideRequest(input);
    expect(req.system).toContain("Never invent a finish");
    expect(req.prompt).toContain("ALLOWED FINISHES:\nCPT-1\nLVT-1\nPORC");
    expect(req.prompt).toContain("126 | DINING | LVT 1 | RWB");
    expect(req.prompt).toContain('{"id":"shp-1","number":"128","name":"RM","lettered_inside":["RM","128","DW"]}');
    expect(req.prompt).not.toMatch(/data:image|base64/);
    expect(buildDecideRequest({ ...input, schedule: [] }).prompt).toContain("ROOM FINISH SCHEDULE: none could be read.");
  });
  it("keeps only answers for rooms that were asked about, naming an allowed finish", () => {
    const reply = 'Here you go:\n```json\n[{"id":"shp-1","tag":"lvt 1","reason":"Room 128 opens off the dining room, which the schedule gives LVT 1."},{"id":"shp-2","tag":"EPOXY-9","reason":"guess"},{"id":"shp-9","tag":"CPT-1","reason":"not asked"},{"id":"shp-1","tag":"CPT-1","reason":"twice"},{"id":"shp-2","tag":null,"reason":"not enough to go on"}]\n```';
    expect(parseDecisions(reply, input)).toEqual([{ id: "shp-1", tag: "LVT-1", reason: "Room 128 opens off the dining room, which the schedule gives LVT 1." }]);
  });
  it("a reply that is not the JSON asked for gives no answers", () => {
    expect(parseDecisions("I could not decide.", input)).toEqual([]);
    expect(parseDecisions("[not json]", input)).toEqual([]);
    expect(parseDecisions('{"id":"shp-1","tag":"CPT-1"}', input)).toEqual([]);
  });
});
