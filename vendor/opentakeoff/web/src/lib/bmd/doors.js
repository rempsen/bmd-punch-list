// BMD change (new file): doors, by BMD's hard rules for every room measured on a drawing.
//
//   1. A door's swing is not a wall. The arc and the leaf show how the door opens and where it rests; the floor
//      under them belongs to the room the door swings into.
//   2. A doorway's centre separates two rooms. Each room's floor runs across the opening to the middle of the wall
//      thickness, so neither room stops at a wall face and neither spills past the door.
//
// The doors themselves are read by OpenTakeoff's door reader (../doorseal.ts: an arc fitted to the swing, the hinge
// at its centre, the strike at the end that meets a wall). This file finds the strokes that draw each door, so they
// can be left out of the walls, and works out where the wall's centreline crosses the opening, so the opening can
// be closed there instead.
import { findDoorSeals } from "../doorseal.ts";

const SEG_CURVE = 1;
const LEAF_SIDE_FT = 0.3;       // a leaf is drawn within this of the line from the hinge to the open end of the swing
const LEAF_PAST_FT = 0.2;       // ...and no further than this past either end of it
const FACE_SEARCH_FT = 2;       // wall faces are looked for this far along the wall beyond each jamb
const FACE_NEAR_FT = 0.3;       // the face the door is drawn against sits within this of the hinge
const WALL_MIN_FT = 0.25;       // the thinnest wall a door is hung in
const WALL_MAX_FT = 1.33;       // the thickest (16"); a line further off is something else
const BITE_FT = 0.35;           // the closing line runs this far into each jamb so the fill cannot slip round its ends

/**
 * Every door on a sheet, with the strokes that draw it and the line that closes its opening at the wall's centre.
 * @param {{segs: ArrayLike<number>, meta: ArrayLike<number>, kind: Uint8Array, wallKind: number, mask: object, pxPerFt: number}} p
 *   `kind`/`wallKind`: the linework sorting (only strokes still taken for walls are considered); `mask`: the
 *   OpenTakeoff fill mask built from that sorting, used by the door reader to check a swing meets walls.
 * @returns {{hinge: number[], strike: number[], open: number[], r: number, strokes: number[], close: number[][], wallFt: number}[]}
 */
export function findDoors({ segs, meta, kind, wallKind, mask, pxPerFt }) {
  if (!(pxPerFt > 0) || !segs.length) return [];
  const seals = findDoorSeals(Array.from(segs), Uint8Array.from(meta), mask, pxPerFt);
  if (!seals.length) return [];
  const n = segs.length >> 2;
  const F = pxPerFt;
  // straight wall strokes, bucketed so each door looks only at its own neighbourhood
  const cell = Math.max(16, 4 * F);
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    if (kind[i] !== wallKind || (meta[i] & SEG_CURVE)) continue;
    const x0 = Math.min(segs[i * 4], segs[i * 4 + 2]), x1 = Math.max(segs[i * 4], segs[i * 4 + 2]);
    const y0 = Math.min(segs[i * 4 + 1], segs[i * 4 + 3]), y1 = Math.max(segs[i * 4 + 1], segs[i * 4 + 3]);
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
      const k = gx * 100003 + gy; let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i);
    }
  }
  const near = (x0, y0, x1, y1) => {
    const out = new Set();
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) for (const i of grid.get(gx * 100003 + gy) ?? []) out.add(i);
    return out;
  };

  // the ends of every curved stroke: a leaf meets no curve but its own swing, so a straight stroke that runs into
  // another curve (the rounded end of a tag drawn over the leaf) is not part of the leaf
  const curveEnds = new Map();
  const ekey = (x, y) => Math.round(x) * 1000003 + Math.round(y);
  for (let i = 0; i < n; i++) {
    if (!(meta[i] & SEG_CURVE)) continue;
    for (const k of [0, 2]) { const key = ekey(segs[i * 4 + k], segs[i * 4 + k + 1]); let b = curveEnds.get(key); if (!b) curveEnds.set(key, (b = [])); b.push(i); }
  }
  const meetsOtherCurve = (i, own) => {
    for (const k of [0, 2]) {
      const x = segs[i * 4 + k], y = segs[i * 4 + k + 1];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of curveEnds.get(ekey(x + dx, y + dy)) ?? []) {
        if (own.has(j)) continue;
        for (const q of [0, 2]) if (Math.hypot(segs[j * 4 + q] - x, segs[j * 4 + q + 1] - y) <= 0.75) return true;
      }
    }
    return false;
  };

  const doors = [];
  for (const s of seals) {
    const arc = s.arc ?? [];
    const own = new Set(arc);
    const H = s.hinge;
    const R = s.r + FACE_SEARCH_FT * F;
    const cands = near(H[0] - R, H[1] - R, H[0] + R, H[1] + R);
    // the straight strokes lying along the line from the hinge to an end of the swing
    const along = (E) => {
      const lx = E[0] - H[0], ly = E[1] - H[1], ll = Math.hypot(lx, ly) || 1;
      const out = []; let len = 0;
      for (const i of cands) {
        let ok = true;
        for (const k of [0, 2]) {
          const px = segs[i * 4 + k] - H[0], py = segs[i * 4 + k + 1] - H[1];
          const t = (px * lx + py * ly) / ll, d = Math.abs(px * ly - py * lx) / ll;
          if (t < -LEAF_PAST_FT * F || t > ll + LEAF_PAST_FT * F || d > LEAF_SIDE_FT * F) ok = false;
        }
        // a side of a tag drawn over the leaf runs most of the leaf's length and meets the tag's rounded ends; the
        // leaf's own short end caps may touch them too and stay with the leaf
        if (ok && Math.hypot(segs[i * 4 + 2] - segs[i * 4], segs[i * 4 + 3] - segs[i * 4 + 1]) >= 0.5 * s.r && meetsOtherCurve(i, own)) ok = false;
        if (ok) { out.push(i); len += Math.hypot(segs[i * 4 + 2] - segs[i * 4], segs[i * 4 + 3] - segs[i * 4 + 1]); }
      }
      return { strokes: out, len };
    };
    // The strike is the end the door closes against; the open end is where the leaf rests. When both ends touch
    // drawn lines the reader's choice of strike can be wrong. The leaf is drawn from the hinge to the open end, so
    // an end with a leaf along it is not the strike.
    const a0 = [segs[arc[0] * 4], segs[arc[0] * 4 + 1]], a1 = [segs[arc[arc.length - 1] * 4 + 2], segs[arc[arc.length - 1] * 4 + 3]];
    let S = s.strike;
    let O = Math.hypot(a0[0] - S[0], a0[1] - S[1]) > Math.hypot(a1[0] - S[0], a1[1] - S[1]) ? a0 : a1;
    let leafS = along(S), leafO = along(O);
    if (leafS.len >= 0.5 * s.r && leafS.len > 1.5 * leafO.len) { [S, O] = [O, S]; [leafS, leafO] = [leafO, leafS]; }
    const leaf = leafO.strokes;
    const L = Math.hypot(S[0] - H[0], S[1] - H[1]);
    if (!(L > 0)) continue;
    const ux = (S[0] - H[0]) / L, uy = (S[1] - H[1]) / L, nx = -uy, ny = ux;   // along the opening, and across the wall
    const side = Math.sign((O[0] - H[0]) * nx + (O[1] - H[1]) * ny) || 1;       // the side the door swings to

    // the wall's faces beside the opening: strokes running along the opening, just past either jamb
    const offs = [];
    for (const i of cands) {
      if (leaf.includes(i)) continue;
      const x1 = segs[i * 4] - H[0], y1 = segs[i * 4 + 1] - H[1], x2 = segs[i * 4 + 2] - H[0], y2 = segs[i * 4 + 3] - H[1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.1 * F || Math.abs(((x2 - x1) * nx + (y2 - y1) * ny) / len) > 0.08) continue;   // not parallel to the opening
      const t1 = x1 * ux + y1 * uy, t2 = x2 * ux + y2 * uy, lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      const hingeSide = lo < -0.05 * F && hi > -FACE_SEARCH_FT * F, strikeSide = hi > L + 0.05 * F && lo < L + FACE_SEARCH_FT * F;
      if (!hingeSide && !strikeSide) continue;
      const d = ((x1 + x2) / 2) * nx + ((y1 + y2) / 2) * ny;
      if (Math.abs(d) <= (WALL_MAX_FT + FACE_NEAR_FT) * F) offs.push({ d: d * side, h: hingeSide, s: strikeSide });   // d positive = towards the swing
    }
    // the face the door is drawn against, then the wall's far face: the furthest of a close run of layers away from
    // the swing, no thinner than a real wall and no thicker than the thickest
    let A = 0, best = Infinity;
    for (const o of offs) if (Math.abs(o.d) <= FACE_NEAR_FT * F && Math.abs(o.d) < best) { best = Math.abs(o.d); A = o.d; }
    // The far face: a wall carries on past both jambs, so the furthest face line (within the thickest wall) that is
    // drawn on both sides of the opening. Where the wall turns at one jamb, the furthest on the side it carries on.
    // Hollow walls are drawn with a wide gap between their faces, so a gap is no reason to stop.
    const away = offs.filter((o) => o.d < A - 0.05 * F && A - o.d <= WALL_MAX_FT * F);
    const tol = 0.08 * F;
    const both = away.filter((o) => (o.h && away.some((q) => q.s && Math.abs(q.d - o.d) <= tol)) || (o.s && away.some((q) => q.h && Math.abs(q.d - o.d) <= tol)) || (o.h && o.s));
    const pool = both.length ? both : away;
    let B = null;
    for (const o of pool) if (B === null || o.d < B) B = o.d;
    // walls drawn as a single line have no thickness to split: the opening closes on that line
    if (B === null || A - B < WALL_MIN_FT * F) B = A;
    const mid = (A + B) / 2 * side, bite = BITE_FT * F;
    const close = [
      [H[0] + nx * mid - ux * bite, H[1] + ny * mid - uy * bite],
      [S[0] + nx * mid + ux * bite, S[1] + ny * mid + uy * bite],
    ];
    doors.push({ hinge: H, strike: S, open: O, r: s.r, strokes: [...arc, ...leaf], close, wallFt: (A - B) / F });
  }
  return doors;
}

/** The mask with every door's opening closed along its wall's centreline: a copy. The closing ink is marked as a door
 *  (OpenTakeoff's curve bit), so wall base still stops there and a closet behind a door is not taken for a cabinet. */
export function closeDoorways(mo, doors, curveBit) {
  if (!doors.length) return mo;
  const mask = new Uint8Array(mo.mask);
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < mo.mw && y < mo.mh) mask[y * mo.mw + x] |= 1 | curveBit; };
  for (const d of doors) {
    const [p, q] = d.close;
    const x0 = p[0] * mo.ws, y0 = p[1] * mo.ws, x1 = q[0] * mo.ws, y1 = q[1] * mo.ws;
    // one cell thick, centred on the wall, so the rooms either side reach equally close to it; where the line steps
    // diagonally the corner cell is filled too, because the fill is 4-connected and slips through a diagonal
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    let px = null, py = null;
    for (let i = 0; i <= steps; i++) {
      const cx = Math.floor(x0 + ((x1 - x0) * i) / steps), cy = Math.floor(y0 + ((y1 - y0) * i) / steps);
      if (px !== null && cx !== px && cy !== py) put(px, cy);
      put(cx, cy); px = cx; py = cy;
    }
  }
  return { ...mo, mask };
}
