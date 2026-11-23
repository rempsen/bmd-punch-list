import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createSheetEngine } from "./engine.js";

// OpenTakeoff's own four-room test drawing: four rooms of about 438.6 SF each, drawn at 1/4" = 1'-0".
async function sheet() {
  const data = new Uint8Array(readFileSync(new URL("./fixtures/four-rooms.pdf", import.meta.url)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  return createSheetEngine({ page: await doc.getPage(1), OPS: pdfjs.OPS });
}

describe("OpenTakeoff's measuring engine behind the simple screen", () => {
  test("the scale is read off the sheet", async () => {
    const s = await sheet();
    const d = await s.detectedScale();
    expect(d?.label).toBe('1/4" = 1\'-0"');
    expect(d?.upp).toBeGreaterThan(0);
    expect(s.dims.w).toBeGreaterThan(1000);
  });
  test("a click inside a room measures that room to its walls", async () => {
    const s = await sheet();
    const { upp } = await s.detectedScale();
    for (const [x, y] of [[600, 1084], [1640, 1084], [600, 464], [1600, 464]]) {
      const r = await s.roomAt(x, y, upp);
      expect(r.ok).toBe(true);
      expect(Math.abs(r.areaSf - 438.6)).toBeLessThan(438.6 * 0.05);
      expect(r.pointsPx.length).toBeGreaterThanOrEqual(4);
      expect(r.perimeterLf).toBeGreaterThan(60);
    }
  });
  test("a click outside any room is refused in plain words, never measured", async () => {
    const s = await sheet();
    const { upp } = await s.detectedScale();
    const r = await s.roomAt(5, 5, upp);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/enclosed|linework|nothing/i);
  });
  test("without a scale a room cannot be measured", async () => {
    const s = await sheet();
    const r = await s.roomAt(600, 1084, null);
    expect(r).toEqual({ ok: false, reason: "Set the scale for this sheet first." });
  });
  test("the pointer snaps to the drawing's own corners", async () => {
    const s = await sheet();
    const { upp } = await s.detectedScale();
    const room = await s.roomAt(600, 1084, upp);
    const [cx, cy] = room.pointsPx[0];
    const snapped = await s.snap(cx + 3, cy - 2, 7);
    expect(snapped).not.toBeNull();
    expect(Math.hypot(snapped[0] - cx, snapped[1] - cy)).toBeLessThan(6);
    expect(await s.snap(600, 1084, 7)).toBeNull();
  });
});
