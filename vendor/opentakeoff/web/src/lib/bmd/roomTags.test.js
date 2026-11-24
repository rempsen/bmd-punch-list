import { describe, expect, test } from "bun:test";
import { findRoomNames, findRoomTags, finishTagsInRoom, ringHoldsTag, roomKey, seedPoints } from "./roomTags.js";

// text as OpenTakeoff's page spans: top-left x, y and a width and height in image pixels
const t = (str, x, y, h = 13, w = str.length * h * 0.6, rot) => ({ str, x, y, w, h, ...(rot ? { rot } : {}) });
const tag = (name, number, x, y) => [t(name, x - (name.length * 7.8) / 2 + 11, y - 20), t(number, x, y, 13, 22)];

describe("findRoomTags", () => {
  test("a number with a name written above it is a room", () => {
    const tags = findRoomTags([...tag("SUITE TYPE A", "142", 3711, 1919), ...tag("KITCHEN", "124", 2349, 1053)]);
    expect(tags.map((x) => [x.number, x.name, x.by])).toEqual([["142", "SUITE TYPE A", "name"], ["124", "KITCHEN", "name"]]);
    expect(tags[0].box).toEqual({ x0: 3711, y0: 1919, x1: 3733, y1: 1932 });
    expect(tags[0].nameBox.y1).toBeLessThanOrEqual(tags[0].box.y0);
  });
  test("a single digit is a room when it carries a name (CORRIDOR 6)", () => {
    const tags = findRoomTags([t("CORRIDOR", 2199, 1054, 13, 70), t("6", 2230, 1074, 13, 7)]);
    expect(tags.map((x) => [x.number, x.name])).toEqual([["6", "CORRIDOR"]]);
  });
  test("numbers with no name are not rooms: grid bubbles, door numbers, dimensions", () => {
    const spans = [t("12", 2968, 492, 36, 40), t("2160", 2284, 1574, 16, 28), t("530", 4411, 1362, 21, 16), t("D119", 2314, 1618, 16, 31, 270)];
    expect(findRoomTags(spans)).toEqual([]);
  });
  test("a bare number is a room when the schedule lists it and it is lettered like the named tags", () => {
    const spans = [...tag("LOUNGE", "129", 2441, 1543), t("100", 352, 1720, 13, 22), t("120", 2071, 1394, 13, 22), t("530", 4411, 1362, 21, 16)];
    const tags = findRoomTags(spans, { scheduleNumbers: new Set(["100", "129", "530"]) });
    expect(tags.map((x) => [x.number, x.by])).toEqual([["129", "name+schedule"], ["100", "schedule"]]);   // 120 is not in the schedule; 530 is lettered larger
  });
  test("a name, a short number and the room number in a stack: the short number belongs to the name", () => {
    const tags = findRoomTags([t("HEALTH OFFICE", 2060, 1760, 13, 95), t("1", 2107, 1779, 13, 7), t("112", 2100, 1798, 13, 22)]);
    expect(tags.map((x) => [x.number, x.name])).toEqual([["112", "HEALTH OFFICE 1"]]);
    expect(tags[0].box.y0).toBe(1798);
  });
  test("a door tag or a dimension under a name is not a room number, unless the schedule lists it", () => {
    const spans = [t("BATH TYPE C", 600, 700, 13, 80), t("D6", 630, 720, 13, 17), t("BATH TYPE A", 900, 700, 13, 80), t("2794", 925, 720, 13, 28)];
    expect(findRoomTags(spans)).toEqual([]);
    expect(findRoomTags(spans, { scheduleNumbers: new Set(["D6"]) }).map((x) => x.number)).toEqual(["D6"]);
  });
  test("a name much larger or smaller than the number is not its name", () => {
    expect(findRoomTags([t("MAIN FLOOR PLAN", 300, 100, 36, 400), t("104", 480, 140, 13, 22)])).toEqual([]);
  });
  test("mixed-case text and table words are not room names", () => {
    expect(findRoomTags([t("Fax", 100, 100, 13, 22), t("204", 100, 118, 13, 22)])).toEqual([]);
    expect(findRoomTags([t("ROOM", 100, 100, 13, 40), t("204", 105, 118, 13, 22)])).toEqual([]);
  });
  test("a two-line name is joined", () => {
    const tags = findRoomTags([t("STAFF W/C &", 2130, 1210, 13, 80), t("LOCKERS", 2145, 1230, 13, 55), t("121", 2160, 1250, 13, 22)]);
    expect(tags[0].name).toBe("STAFF W/C & LOCKERS");
    expect(tags[0].nameBox.y0).toBe(1210);
  });
  test("text outside the drawing's bounds is left out, and text drawn twice counts once", () => {
    const spans = [...tag("OFFICE", "101", 500, 500), ...tag("OFFICE", "101", 500, 500), ...tag("LOBBY", "100", 50, 50)];
    const tags = findRoomTags(spans, { bounds: { x0: 100, y0: 100, x1: 900, y1: 900 } });
    expect(tags.map((x) => x.number)).toEqual(["101"]);
  });
  test("room numbers compare without case or spaces", () => {
    expect(roomKey(" 134a ")).toBe("134A");
  });
});

describe("seedPoints and ringHoldsTag", () => {
  const [room] = findRoomTags(tag("OFFICE", "101", 500, 500));
  test("the first try is on the number; the others stand clear of the tag", () => {
    const pts = seedPoints(room);
    expect(pts[0]).toEqual([511, 506.5]);
    expect(pts[1][1]).toBeGreaterThan(room.box.y1);
    expect(pts[2][1]).toBeLessThan(room.nameBox.y0);
    expect(pts[3][0]).toBeLessThan(room.nameBox.x0);
    expect(pts[4][0]).toBeGreaterThan(room.nameBox.x1);
  });
  test("an outline holds a tag when the number or the name is inside it", () => {
    expect(ringHoldsTag([[400, 400], [700, 400], [700, 700], [400, 700]], room)).toBe(true);
    expect(ringHoldsTag([[400, 400], [700, 400], [700, 495], [400, 495]], room)).toBe(true);   // the name only
    expect(ringHoldsTag([[800, 400], [900, 400], [900, 700], [800, 700]], room)).toBe(false);
  });
});

describe("finishTagsInRoom", () => {
  const ring = [[0, 0], [400, 0], [400, 300], [0, 300]];
  test("known finish tags lettered inside the outline are found, however they are punctuated", () => {
    const spans = [t("CPT 1", 100, 100), t("RB-1", 100, 130), t("LVT-1", 900, 100), t("SEE CPT-1 NOTE", 50, 200)];
    expect(finishTagsInRoom(spans, ring, ["CPT-1", "RB-1", "LVT-1"])).toEqual(["CPT-1", "RB-1"]);
  });
  test("nothing is found when no known tag is inside", () => {
    expect(finishTagsInRoom([t("OFFICE", 100, 100)], ring, ["CPT-1"])).toEqual([]);
    expect(finishTagsInRoom([t("CPT-1", 100, 100)], ring, [])).toEqual([]);
  });
});

describe("findRoomNames (spaces with a name and no number)", () => {
  const sp = (str, x, y, w = str.length * 8, h = 13) => ({ str, x, y, w, h });
  test("bedrooms, bathrooms and closets are found; notes, tag names and lower-case text are not", () => {
    const spans = [sp("BEDROOM 2", 100, 100), sp("W/C", 300, 100), sp("CL.", 400, 100), sp("MASTER BEDROOM", 500, 100), sp("EXISTING", 100, 200), sp("Bath", 200, 200), sp("SEE DETAIL 4", 300, 200), sp("KITCHEN", 600, 300), sp("KITCHEN", 601, 301)];
    const tags = [{ number: "101", nameBox: { x0: 590, y0: 295, x1: 670, y1: 320 }, box: { x0: 610, y0: 325, x1: 640, y1: 340 } }];
    expect(findRoomNames(spans, { tags }).map((n) => n.name)).toEqual(["BEDROOM 2", "W/C", "CL.", "MASTER BEDROOM"]);
  });
  test("names in the border are left out", () => {
    expect(findRoomNames([sp("STORAGE", 5, 5)], { bounds: { x0: 50, y0: 50, x1: 900, y1: 900 } })).toEqual([]);
  });
});
