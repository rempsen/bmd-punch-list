import { describe, expect, test } from "bun:test";
import { BLUE_SQUARE, sawThePicture } from "./test-image";

describe("the picture used to check image input", () => {
  test("is a real PNG", () => {
    const bytes = Buffer.from(BLUE_SQUARE.base64, "base64");
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.length).toBeLessThan(200);
  });
  test("a reply counts only when it names the colour", () => {
    expect(sawThePicture("Blue.")).toBe(true);
    expect(sawThePicture("The picture is blue")).toBe(true);
    expect(sawThePicture("I cannot see images")).toBe(false);
    expect(sawThePicture("red")).toBe(false);
  });
});
