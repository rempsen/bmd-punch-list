import { describe, expect, test } from "bun:test";
import { passwordProblem } from "./password";

describe("choosing a new password", () => {
  test("a long enough password typed the same twice is accepted", () => {
    expect(passwordProblem("river-otter-42-maple", "river-otter-42-maple")).toBeNull();
  });
  test("too short, mismatched, or the old temporary one is refused with the reason", () => {
    expect(passwordProblem("short1", "short1")).toMatch(/at least 10/);
    expect(passwordProblem("river-otter-42-maple", "river-otter-42-mapel")).toMatch(/do not match/);
    expect(passwordProblem("Pass123!xx", "Pass123!xx")).toBeNull();
    expect(passwordProblem("Pass123!", "Pass123!")).toMatch(/at least 10/);
    expect(passwordProblem("          ", "          ")).toMatch(/at least 10/);
  });
});
