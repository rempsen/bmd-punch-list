import { describe, expect, test } from "bun:test";
import { KIND, classifyLinework, createRoomFinder, textBoxes } from "./roomParts.js";

// Hand-drawn sheets, as pure data. 18 image pixels to the foot (1/8" = 1'-0" at the screen's render scale).
const FT = 18;
const DIMS = { w: 1400, h: 900 };
const UPP = 1 / FT;
const SEG_CURVE = 1, SEG_CLIP = 2, SEG_FILLONLY = 4;

function sheet() {
  const segs = [], meta = [], lum = [], dashed = [], subpaths = [], texts = [], points = [];
  const begin = (flags, fillLum) => ({ i0: meta.length, i1: meta.length, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, closed: false, flags, fillLum });
  const seg = (sp, x1, y1, x2, y2, flags, isDashed) => {
    segs.push(x1, y1, x2, y2); meta.push(flags); lum.push(0); dashed.push(isDashed ? 1 : 0); points.push([x1, y1], [x2, y2]);
    sp.i1 = meta.length;
    sp.x0 = Math.min(sp.x0, x1, x2); sp.x1 = Math.max(sp.x1, x1, x2); sp.y0 = Math.min(sp.y0, y1, y2); sp.y1 = Math.max(sp.y1, y1, y2);
  };
  const api = {
    /** One drawn line. */
    line(x1, y1, x2, y2, { w = 1, flags = 0, dashed: d = false } = {}) {
      const sp = begin(flags | (w << 4), 0); seg(sp, x1, y1, x2, y2, flags | (w << 4), d); subpaths.push(sp); return api;
    },
    /** A closed figure through the given corners. */
    poly(pts, { w = 1, flags = 0, fillLum = 0 } = {}) {
      const f = flags | (w << 4), sp = begin(f, fillLum);
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; seg(sp, a[0], a[1], b[0], b[1], f); }
      sp.closed = true; subpaths.push(sp); return api;
    },
    rect(x, y, w, h, o) { return api.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o); },
    /** A circle as curve chords, the way a PDF curve arrives. */
    circle(cx, cy, r, { n = 32, w = 1 } = {}) {
      const f = SEG_CURVE | (w << 4), sp = begin(f, 0);
      for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI; seg(sp, cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b), f); }
      sp.closed = true; subpaths.push(sp); return api;
    },
    /** A circle drawn as separate dashes. */
    dashedCircle(cx, cy, r, dashes = 24) {
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * 2 * Math.PI, a1 = ((i + 0.6) / dashes) * 2 * Math.PI, am = (a0 + a1) / 2;
        const f = SEG_CURVE | (1 << 4), sp = begin(f, 0);
        seg(sp, cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(am), cy + r * Math.sin(am), f);
        seg(sp, cx + r * Math.cos(am), cy + r * Math.sin(am), cx + r * Math.cos(a1), cy + r * Math.sin(a1), f);
        subpaths.push(sp);
      }
      return api;
    },
    /** A straight line drawn as separate dashes. */
    dashedLine(x1, y1, x2, y2, dash = 12, gap = 6) {
      const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      for (let t = 0; t + dash <= len; t += dash + gap) api.line(x1 + ux * t, y1 + uy * t, x1 + ux * (t + dash), y1 + uy * (t + dash));
      return api;
    },
    text(str, x0, y0, x1, y1) { texts.push({ str, x0, y0, x1, y1 }); return api; },
    geo() { return { segs, meta: Uint8Array.from(meta), lum: Uint8Array.from(lum), dashed: Uint8Array.from(dashed), subpaths, points }; },
    texts,
    finder() { return createRoomFinder({ geo: api.geo(), texts, dims: DIMS, pagePt: { w: DIMS.w / 2, h: DIMS.h / 2 }, renderScale: 2 }); },
    kinds() { return classifyLinework({ ...api.geo(), texts, pxPerFt: FT }).kind; },
  };
  return api;
}

// A 20 ft × 10 ft room: walls drawn the usual way, two faces 6 inches apart.
const RX = 400, RY = 300, RW = 20 * FT, RH = 10 * FT;
function room(s = sheet()) {
  s.rect(RX, RY, RW, RH, { w: 3 });
  s.rect(RX - 9, RY - 9, RW + 18, RH + 18, { w: 3 });
  return s;
}
const near = (got, want, pct = 2.5) => expect(Math.abs(got - want)).toBeLessThan(want * pct / 100);
const CENTRE = [RX + RW / 2, RY + RH * 0.75];

describe("telling walls from markup and text", () => {
  test("a plain room measures to its walls", () => {
    const r = room().finder().roomAt(...CENTRE, UPP);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("room");
    near(r.areaSf, 200);
    expect(r.note).toBeNull();
    expect(r.fixtures).toEqual([]);
  });

  test("a room-number box joined to a wall by a line does not carve the room", () => {
    const s = room();
    s.rect(RX + 150, RY + 60, 60, 24).text("136", RX + 158, RY + 64, RX + 202, RY + 80);   // the tag box
    s.line(RX + 180, RY + 84, RX + 180, RY + RH);                                           // a thin line from the tag down to the wall
    const k = s.kinds();
    expect(k[8]).toBe(KIND.TAG);
    const r = s.finder().roomAt(RX + 40, RY + 150, UPP);
    expect(r.ok).toBe(true);
    near(r.areaSf, 200);
    expect(r.note).toMatch(/tag/i);
  });

  test("a white box behind a room name is not a wall, wherever it sits", () => {
    const s = room();
    s.rect(RX - 2, RY + 40, 110, 40, { flags: SEG_FILLONLY, fillLum: 255 }).text("MAIL & SCOOTER", RX + 4, RY + 48, RX + 100, RY + 72);   // overlaps the left wall
    expect(s.kinds()[8]).toBe(KIND.HIDDEN);
    const r = s.finder().roomAt(...CENTRE, UPP);
    near(r.areaSf, 200);
    expect(r.note).toMatch(/note/i);
  });

  test("a section bubble that touches a wall is ignored, with the line through it", () => {
    const s = room();
    const cx = RX + 34, cy = RY + 50;
    s.circle(cx, cy, 34).line(cx - 34, cy, cx + 34, cy);
    s.text("3", cx - 5, cy - 24, cx + 5, cy - 6).text("A-502", cx - 22, cy + 6, cx + 22, cy + 22);
    const k = s.kinds();
    expect(k[8]).toBe(KIND.TAG);
    expect(k[8 + 32]).toBe(KIND.TAG);
    const r = s.finder().roomAt(...CENTRE, UPP);
    near(r.areaSf, 200);
    expect(r.note).toMatch(/section marker|bubble/i);
  });

  test("dashed lines and a dashed circle are not walls", () => {
    const s = room();
    s.dashedLine(RX + 100, RY, RX + 100, RY + RH).dashedCircle(RX + 220, RY + 100, 40);
    const k = s.kinds();
    expect([...k.slice(8)].every((v) => v === KIND.DASH)).toBe(true);
    const inside = s.finder().roomAt(RX + 220, RY + 100, UPP);   // a click inside the dashed circle still measures the room
    near(inside.areaSf, 200);
    expect(inside.note).toMatch(/dashed/i);
  });

  test("a stroke the PDF itself draws dashed is not a wall", () => {
    const s = room();
    s.line(RX + 100, RY, RX + 100, RY + RH, { dashed: true });
    expect(s.kinds()[8]).toBe(KIND.DASH);
    near(s.finder().roomAt(RX + 40, RY + 90, UPP).areaSf, 200);
  });

  test("an arrow and its leader are not walls", () => {
    const s = room();
    s.poly([[RX + 3, RY + 90], [RX + 15, RY + 85], [RX + 15, RY + 95]]);          // the arrowhead, touching the left wall
    s.line(RX + 15, RY + 90, RX + 120, RY + 90).line(RX + 120, RY + 90, RX + 150, RY + 60);   // the leader, bent up to its note
    s.line(RX + 150, RY + 60, RX + 150, RY);                                      // ...and carried on to the top wall
    const k = s.kinds();
    expect(k[8]).toBe(KIND.ARROW);
    expect(k[11]).toBe(KIND.ARROW);
    near(s.finder().roomAt(...CENTRE, UPP).areaSf, 200);
  });

  test("invisible clipping outlines are never walls", () => {
    const s = room();
    s.rect(RX + 60, RY, 80, RH, { flags: SEG_CLIP });
    expect(s.kinds()[8]).toBe(KIND.HIDDEN);
    near(s.finder().roomAt(RX + 100, RY + 90, UPP).areaSf, 200);
  });

  test("walls stay walls: a partition splits the room, and a real opening is not leaked through any more than before", () => {
    const s = room();
    s.line(RX + 10 * FT, RY, RX + 10 * FT, RY + RH, { w: 3 });   // a full-height partition
    const k = s.kinds();
    expect([...k].every((v) => v === KIND.WALL)).toBe(true);
    near(s.finder().roomAt(RX + 40, RY + 90, UPP).areaSf, 100);
    // long collinear wall pieces with door-sized gaps are not "dashes"
    const t = sheet();
    for (let i = 0; i < 5; i++) t.line(200 + i * 200, 200, 200 + i * 200 + 146, 200, { w: 3 });
    expect([...t.kinds()].every((v) => v === KIND.WALL)).toBe(true);
  });

  test("a small closet with its number inside is a room, not a tag", () => {
    const s = sheet();
    s.rect(RX, RY, 4 * FT, 6 * FT, { w: 3 }).text("101A", RX + 20, RY + 40, RX + 52, RY + 53);
    expect([...s.kinds()].every((v) => v === KIND.WALL)).toBe(true);
  });
});

describe("cabinets and other fixtures inside a room", () => {
  // The same room with a 2 ft deep cabinet run along the top wall, drawn as its front line and divided into units.
  function kitchen() {
    const s = room();
    s.line(RX, RY + 2 * FT, RX + RW, RY + 2 * FT);
    for (let i = 1; i < 10; i++) s.line(RX + i * 2 * FT, RY, RX + i * 2 * FT, RY + 2 * FT);
    return s;
  }

  test("a click on the open floor stops at the cabinet fronts and says what was left out", () => {
    const r = kitchen().finder().roomAt(...CENTRE, UPP);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("room");
    near(r.areaSf, 160);
    expect(r.fixtures.length).toBe(1);
    near(r.fixtures[0].areaSf, 40, 6);
    expect(r.withFixtures).not.toBeNull();
    near(r.withFixtures.areaSf, 200);
    expect(r.withFixtures.pointsPx.length).toBeGreaterThanOrEqual(4);
  });

  test("a click inside a cabinet measures the cabinet run, not the room and not a refusal", () => {
    const r = kitchen().finder().roomAt(RX + 3 * FT, RY + FT, UPP);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("fixture");
    near(r.areaSf, 40, 6);
    expect(r.note).toMatch(/cabinet|fixture/i);
  });

  test("the room next door, behind a wall, is never offered as a fixture", () => {
    const s = room();
    // a 4 ft wide closet on the far side of the right-hand wall
    s.rect(RX + RW + 9, RY, 4 * FT, RH, { w: 3 });
    const r = s.finder().roomAt(...CENTRE, UPP);
    near(r.areaSf, 200);
    expect(r.fixtures).toEqual([]);
    const closet = s.finder().roomAt(RX + RW + 9 + 2 * FT, RY + 90, UPP);
    expect(closet.kind).toBe("room");
    near(closet.areaSf, 40, 6);
  });

  test("two separate cabinet runs are counted as two", () => {
    const s = room();
    s.line(RX, RY + 2 * FT, RX + 8 * FT, RY + 2 * FT).line(RX + 8 * FT, RY, RX + 8 * FT, RY + 2 * FT);                    // top left
    s.line(RX + 14 * FT, RY + RH - 2 * FT, RX + RW, RY + RH - 2 * FT).line(RX + 14 * FT, RY + RH - 2 * FT, RX + 14 * FT, RY + RH);   // bottom right
    const r = s.finder().roomAt(...CENTRE, UPP);
    expect(r.fixtures.length).toBe(2);
    near(r.areaSf, 200 - 16 - 12);
    near(r.withFixtures.areaSf, 200);
  });
});

describe("keeping the result honest", () => {
  test("confidence drops, with a plain reason, when a lot of linework was ignored", () => {
    const plain = room().finder().roomAt(...CENTRE, UPP);
    const s = room();
    for (let i = 0; i < 5; i++) {
      const x = RX + 30 + i * 60;
      s.rect(x, RY + 30, 44, 20).text("N" + i, x + 4, RY + 33, x + 40, RY + 47).line(x + 22, RY + 50, x + 22, RY + RH);
    }
    const busy = s.finder().roomAt(RX + 8, RY + 150, UPP);
    near(busy.areaSf, 200);
    expect(busy.confidence).toBeLessThan(plain.confidence);
    expect(busy.note).toMatch(/Ignored 5 tags/);
  });

  test("a click outside the building is refused, not measured as everything it surrounds", () => {
    const s = room();
    s.rect(100, 100, 1200, 700, { w: 3 });   // the sheet border
    const r = s.finder().roomAt(200, 200, UPP);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/wraps around|isn't enclosed/);
  });

  test("no scale, no room; a scan, no room", () => {
    expect(room().finder().roomAt(...CENTRE, 0).ok).toBe(false);
    expect(sheet().finder().roomAt(...CENTRE, UPP).reason).toMatch(/scan/);
  });
});

describe("text positions", () => {
  test("pdf.js text items become boxes in image pixels, upright or turned", () => {
    const vt = [2, 0, 0, -2, 0, 800];   // a 400 pt tall page at render scale 2
    const [a, b] = textBoxes({ items: [
      { str: "136", transform: [10, 0, 0, 10, 100, 300], width: 18, height: 10 },
      { str: "UP", transform: [0, 10, -10, 0, 200, 100], width: 12, height: 10 },
      { str: " ", transform: [10, 0, 0, 10, 0, 0], width: 3, height: 10 },
    ] }, vt);
    expect(a).toEqual({ str: "136", x0: 200, y0: 180, x1: 236, y1: 200 });
    expect(b).toEqual({ str: "UP", x0: 380, y0: 576, x1: 400, y1: 600 });
  });
});
