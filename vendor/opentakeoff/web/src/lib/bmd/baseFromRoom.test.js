import { describe, expect, test } from "bun:test";
import { baseRuns, ringLength } from "./baseFromRoom.js";

// A 20 ft × 10 ft room drawn at 10 pixels to the foot, corner at (100, 100).
const UPP = 0.1;
const room = [[100, 100], [300, 100], [300, 200], [100, 200]];
const lineLf = (line) => line.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0) * UPP;
// walls everywhere except the given openings: [x0, x1] along the top wall (y = 100), [y0, y1] down the right wall
const walls = ({ top = [], right = [], swing = [] } = {}) => (x, y) => {
  if (Math.abs(y - 100) < 0.5 && top.some(([a, b]) => x > a && x < b)) return "open";
  if (Math.abs(y - 100) < 0.5 && swing.some(([a, b]) => x > a && x < b)) return "swing";
  if (Math.abs(x - 300) < 0.5 && right.some(([a, b]) => y > a && y < b)) return "open";
  return "wall";
};

describe("baseRuns", () => {
  test("a room with no openings: base all the way round", () => {
    const b = baseRuns(room, UPP, walls());
    expect(b).toMatchObject({ lengthLf: 60, perimeterLf: 60, openings: 0, openingsLf: 0, deducted: true });
    expect(b.runs.length).toBe(1);
    expect(lineLf(b.runs[0])).toBeCloseTo(60, 1);
  });
  test("a 3 ft door opening is left out", () => {
    const b = baseRuns(room, UPP, walls({ top: [[150, 180]] }));
    expect(b.openings).toBe(1);
    expect(b.openingsLf).toBeGreaterThan(2.5);
    expect(b.openingsLf).toBeLessThan(3.5);
    expect(b.lengthLf + b.openingsLf).toBeCloseTo(60, 1);
    expect(b.runs.length).toBe(1);   // one line of base, from one side of the door round to the other
    expect(lineLf(b.runs[0])).toBeCloseTo(b.lengthLf, 0);
    const [first, last] = [b.runs[0][0], b.runs[0][b.runs[0].length - 1]];
    expect(first[1]).toBe(100);      // it starts and ends on the wall with the door
    expect(last[1]).toBe(100);
    expect(Math.abs(first[0] - last[0])).toBeGreaterThan(25);
  });
  test("two openings on different walls: two lines of base", () => {
    const b = baseRuns(room, UPP, walls({ top: [[150, 180]], right: [[130, 170]] }));
    expect(b.openings).toBe(2);
    expect(b.runs.length).toBe(2);
    expect(Math.abs(b.lengthLf - (60 - 3 - 4))).toBeLessThan(0.8);
    expect(b.runs.reduce((n, r) => n + lineLf(r), 0)).toBeCloseTo(b.lengthLf, 0);
  });
  test("an outline that follows a door's swing arc is an opening too", () => {
    const b = baseRuns(room, UPP, walls({ swing: [[150, 185]] }));
    expect(b.openings).toBe(1);
    expect(b.lengthLf).toBeLessThan(57.5);
  });
  test("a gap shorter than a door is a drafting break and stays wall", () => {
    const b = baseRuns(room, UPP, walls({ top: [[150, 160]] }));
    expect(b).toMatchObject({ openings: 0, lengthLf: 60, deducted: true });
  });
  test("a door frame drawn inside an opening does not split it in two", () => {
    const b = baseRuns(room, UPP, walls({ top: [[150, 172], [175, 200]] }));
    expect(b.openings).toBe(1);
    expect(b.openingsLf).toBeCloseTo(5, 0);
  });
  test("when openings cannot be told the whole outline is returned and marked", () => {
    const b = baseRuns(room, UPP, null);
    expect(b).toMatchObject({ lengthLf: 60, openings: 0, deducted: false });
    expect(b.runs[0][0]).toEqual(b.runs[0][b.runs[0].length - 1]);   // closed
    expect(lineLf(b.runs[0])).toBeCloseTo(60, 5);
  });
  test("a space with no walls at all has no base", () => {
    expect(baseRuns(room, UPP, () => "open")).toMatchObject({ runs: [], lengthLf: 0, openings: 1, deducted: true });
  });
  test("no outline or no scale: nothing", () => {
    expect(baseRuns([[0, 0], [1, 1]], UPP, walls()).lengthLf).toBe(0);
    expect(baseRuns(room, 0, walls()).runs).toEqual([]);
    expect(ringLength(room)).toBe(600);
  });
});
