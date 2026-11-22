import { describe, expect, test } from "bun:test";
import { pageScore, selectPages } from "./pages";

const filler = (n: number) => `SECTION 03 30 00 CAST-IN-PLACE CONCRETE. ${"Formwork and reinforcing as specified. ".repeat(n)}`;
const flooring = "SECTION 09 65 19 RESILIENT TILE FLOORING\nLVT-1: luxury vinyl tile, colour as scheduled. Rubber base RB-1 at all resilient flooring.";
const schedule = "ROOM FINISH SCHEDULE\n101 SUITE  FLOOR LVT-1  BASE RB-1\n102 CORRIDOR  FLOOR CPT-1  BASE RB-1";

describe("choosing which pages of a long document to read", () => {
  test("pages about flooring, tile, base, window coverings and finish schedules score; unrelated pages do not", () => {
    expect(pageScore(flooring)).toBeGreaterThan(0);
    expect(pageScore(schedule)).toBeGreaterThan(pageScore(flooring) / 4);
    expect(pageScore("SECTION 12 24 13 ROLLER WINDOW SHADES. Manual roller shades at all suite windows.")).toBeGreaterThan(0);
    expect(pageScore(filler(5))).toBe(0);
    expect(pageScore("The contractor shall tile the roof")).toBeLessThan(pageScore(flooring));
  });
  test("a document that fits is read whole", () => {
    const r = selectPages([filler(2), flooring], 100_000);
    expect(r.pages).toEqual([1, 2]);
    expect(r.cut).toBe(false);
    expect(r.text).toContain("[page 1]");
    expect(r.text).toContain("LVT-1");
  });
  test("in a long document the flooring pages are found wherever they are, not just the first pages", () => {
    const pages = [...Array.from({ length: 300 }, () => filler(40)), flooring, schedule, ...Array.from({ length: 50 }, () => filler(40))];
    const r = selectPages(pages, 20_000);
    expect(r.pages).toContain(301);
    expect(r.pages).toContain(302);
    expect(r.text).toContain("[page 301]");
    expect(r.text).toContain("ROOM FINISH SCHEDULE");
    expect(r.text.length).toBeLessThanOrEqual(20_000);
    expect(r.cut).toBe(true);
    expect(r.relevant).toBe(2);
    expect(r.total).toBe(352);
  });
  test("when more pages are relevant than fit, the strongest are kept and returned in page order", () => {
    const weak = "Protect resilient flooring during construction.";
    const pages = [weak.padEnd(900, " x"), schedule.padEnd(900, " x"), weak.padEnd(900, " x"), flooring.padEnd(900, " x")];
    const r = selectPages(pages, 2_000);
    expect(r.pages).toEqual([2, 4]);
    expect(r.leftOut).toBe(2);
  });
  test("a single page longer than the allowance is cut rather than dropped", () => {
    const r = selectPages([`${schedule}\n${"101 FLOOR LVT-1 ".repeat(2000)}`], 5_000);
    expect(r.pages).toEqual([1]);
    expect(r.text.length).toBeLessThanOrEqual(5_000);
    expect(r.cut).toBe(true);
  });
  test("when nothing in a long document mentions flooring, the first pages are read and that is reported", () => {
    const r = selectPages(Array.from({ length: 50 }, () => filler(40)), 5_000);
    expect(r.relevant).toBe(0);
    expect(r.pages[0]).toBe(1);
    expect(r.cut).toBe(true);
  });
  test("blank pages (scans) are ignored", () => {
    expect(selectPages(["", "  ", flooring], 10_000).pages).toEqual([3]);
    expect(selectPages(["", ""], 10_000)).toMatchObject({ pages: [], text: "", total: 2 });
  });
});
