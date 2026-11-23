import { describe, expect, test } from "bun:test";
import { parseFeet } from "./feet.js";

describe("parseFeet", () => {
  test("reads plain feet", () => { expect(parseFeet("12.5")).toBe(12.5); expect(parseFeet("12 ft")).toBe(12); expect(parseFeet("12'")).toBe(12); });
  test("reads feet and inches", () => { expect(parseFeet("12' 6\"")).toBe(12.5); expect(parseFeet("12 ft 6 in")).toBe(12.5); expect(parseFeet("12-6")).toBe(12.5); });
  test("refuses anything else", () => { expect(parseFeet("")).toBeNaN(); expect(parseFeet(null)).toBeNaN(); expect(parseFeet("about ten")).toBeNaN(); expect(parseFeet("12' 14\"")).toBeNaN(); });
});
