import { describe, expect, test } from "bun:test";
import { addWorkdays, DEFAULT_CALENDAR, holidayName, isWorkday, nextWorkday, onOrAfterWorkday, readCalendar, workdaysBetween, type WorkCalendar } from "./workdays";

// Nov 2026: the 23rd is a Monday, the 28th a Saturday.
const cal: WorkCalendar = { workdays: [1, 2, 3, 4, 5], holidays: [{ day: "2026-12-25", name: "Christmas Day" }, { day: "2026-11-25", name: "Shop closed" }] };

describe("workdays", () => {
  test("Monday to Friday are workdays by default; the weekend is not", () => {
    expect(isWorkday("2026-11-23", DEFAULT_CALENDAR)).toBe(true);
    expect(isWorkday("2026-11-27", DEFAULT_CALENDAR)).toBe(true);
    expect(isWorkday("2026-11-28", DEFAULT_CALENDAR)).toBe(false);
    expect(isWorkday("2026-11-29", DEFAULT_CALENDAR)).toBe(false);
  });
  test("a holiday is not a workday, and has a name", () => {
    expect(isWorkday("2026-11-25", cal)).toBe(false);
    expect(holidayName("2026-11-25", cal)).toBe("Shop closed");
    expect(holidayName("2026-11-24", cal)).toBeNull();
  });
  test("a company that works Saturdays", () => {
    expect(isWorkday("2026-11-28", { workdays: [1, 2, 3, 4, 5, 6], holidays: [] })).toBe(true);
  });
  test("the next workday skips the weekend and holidays", () => {
    expect(nextWorkday("2026-11-27", cal)).toBe("2026-11-30"); // Friday → Monday
    expect(nextWorkday("2026-11-24", cal)).toBe("2026-11-26"); // Tuesday → Thursday (Wednesday closed)
    expect(nextWorkday("2026-12-24", cal)).toBe("2026-12-28"); // Thursday → Monday (Christmas, then weekend)
  });
  test("a day that is already a workday stays; a non-workday moves to the next one", () => {
    expect(onOrAfterWorkday("2026-11-23", cal)).toBe("2026-11-23");
    expect(onOrAfterWorkday("2026-11-28", cal)).toBe("2026-11-30");
  });
  test("adding workdays forwards and backwards", () => {
    expect(addWorkdays("2026-11-23", 0, cal)).toBe("2026-11-23");
    expect(addWorkdays("2026-11-23", 2, cal)).toBe("2026-11-26"); // Mon +2 skips closed Wednesday
    expect(addWorkdays("2026-11-27", 1, cal)).toBe("2026-11-30");
    expect(addWorkdays("2026-11-30", -1, cal)).toBe("2026-11-27");
    expect(addWorkdays("2026-11-26", -2, cal)).toBe("2026-11-23");
  });
  test("counting workdays between two days", () => {
    expect(workdaysBetween("2026-11-23", "2026-11-23", cal)).toBe(0);
    expect(workdaysBetween("2026-11-23", "2026-11-26", cal)).toBe(2);
    expect(workdaysBetween("2026-11-27", "2026-11-30", cal)).toBe(1);
    expect(workdaysBetween("2026-11-27", "2026-11-28", cal)).toBe(0); // Friday → Saturday: no workday passed
    expect(workdaysBetween("2026-11-30", "2026-11-27", cal)).toBe(-1);
  });
  test("with no workdays ticked, every day counts, so nothing ever loops for ever", () => {
    const none: WorkCalendar = { workdays: [], holidays: [] };
    expect(isWorkday("2026-11-28", none)).toBe(true);
    expect(addWorkdays("2026-11-27", 2, none)).toBe("2026-11-29");
  });
  test("settings read from the database are tidied; anything unreadable falls back to Monday to Friday", () => {
    expect(readCalendar(null)).toEqual(DEFAULT_CALENDAR);
    expect(readCalendar({ workdays: [5, 1, 1, 9, "x"], holidays: [{ day: "2026-12-25", name: " Christmas " }, { day: "nope", name: "bad" }, 3] })).toEqual({
      workdays: [1, 5],
      holidays: [{ day: "2026-12-25", name: "Christmas" }],
    });
  });
});
