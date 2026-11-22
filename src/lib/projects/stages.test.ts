import { describe, expect, test } from "bun:test";
import { STAGES, daysInStage, formatProjectNumber, isOverdue, stageLabel, validateMove } from "./stages";

describe("stages", () => {
  test("pipeline order is opportunity through closed, with lost last", () => {
    expect(STAGES.map((s) => s.value)).toEqual(["opportunity", "estimating", "quote_out", "won", "in_progress", "closed", "lost"]);
  });
  test("labels read as the board column names", () => {
    expect(stageLabel("quote_out")).toBe("Quote out");
    expect(stageLabel("in_progress")).toBe("In progress");
  });
});

describe("validateMove", () => {
  test("moving to lost without a reason is refused", () => {
    expect(validateMove("lost", null)).toBe("Choose a reason for marking this project lost");
  });
  test("moving to lost with an unknown reason is refused", () => {
    expect(validateMove("lost", "because")).toBe("Choose a reason for marking this project lost");
  });
  test("moving to lost with a listed reason is allowed", () => {
    expect(validateMove("lost", "price")).toBeNull();
  });
  test("other stages need no reason", () => {
    expect(validateMove("won", null)).toBeNull();
  });
});

describe("formatProjectNumber", () => {
  test("two-digit year and three-digit sequence", () => {
    expect(formatProjectNumber(2026, 1)).toBe("26-001");
    expect(formatProjectNumber(2026, 41)).toBe("26-041");
  });
  test("sequence past 999 keeps all digits", () => {
    expect(formatProjectNumber(2027, 1204)).toBe("27-1204");
  });
});

describe("daysInStage", () => {
  test("counts whole days since the stage was entered", () => {
    expect(daysInStage("2026-11-01T15:00:00Z", new Date("2026-11-22T16:00:00Z"))).toBe(21);
  });
  test("never negative", () => {
    expect(daysInStage("2026-11-23T00:00:00Z", new Date("2026-11-22T00:00:00Z"))).toBe(0);
  });
});

describe("isOverdue", () => {
  const today = new Date("2026-11-22T18:00:00Z");
  test("a due date before today is overdue while the bid is still open", () => {
    expect(isOverdue("2026-11-21", "estimating", today)).toBe(true);
  });
  test("due today is not overdue", () => {
    expect(isOverdue("2026-11-22", "estimating", today)).toBe(false);
  });
  test("once the quote is out the bid date no longer counts", () => {
    expect(isOverdue("2026-11-01", "quote_out", today)).toBe(false);
  });
  test("no due date is never overdue", () => {
    expect(isOverdue(null, "opportunity", today)).toBe(false);
  });
});
