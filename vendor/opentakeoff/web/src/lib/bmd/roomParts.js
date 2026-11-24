// BMD change (new file): what is a wall and what is not, for "Click a room" on the simple BMD takeoff screen.
//
// OpenTakeoff's room finder fills outwards from the click until it meets drawn linework. On a real architectural
// sheet a lot of that linework is not building: room tags, section bubbles, the white boxes drawn behind notes,
// arrows, dashed overhead lines. Flooring runs under all of it. This file sorts the linework BEFORE the fill, takes
// the non-building strokes out of the picture, and afterwards looks at what is left enclosed along the room's
// edge (cabinet runs, counters, other fixtures) so the screen can offer to include it.
//
// Nothing here is copied from OpenTakeoff. It calls OpenTakeoff's own mask, fill and trace functions unchanged
// (lib/oneclick.ts, lib/detectRooms.ts, lib/confidence.ts) and adds BMD's sorting in front and BMD's checks behind.
//
// Positions are image pixels (PDF points × the render scale, y downwards), as everywhere in lib/bmd.
import { buildMask, traceRegion, snapVertices, snapNearest, ringArea, MASK_MAX_DIM, MASK_CURVE_BIT, MASK_NODOOR_BIT } from "../oneclick.ts";
import { floodAtSeed } from "../detectRooms.ts";
import { floodSignals, traceConfidence } from "../confidence.ts";
import { closedMetrics } from "../geometry.js";
import { SNAP_TOL } from "../takeoffConstants.ts";

/** What a drawn stroke is. Only WALL takes part in finding a room. */
export const KIND = { WALL: 0, HIDDEN: 1, TEXT: 2, TAG: 3, DASH: 4, ARROW: 5 };

const SEG_CURVE = 1, SEG_CLIP = 2, SEG_FILLONLY = 4;   // the stroke facts OpenTakeoff records per segment (oneclick.ts)
const ROLE_ANNOTATION = 3;                             // buildMask leaves role-3 strokes out of the mask

// Sizes of drafting symbols are sizes ON PAPER: a section bubble is half an inch across whatever the drawing's
// scale. So these limits are in inches of paper, turned into image pixels through the render scale.
const TAG_MAX_IN = 1.25;        // the largest tag, bubble or keynote figure
const TAG_SMALL_IN = 0.6;       // below this a figure with text in it needs less text to be a tag
const TAG_MIN_IN = 0.08;
const TAG_COVER = 0.25;         // share of a figure its text must fill to be a tag (a closet's number fills a few percent)
const TAG_COVER_SMALL = 0.12;
const TAG_COVER_ROUND = 0.06;   // rooms are not half-inch circles
const NOTE_MAX_IN = 4;          // the largest white box behind a note that is reported as "a note"
const ARROW_MAX_IN = 0.25;      // the largest arrowhead
const DASH_MAX_IN = 0.6;        // the longest single dash
const DASH_GAP_IN = 0.14;       // the widest gap between dashes; a door at 1/16" scale is 0.19"
const DASH_GAP_FT = 2;          // ...and never a gap a person could walk through
const DASH_MIN_RUN = 3;         // fewer pieces in a row could be walls either side of an opening
const WHITE = 240;              // fill or stroke this light is invisible on paper

const round2 = (n) => Math.round(n * 100) / 100;

/** pdf.js text items as upright boxes in image pixels. `transform` is the viewport's (page.getViewport(...).transform). */
export function textBoxes(textContent, transform) {
  const out = [];
  const [va, vb, vc, vd, ve, vf] = transform;
  for (const it of textContent?.items ?? []) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const ul = Math.hypot(a, b) || 1, vl = Math.hypot(c, d) || 1;
    const ux = (a / ul) * it.width, uy = (b / ul) * it.width, wx = (c / vl) * it.height, wy = (d / vl) * it.height;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[e, f], [e + ux, f + uy], [e + wx, f + wy], [e + ux + wx, f + uy + wy]]) {
      const X = va * px + vc * py + ve, Y = vb * px + vd * py + vf;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
    if (x1 - x0 > 0.5 && y1 - y0 > 0.5) out.push({ str: it.str, x0: round2(x0), y0: round2(y0), x1: round2(x1), y1: round2(y1) });
  }
  return out;
}

// A coarse grid over boxes or points, for "what is near here" without comparing everything with everything.
function bucketGrid(cell) {
  const map = new Map();
  const key = (cx, cy) => cx * 73856093 + cy * 19349663;
  return {
    addBox(item, x0, y0, x1, y1) {
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
        const k = key(cx, cy); let l = map.get(k); if (!l) map.set(k, (l = [])); l.push(item);
      }
    },
    near(x0, y0, x1, y1, fn) {
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
        const l = map.get(key(cx, cy)); if (l) for (const it of l) fn(it);
      }
    },
  };
}

/**
 * Sorts every drawn stroke into wall or not-wall.
 * @param {{segs: number[], meta: Uint8Array, lum?: Uint8Array, dashed?: Uint8Array, subpaths?: any[], texts?: {x0:number,y0:number,x1:number,y1:number}[], pxPerFt?: number, pxPerIn?: number}} g
 * @returns {{kind: Uint8Array, roles: Uint8Array, items: {type: string, x0: number, y0: number, x1: number, y1: number, at?: number[][]}[], counts: Record<string, number>}}
 *   `kind` per segment (KIND), `roles` for OpenTakeoff's buildMask, and `items`: the tags, notes, arrows and dashed
 *   runs found, each with where it is, so a room can say which of them it ignored.
 */
export function classifyLinework({ segs, meta, lum = null, dashed = null, subpaths = null, texts = [], pxPerFt = 0, pxPerIn = 144 }) {
  const n = segs.length >> 2;
  const kind = new Uint8Array(n);
  const items = [];
  const IN = pxPerIn;

  // 1. Ink that cannot be seen: clipping outlines, and white-on-white fills and strokes (the boxes CAD programs
  //    put behind text so the note reads clearly over the drawing).
  for (let i = 0; i < n; i++) {
    const m = meta[i];
    if (m & SEG_CLIP) kind[i] = KIND.HIDDEN;
    else if (lum && lum[i] >= WHITE && !(m & SEG_FILLONLY)) kind[i] = KIND.HIDDEN;
    else if (dashed && dashed[i]) kind[i] = KIND.DASH;
  }
  const textGrid = bucketGrid(96);
  for (const t of texts) textGrid.addBox(t, t.x0, t.y0, t.x1, t.y1);
  // the text whose centre sits inside a box: how many, and how much of the box it covers
  const textIn = (x0, y0, x1, y1) => {
    let count = 0, area = 0; const seen = new Set();
    textGrid.near(x0, y0, x1, y1, (t) => {
      if (seen.has(t)) return; seen.add(t);
      const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) return;
      count++;
      area += Math.max(0, Math.min(t.x1, x1) - Math.max(t.x0, x0)) * Math.max(0, Math.min(t.y1, y1) - Math.max(t.y0, y0));
    });
    return { count, cover: area / Math.max(1, (x1 - x0) * (y1 - y0)) };
  };
  const noteBoxes = [];
  for (const sp of subpaths ?? []) {
    if (!(sp.flags & SEG_FILLONLY) || sp.fillLum < WHITE) continue;
    for (let i = sp.i0; i < sp.i1; i++) kind[i] = KIND.HIDDEN;
    const w = sp.x1 - sp.x0, h = sp.y1 - sp.y0;
    if (Math.min(w, h) > 3 && Math.max(w, h) <= NOTE_MAX_IN * IN && textIn(sp.x0 - 1, sp.y0 - 1, sp.x1 + 1, sp.y1 + 1).count) noteBoxes.push({ x0: sp.x0, y0: sp.y0, x1: sp.x1, y1: sp.y1 });
  }

  // 2. Figures: strokes joined end to end. A wall network is one big figure; a tag box, a bubble, a dash or an
  //    arrowhead is a small one on its own.
  const vid = new Map();
  const vx = [], vy = [], deg = [];
  const vertex = (x, y) => {
    const k = Math.round(x * 2) * 262144 + Math.round(y * 2);
    let v = vid.get(k);
    if (v === undefined) { v = vx.length; vid.set(k, v); vx.push(x); vy.push(y); deg.push(0); }
    return v;
  };
  const va = new Int32Array(n).fill(-1), vb = new Int32Array(n).fill(-1);
  const at = [];            // vertex → the strokes that end there
  const parent = [];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < n; i++) {
    if (kind[i] === KIND.HIDDEN) continue;
    const x1 = segs[i * 4], y1 = segs[i * 4 + 1], x2 = segs[i * 4 + 2], y2 = segs[i * 4 + 3];
    const a = vertex(x1, y1), b = vertex(x2, y2);
    if (a === b) continue;                       // a dot
    va[i] = a; vb[i] = b; deg[a]++; deg[b]++;
    (at[a] ??= []).push(i); (at[b] ??= []).push(i);
    while (parent.length < vx.length) parent.push(parent.length);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const figs = new Map();   // root vertex → figure
  for (let i = 0; i < n; i++) {
    if (va[i] < 0) continue;
    const r = find(va[i]);
    let f = figs.get(r);
    if (!f) figs.set(r, (f = { segs: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, len: 0, curves: 0, kind: KIND.WALL }));
    f.segs.push(i);
    const x1 = segs[i * 4], y1 = segs[i * 4 + 1], x2 = segs[i * 4 + 2], y2 = segs[i * 4 + 3];
    f.x0 = Math.min(f.x0, x1, x2); f.x1 = Math.max(f.x1, x1, x2); f.y0 = Math.min(f.y0, y1, y2); f.y1 = Math.max(f.y1, y1, y2);
    f.len += Math.hypot(x2 - x1, y2 - y1);
    if (meta[i] & SEG_CURVE) f.curves++;
  }
  const figures = [...figs.values()];
  for (const f of figures) {
    const vs = new Set();
    for (const i of f.segs) { vs.add(va[i]); vs.add(vb[i]); }
    f.verts = [...vs];
    f.ends = f.verts.filter((v) => deg[v] === 1);
    f.branches = f.verts.some((v) => deg[v] > 2);
    f.loop = f.ends.length === 0 && !f.branches && f.segs.length >= 3;
  }
  const mark = (f, k) => { f.kind = k; for (const i of f.segs) if (kind[i] === KIND.WALL) kind[i] = k; };

  // 3. Tags: a small closed figure that its own text fills (a room-number box, a keynote diamond or hexagon,
  //    a section or detail bubble). A real closet is also a small closed figure with a number in it, but the
  //    number fills a few percent of a closet and a quarter or more of a tag.
  const tagBoxes = [];
  const tagTest = (x0, y0, x1, y1, curved) => {
    const w = x1 - x0, h = y1 - y0, big = Math.max(w, h);
    if (big > TAG_MAX_IN * IN || Math.min(w, h) < TAG_MIN_IN * IN) return false;
    const t = textIn(x0, y0, x1, y1);
    if (!t.count) return false;
    return t.cover >= TAG_COVER || (curved && t.cover >= TAG_COVER_ROUND) || (big <= TAG_SMALL_IN * IN && t.cover >= TAG_COVER_SMALL);
  };
  for (const f of figures) {
    if (!f.loop || f.kind !== KIND.WALL) continue;
    const curved = f.curves >= f.segs.length * 0.6;
    if (!tagTest(f.x0, f.y0, f.x1, f.y1, curved)) continue;
    mark(f, KIND.TAG);
    tagBoxes.push({ type: curved ? "bubble" : "tag", x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 });
  }
  // A closed outline that shares a corner with something else (a bubble with a bar across it, an arrowhead on its
  // line) is not a figure on its own above, so closed outlines are also taken one drawn path at a time.
  const outlines = [];
  for (const sp of subpaths ?? []) {
    if (sp.i1 - sp.i0 < 3 || (sp.flags & SEG_CLIP) || kind[sp.i0] === KIND.HIDDEN) continue;
    const a = sp.i0 * 4, b = (sp.i1 - 1) * 4;
    if (!sp.closed && Math.hypot(segs[a] - segs[b + 2], segs[a + 1] - segs[b + 3]) > 0.75) continue;
    outlines.push(sp);
  }
  for (const sp of outlines) {
    if (kind[sp.i0] !== KIND.WALL || (sp.flags & SEG_FILLONLY)) continue;
    let curves = 0; for (let i = sp.i0; i < sp.i1; i++) if (meta[i] & SEG_CURVE) curves++;
    const curved = curves >= (sp.i1 - sp.i0) * 0.6;
    if (!tagTest(sp.x0, sp.y0, sp.x1, sp.y1, curved)) continue;
    for (let i = sp.i0; i < sp.i1; i++) if (kind[i] === KIND.WALL) kind[i] = KIND.TAG;
    tagBoxes.push({ type: curved ? "bubble" : "tag", x0: sp.x0, y0: sp.y0, x1: sp.x1, y1: sp.y1 });
  }
  if (tagBoxes.length) {
    // whatever is drawn wholly inside a tag belongs to it (the bar across a section bubble)
    const tg = bucketGrid(96);
    for (const b of tagBoxes) tg.addBox(b, b.x0, b.y0, b.x1, b.y1);
    for (const f of figures) {
      if (f.x1 - f.x0 > TAG_MAX_IN * IN || f.y1 - f.y0 > TAG_MAX_IN * IN) continue;
      let inside = false;
      tg.near(f.x0, f.y0, f.x1, f.y1, (b) => { if (f.x0 >= b.x0 - 1.5 && f.y0 >= b.y0 - 1.5 && f.x1 <= b.x1 + 1.5 && f.y1 <= b.y1 + 1.5) inside = true; });
      if (inside) mark(f, KIND.TAG);
    }
  }
  for (const b of tagBoxes) items.push(b);

  // 4. Arrowheads, then the leader or dimension line each one ends.
  const heads = [];
  const head = (p, x0, y0, x1, y1) => {
    // the base is the shortest side; the tip is the corner opposite it
    let best = 0, bl = Infinity;
    for (let k = 0; k < 3; k++) { const a = p[(k + 1) % 3], b = p[(k + 2) % 3], l = Math.hypot(a[0] - b[0], a[1] - b[1]); if (l < bl) { bl = l; best = k; } }
    const tip = p[best], a = p[(best + 1) % 3], b = p[(best + 2) % 3];
    heads.push({ x0, y0, x1, y1, tip, base: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    items.push({ type: "arrow", x0, y0, x1, y1 });
  };
  for (const f of figures) {
    if (f.kind !== KIND.WALL || !f.loop || f.verts.length !== 3 || f.curves) continue;
    if (Math.max(f.x1 - f.x0, f.y1 - f.y0) > ARROW_MAX_IN * IN) continue;
    mark(f, KIND.ARROW);
    head(f.verts.map((v) => [vx[v], vy[v]]), f.x0, f.y0, f.x1, f.y1);
  }
  for (const sp of outlines) {
    if (kind[sp.i0] !== KIND.WALL || Math.max(sp.x1 - sp.x0, sp.y1 - sp.y0) > ARROW_MAX_IN * IN) continue;
    const p = []; let curve = false;
    for (let i = sp.i0; i < sp.i1; i++) {
      if (meta[i] & SEG_CURVE) curve = true;
      for (const [x, y] of [[segs[i * 4], segs[i * 4 + 1]], [segs[i * 4 + 2], segs[i * 4 + 3]]]) if (!p.some((q) => Math.hypot(q[0] - x, q[1] - y) < 0.75)) p.push([x, y]);
    }
    if (curve || p.length !== 3) continue;
    for (let i = sp.i0; i < sp.i1; i++) kind[i] = KIND.ARROW;
    head(p, sp.x0, sp.y0, sp.x1, sp.y1);
  }
  if (heads.length) {
    const hg = bucketGrid(96);
    for (const h of heads) hg.addBox(h, h.x0 - 3, h.y0 - 3, h.x1 + 3, h.y1 + 3);
    const far = (i, v) => (va[i] === v ? vb[i] : va[i]);
    for (let i = 0; i < n; i++) {
      if (kind[i] !== KIND.WALL || va[i] < 0 || (meta[i] & SEG_CURVE)) continue;
      for (const e of [va[i], vb[i]]) {
        const o = far(i, e), ex = vx[e], ey = vy[e];
        const dl = Math.hypot(vx[o] - ex, vy[o] - ey) || 1, dx = (vx[o] - ex) / dl, dy = (vy[o] - ey) / dl;   // from this end, into the line
        let stem = false;
        hg.near(ex, ey, ex, ey, (h) => {
          if (ex < h.x0 - 2.5 || ex > h.x1 + 2.5 || ey < h.y0 - 2.5 || ey > h.y1 + 2.5) return;
          const ax = h.base[0] - h.tip[0], ay = h.base[1] - h.tip[1], al = Math.hypot(ax, ay) || 1;
          const along = (dx * ax + dy * ay) / al;   // 1 when the line runs from the tip back through the base
          const atBase = Math.hypot(ex - h.base[0], ey - h.base[1]) <= Math.hypot(ex - h.tip[0], ey - h.tip[1]);
          if (along >= (atBase ? 0.7 : 0.9)) stem = true;
        });
        if (!stem) continue;
        // the line, and up to three more pieces of it drawn with the same pen (a leader bends once or twice)
        kind[i] = KIND.ARROW;
        let v = o, last = i;
        for (let step = 0; step < 3; step++) {
          const next = (at[v] ?? []).filter((j) => j !== last && kind[j] === KIND.WALL);
          if (next.length !== 1 || (meta[next[0]] & SEG_CURVE) || meta[next[0]] >> 4 !== meta[i] >> 4) break;
          last = next[0]; kind[last] = KIND.ARROW; v = far(last, v);
        }
        break;
      }
    }
  }

  // 5. Dashed lines drawn as separate dashes: short open pieces that continue one another across small, even gaps.
  //    (A stroke the PDF itself draws dashed arrives flagged and was taken in step 1.)
  const dashMax = DASH_MAX_IN * IN;
  const gapMax = pxPerFt > 0 ? Math.min(DASH_GAP_IN * IN, DASH_GAP_FT * pxPerFt) : DASH_GAP_IN * IN;
  const cands = [];
  for (const f of figures) {
    if (f.kind !== KIND.WALL || f.ends.length !== 2 || f.branches || f.segs.length > 12 || f.len > dashMax) continue;
    f.tan = f.ends.map((e) => {
      for (const i of f.segs) {
        const o = va[i] === e ? vb[i] : vb[i] === e ? va[i] : -1;
        if (o >= 0) { const l = Math.hypot(vx[e] - vx[o], vy[e] - vy[o]) || 1; return [(vx[e] - vx[o]) / l, (vy[e] - vy[o]) / l]; }   // pointing out of the dash
      }
      return [0, 0];
    });
    f.link = [null, null];
    cands.push(f);
  }
  if (cands.length >= DASH_MIN_RUN) {
    const eg = bucketGrid(Math.max(8, gapMax));
    for (const f of cands) for (let k = 0; k < 2; k++) { const e = f.ends[k]; eg.addBox({ f, k }, vx[e], vy[e], vx[e], vy[e]); }
    for (const f of cands) for (let k = 0; k < 2; k++) {
      const e = f.ends[k], ex = vx[e], ey = vy[e];
      let best = null, bd = Infinity;
      eg.near(ex - gapMax, ey - gapMax, ex + gapMax, ey + gapMax, (q) => {
        if (q.f === f) return;
        const o = q.f.ends[q.k], gx = vx[o] - ex, gy = vy[o] - ey, g = Math.hypot(gx, gy);
        if (g > gapMax || g > 2.5 * Math.max(f.len, q.f.len) + 2 || g >= bd) return;
        if (g > 1.5) {
          const t1 = f.tan[k], t2 = q.f.tan[q.k];
          if ((t1[0] * gx + t1[1] * gy) / g < 0.85 || -(t2[0] * gx + t2[1] * gy) / g < 0.85) return;   // must carry straight on
        }
        best = q; bd = g;
      });
      if (best) f.link[k] = { f: best.f, k: best.k, gap: bd };
    }
    const seen = new Set();
    for (const start of cands) {
      if (seen.has(start)) continue;
      const run = [], gaps = [], stack = [start];
      seen.add(start);
      while (stack.length) {
        const f = stack.pop(); run.push(f);
        for (let k = 0; k < 2; k++) {
          const l = f.link[k];
          if (!l || l.f.link[l.k]?.f !== f) continue;   // only links both ends agree on
          gaps.push(l.gap);
          if (!seen.has(l.f)) { seen.add(l.f); stack.push(l.f); }
        }
      }
      if (run.length < DASH_MIN_RUN) continue;
      gaps.sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      if (gaps[gaps.length - 1] > 2.2 * med + 1.5) continue;   // uneven gaps: openings in a wall, not a dash pattern
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const f of run) { mark(f, KIND.DASH); x0 = Math.min(x0, f.x0); y0 = Math.min(y0, f.y0); x1 = Math.max(x1, f.x1); y1 = Math.max(y1, f.y1); }
      const step = Math.max(1, Math.floor(run.length / 8));
      items.push({ type: "dashed", x0, y0, x1, y1, at: run.filter((_, i) => i % step === 0).map((f) => [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2]) });
    }
  }
  if (dashed) {
    for (const f of figures) {
      if (!f.segs.some((i) => dashed[i])) continue;
      items.push({ type: "dashed", x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, at: f.segs.filter((i) => dashed[i]).slice(0, 8).map((i) => [(segs[i * 4] + segs[i * 4 + 2]) / 2, (segs[i * 4 + 1] + segs[i * 4 + 3]) / 2]) });
    }
  }

  // 6. Strokes that lie wholly inside a piece of text: underlines, and lettering drawn as outlines over real text.
  for (let i = 0; i < n; i++) {
    if (kind[i] !== KIND.WALL) continue;
    const x1 = segs[i * 4], y1 = segs[i * 4 + 1], x2 = segs[i * 4 + 2], y2 = segs[i * 4 + 3];
    let inside = false;
    textGrid.near(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), (t) => {
      if (x1 >= t.x0 - 1 && x1 <= t.x1 + 1 && x2 >= t.x0 - 1 && x2 <= t.x1 + 1 && y1 >= t.y0 - 1 && y1 <= t.y1 + 1 && y2 >= t.y0 - 1 && y2 <= t.y1 + 1) inside = true;
    });
    if (inside) kind[i] = KIND.TEXT;
  }

  // Notes: the white boxes behind text, with the lines of one note counted once, and not those that belong to a tag.
  noteBoxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const merged = [];
  for (const b of noteBoxes) {
    if (tagBoxes.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0)) continue;
    const m = merged.find((q) => b.x0 <= q.x1 + 3 && b.x1 >= q.x0 - 3 && b.y0 <= q.y1 + 3 && b.y1 >= q.y0 - 3);
    if (m) { m.x0 = Math.min(m.x0, b.x0); m.y0 = Math.min(m.y0, b.y0); m.x1 = Math.max(m.x1, b.x1); m.y1 = Math.max(m.y1, b.y1); }
    else merged.push({ type: "note", ...b });
  }
  for (const m of merged) items.push(m);

  const roles = new Uint8Array(n);
  const counts = { wall: 0, hidden: 0, text: 0, tag: 0, dash: 0, arrow: 0 };
  const names = ["wall", "hidden", "text", "tag", "dash", "arrow"];
  for (let i = 0; i < n; i++) { if (kind[i] !== KIND.WALL) roles[i] = ROLE_ANNOTATION; counts[names[kind[i]]]++; }
  return { kind, roles, items, counts };
}

function insideRing(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const plural = (n, one, many) => (n === 1 ? `${/^[aeiou]/i.test(one) ? "an" : "a"} ${one}` : `${n} ${many}`);

/** What was ignored inside a traced room, as counts and as one plain sentence (null when nothing was). */
export function describeIgnored(items, ring) {
  const c = { tag: 0, bubble: 0, note: 0, arrow: 0, dashed: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  for (const it of items) {
    if (it.x1 < x0 || it.x0 > x1 || it.y1 < y0 || it.y0 > y1) continue;
    const pts = it.at ?? [[(it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2]];
    if (pts.some(([x, y]) => insideRing(ring, x, y))) c[it.type]++;
  }
  const parts = [];
  if (c.tag) parts.push(plural(c.tag, "tag", "tags"));
  if (c.note) parts.push(plural(c.note, "note", "notes"));
  if (c.bubble) parts.push(plural(c.bubble, "section marker", "section markers"));
  if (c.arrow) parts.push(plural(c.arrow, "arrow", "arrows"));
  if (c.dashed) parts.push("dashed lines");
  const total = c.tag + c.bubble + c.note + c.arrow + c.dashed;
  if (!parts.length) return { counts: c, total, note: null };
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return { counts: c, total, note: `Ignored ${list} inside this room.` };
}

// ── The room as a grid of cells: tidying its edge, and finding what is enclosed along it ──────────────────────
// All of this works in a window around the room, on the same grid as OpenTakeoff's mask.

function dilate(src, w, h, r) {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let last = -Infinity;
    for (let x = 0; x < w; x++) { if (src[row + x]) last = x; if (x - last <= r) tmp[row + x] = 1; }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) { if (src[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}
function erode(src, w, h, r) {
  if (r <= 0) return src.slice();
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}
/** Closes slits and gaps up to 2r cells wide; never grows the outline outwards. */
const closeCells = (src, w, h, r) => erode(dilate(src, w, h, r), w, h, r);

/** Fills everything the cells surround. The window must have a clear margin all round. */
function fillHoles(src, w, h) {
  const out = new Uint8Array(w * h).fill(1);
  const stack = [];
  const push = (i) => { if (!src[i] && out[i]) { out[i] = 0; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w);
  }
  return out;
}

const WRAP_RATIO = 1.6;         // outline area ÷ filled area above which a fill surrounds other spaces

// Limits for what counts as a fixture, in real feet.
const FIX_REACH_FT = 0.3;       // how far across drawn linework a fixture may sit from the open floor: a line or a
                                // counter's double edge, never the thickness of a wall
const FIX_REACH_MIN = 3;        // ...and at least this many cells, for a double line on a coarse grid
const FIX_MIN_SF = 1;           // smaller enclosed specks are folded into the room without comment
const FIX_MIN_WIDTH_FT = 0.7;   // thinner is the inside of a drawn wall
const SPECK_MIN_WIDTH_FT = 0.35;
const FIX_MAX_WIDTH_FT = 5;     // deeper than a counter, an island or a tub is a room
const FIX_MAX_SF = 120;
const FIX_MAX_SHARE = 0.6;      // ...and so is anything more than this share of the room it sits in
const FIX_MAX_TOTAL_SHARE = 0.45; // when the fill saw through light linework: more than this cut off is a floor pattern
const FIX_CONTACT_FT = 0.75;    // the least length of front a fixture shares with the floor
const DOOR_EDGE_FT = 0.75;      // this much door-swing linework on its edge makes a pocket a room with a door, or the
                                // swing itself: left alone either way

/**
 * Looks at a filled room on the mask grid.
 * @returns {{win: object, room: Uint8Array, groups: {cells: Uint8Array, count: number}[], all: Uint8Array|null}}
 *   `room`: the room's cells with slits closed, holes filled and specks folded in; `groups`: fixture areas along
 *   its edge (touching fixtures are one group); `all`: the room with every group joined on.
 */
function analyse(mask, flood) {
  const { mw, mh } = mask, mppf = mask.mppf || 0;
  const region = flood.region;
  let bx0 = mw, by0 = mh, bx1 = -1, by1 = -1;
  for (let y = 0; y < mh; y++) {
    const row = y * mw;
    for (let x = 0; x < mw; x++) if (region[row + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  const reach = Math.max(FIX_REACH_MIN, Math.min(7, Math.round(FIX_REACH_FT * mppf)));
  const rJoin = Math.ceil(reach / 2);
  const pad = Math.ceil(mppf > 0 ? mppf : 8) + reach + 3;
  const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad), x1 = Math.min(mw - 1, bx1 + pad), y1 = Math.min(mh - 1, by1 + pad);
  // one spare ring of cells so "touches the window's edge" and "is surrounded" are both well defined
  const w = x1 - x0 + 3, h = y1 - y0 + 3;
  const win = { x0: x0 - 1, y0: y0 - 1, w, h, ws: mask.ws };
  const R = new Uint8Array(w * h), wall = new Uint8Array(w * h), door = new Uint8Array(w * h);
  // OpenTakeoff sometimes fills straight through light linework it takes for pattern or annotation (a thin line
  // running two feet off a heavy wall, for one). That is how a counter front is drawn too. So when the fill did
  // that, look again with that linework standing: the floor is the largest piece, and the pieces it cut off are
  // judged below like any other pocket.
  const saw = !!flood.hatchFiltered;
  let cells = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * mw + x, j = (y - win.y0) * w + (x - win.x0), m = mask.mask[i];
    if (region[i]) { R[j] = 1; cells++; }
    if (m & 3 && !(region[i] && !saw)) { wall[j] = 1; if ((m & MASK_CURVE_BIT) && !(m & MASK_NODOOR_BIT)) door[j] = 1; }
  }
  const plain = () => fillHoles(closeCells(R, w, h, 1), w, h);
  let floor = R;
  if (saw) {
    floor = new Uint8Array(w * h);
    const seen = new Uint8Array(w * h), q = new Int32Array(w * h);
    let best = null;
    for (let s = 0; s < w * h; s++) {
      if (!R[s] || wall[s] || seen[s]) continue;
      let qh = 0, qt = 0; q[qt++] = s; seen[s] = 1;
      while (qh < qt) { const i = q[qh++]; for (const j of [i - 1, i + 1, i - w, i + w]) if (R[j] && !wall[j] && !seen[j]) { seen[j] = 1; q[qt++] = j; } }
      if (!best || qt > best.length) best = q.slice(0, qt);
    }
    if (best) for (const i of best) floor[i] = 1;
  }
  let room = fillHoles(closeCells(floor, w, h, 1), w, h);
  if (!(mppf > 0)) return { win, room: plain(), groups: [], all: null };

  const near = dilate(room, w, h, reach);
  // enclosed pockets of clear cells outside the room
  const label = new Int32Array(w * h);
  const pockets = [null];
  const queue = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (label[s] || room[s] || wall[s]) continue;
    const id = pockets.length, p = { id, count: 0, open: false, contact: 0, edge: 0, doorEdge: 0, maxD: 0, cells: null };
    let qh = 0, qt = 0; queue[qt++] = s; label[s] = id;
    while (qh < qt) {
      const i = queue[qh++], x = i % w, y = (i / w) | 0;
      p.count++;
      if (near[i]) p.contact++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { p.open = true; continue; }
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (wall[j]) { p.edge++; if (door[j]) p.doorEdge++; continue; }
        if (room[j] || label[j]) continue;
        label[j] = id; queue[qt++] = j;
      }
    }
    if (!p.open) p.cells = queue.slice(0, qt);
    pockets.push(p);
  }
  // how wide each pocket is: twice the furthest any of its cells sits from its own edge
  const dist = new Uint16Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!label[i]) continue;
    dist[i] = Math.min(dist[i - 1], dist[i - w], dist[i - w - 1], dist[i - w + 1]) + 1;
  }
  for (let y = h - 2; y >= 1; y--) for (let x = w - 2; x >= 1; x--) {
    const i = y * w + x; if (!label[i]) continue;
    const d = Math.min(dist[i], Math.min(dist[i + 1], dist[i + w], dist[i + w + 1], dist[i + w - 1]) + 1);
    dist[i] = d;
    const p = pockets[label[i]]; if (d > p.maxD) p.maxD = d;
  }
  const roomSf = room.reduce((a, v) => a + v, 0) / (mppf * mppf);
  const minContact = Math.max(3, Math.round(FIX_CONTACT_FT * mppf));
  const fits = (p) => {
    if (p.open || !p.cells) return null;
    const sf = p.count / (mppf * mppf), width = (2 * p.maxD - 1) / mppf;
    if (p.doorEdge >= Math.max(4, DOOR_EDGE_FT * mppf)) return null;
    if (sf < FIX_MIN_SF) return width >= SPECK_MIN_WIDTH_FT ? "speck" : null;
    if (width < FIX_MIN_WIDTH_FT || width > FIX_MAX_WIDTH_FT || sf > FIX_MAX_SF || sf > roomSf * FIX_MAX_SHARE) return null;
    return "fixture";
  };
  const fixtures = [];
  let specks = false;
  for (const p of pockets) {
    if (!p || p.contact < Math.min(minContact, p.count)) continue;
    const what = fits(p);
    if (what === "speck") { for (const i of p.cells) room[i] = 1; specks = true; } else if (what === "fixture") { p.taken = true; fixtures.push(p); }
  }
  if (specks) room = fillHoles(closeCells(room, w, h, rJoin), w, h);
  // one more step outwards: what sits directly behind a fixture and fits the same description (the back half of a
  // counter, the units of a cabinet run divided front to back)
  if (fixtures.length) {
    const taken = new Uint8Array(w * h);
    for (const p of fixtures) for (const i of p.cells) taken[i] = 1;
    const nearFix = dilate(taken, w, h, reach);
    for (const p of pockets) {
      if (!p || p.taken || p.open || !p.cells) continue;
      let touch = 0; for (const i of p.cells) if (nearFix[i]) touch++;
      if (touch >= Math.min(minContact, p.count) && fits(p) === "fixture") { p.taken = true; fixtures.push(p); }
    }
  }
  // Whatever the first fill covered that is not a fixture stays in the room.
  const fx = new Uint8Array(w * h);
  let fxCells = 0;
  for (const p of fixtures) for (const i of p.cells) { fx[i] = 1; fxCells++; }
  if (saw && (!fixtures.length || fxCells > cells * FIX_MAX_TOTAL_SHARE)) return { win, room: plain(), groups: [], all: null };   // a floor pattern, not fixtures
  if (!fixtures.length) return { win, room, groups: [], all: null };
  // fixtures that touch are one fixture
  const joined = closeCells(fx, w, h, rJoin);
  if (saw) {
    for (let i = 0; i < room.length; i++) if (R[i] && !joined[i]) room[i] = 1;
    room = fillHoles(closeCells(room, w, h, 1), w, h);
    for (let i = 0; i < room.length; i++) if (fx[i]) room[i] = 0;
  }
  const gl = new Int32Array(w * h), groups = [];
  for (const p of fixtures) {
    const s = p.cells[0];
    if (gl[s]) continue;
    const cells = new Uint8Array(w * h); let count = 0, qh = 0, qt = 0;
    queue[qt++] = s; gl[s] = groups.length + 1;
    while (qh < qt) {
      const i = queue[qh++]; cells[i] = 1; count++;
      for (const j of [i - 1, i + 1, i - w, i + w]) if (joined[j] && !gl[j]) { gl[j] = groups.length + 1; queue[qt++] = j; }
    }
    groups.push({ cells: fillHoles(cells, w, h), count });
  }
  const both = room.slice();
  for (let i = 0; i < both.length; i++) if (fx[i] || (saw && R[i])) both[i] = 1;
  return { win, room, groups, all: fillHoles(closeCells(both, w, h, rJoin), w, h) };
}

/**
 * A room finder for one sheet.
 * @param {{geo: {segs: number[], meta: Uint8Array, lum?: Uint8Array, dashed?: Uint8Array, subpaths?: any[]}, texts?: any[], dims: {w: number, h: number}, pagePt: {w: number, h: number}, renderScale: number, nearest?: (x: number, y: number, d: number) => number[]|null|undefined}} sheet
 */
export function createRoomFinder({ geo, texts = [], dims, pagePt, renderScale, nearest = null }) {
  let made = null;   // {upp, parts, mask}: the sorting and the mask both depend on the scale
  // traced corners are pulled onto the drawing's own corners, as OpenTakeoff does
  if (!nearest && geo.points?.length) nearest = snapNearest(geo.points);

  function prepare(upp) {
    if (made && made.upp === upp) return made;
    const pxPerFt = 1 / upp;
    const parts = classifyLinework({ segs: geo.segs, meta: geo.meta, lum: geo.lum, dashed: geo.dashed, subpaths: geo.subpaths, texts, pxPerFt, pxPerIn: 72 * renderScale });
    const mask = buildMask(geo.segs, dims.w, dims.h, MASK_MAX_DIM, geo.meta, pxPerFt, pxPerFt, { pageW: pagePt.w, pageH: pagePt.h, renderScale, baseScale: renderScale }, parts.roles);
    return (made = { upp, parts, mask });
  }
  const ringOf = (cells, win) => {
    const pts = traceRegion({ region: cells, mw: win.w, mh: win.h, ws: win.ws });
    const ox = win.x0 / win.ws, oy = win.y0 / win.ws;
    const moved = pts.map(([x, y]) => [x + ox, y + oy]);
    return snapVertices(moved, (x, y, d) => (nearest ? nearest(x, y, d) : null), SNAP_TOL).map(([x, y]) => [x, y]);
  };
  const measured = (ring, upp) => ({ pointsPx: ring, areaSf: round2(ringArea(ring) * upp * upp), perimeterLf: round2(closedMetrics(ring).perim * upp) });

  // A click inside a cabinet or fixture fills only that pocket. Find the room it belongs to: the open floor just
  // across the pocket's own outline. Returns the whole fixture (a divided cabinet run is one fixture) or null.
  function fixtureAround(mask, flood) {
    const { mw, mh, ws } = mask, mppf = mask.mppf || 0;
    if (!(mppf > 0) || flood.count / (mppf * mppf) > FIX_MAX_SF) return null;
    const region = flood.region, reach = Math.max(FIX_REACH_MIN, Math.min(7, Math.round(FIX_REACH_FT * mppf)));
    const seeds = [], seenCell = new Set();
    let first = -1;
    for (let i = 0; i < region.length && seeds.length < 400; i++) {
      if (!region[i]) continue;
      if (first < 0) first = i;
      const x = i % mw, y = (i / mw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (region[i + dx + dy * mw] || !(mask.mask[i + dx + dy * mw] & 3)) continue;   // look only across drawn linework
        for (let k = 2; k <= reach + 1; k++) {
          const nx = x + dx * k, ny = y + dy * k;
          if (nx < 1 || ny < 1 || nx >= mw - 1 || ny >= mh - 1) break;
          const j = ny * mw + nx;
          if (region[j]) break;
          if (mask.mask[j] & 3) continue;
          const coarse = ((nx / 6) | 0) * 4096 + ((ny / 6) | 0);
          if (!seenCell.has(coarse)) { seenCell.add(coarse); seeds.push([nx, ny]); }
          break;
        }
      }
    }
    if (first < 0 || !seeds.length) return null;
    const tried = [];
    const step = Math.max(1, Math.floor(seeds.length / 8));
    for (let s = 0; s < seeds.length; s += step) {
      const [nx, ny] = seeds[s];
      if (tried.some((r) => r[ny * mw + nx])) continue;
      const host = floodAtSeed(mask, nx / ws, ny / ws);
      if (host.status !== "ok") continue;
      tried.push(host.region);
      if (host.count < 3 * flood.count) continue;
      const a = analyse(mask, host);
      const fx = first % mw - a.win.x0, fy = ((first / mw) | 0) - a.win.y0;
      if (fx < 0 || fy < 0 || fx >= a.win.w || fy >= a.win.h) continue;
      const g = a.groups.find((q) => q.cells[fy * a.win.w + fx]);
      if (g) return { cells: g.cells, win: a.win };
    }
    return null;
  }

  return {
    /** The sorting of this sheet's linework at a scale (for tests and for looking at what was decided). */
    parts: (upp) => prepare(upp).parts,
    /**
     * What is drawn at a point on a room's outline: "wall" (building linework), "swing" (only a door's swing arc)
     * or "open" (nothing: an opening the fill closed off). Used to leave door openings out of wall base.
     * `reachFt` is how far either side of the point to look; a traced outline sits a little off the wall's face.
     */
    edgeAt(x, y, upp, reachFt = 0.4) {
      if (!(upp > 0) || !geo.segs.length) return "wall";
      const { mask } = prepare(upp);
      const { mw, mh, ws } = mask, mppf = mask.mppf || 0;
      const r = Math.max(2, Math.min(8, Math.round(reachFt * mppf)));
      const cx = Math.round(x * ws), cy = Math.round(y * ws);
      let swing = false;
      for (let yy = Math.max(0, cy - r); yy <= Math.min(mh - 1, cy + r); yy++) for (let xx = Math.max(0, cx - r); xx <= Math.min(mw - 1, cx + r); xx++) {
        const m = mask.mask[yy * mw + xx];
        if (!(m & 3)) continue;
        if ((m & MASK_CURVE_BIT) && !(m & MASK_NODOOR_BIT)) swing = true; else return "wall";
      }
      return swing ? "swing" : "open";
    },
    /**
     * Measures the space around a point.
     * @returns {{ok: false, reason: string} | {ok: true, kind: "room"|"fixture", pointsPx: number[][], areaSf: number, perimeterLf: number, confidence: number|null, note: string|null, ignored: object|null, fixtures: {pointsPx: number[][], areaSf: number}[], withFixtures: {pointsPx: number[][], areaSf: number, perimeterLf: number}|null}}
     */
    roomAt(x, y, upp) {
      if (!(upp > 0)) return { ok: false, reason: "Set the scale for this sheet first." };
      if (!geo.segs.length) return { ok: false, reason: "This sheet is a scan with no drawn linework, so a room cannot be found by clicking. Draw around it instead." };
      const { parts, mask } = prepare(upp);
      const flood = floodAtSeed(mask, x, y);
      if (flood.status === "leak") return { ok: false, reason: "That space isn't enclosed on the drawing: the fill escaped through a gap or an opening. Draw around it instead." };
      if (flood.status !== "ok") return { ok: false, reason: "That landed on dense linework such as hatching or text. Click an open spot inside the room, or draw around it." };

      // A fill that runs round other rooms (the space outside the building, a corridor ringing a core) is traced
      // by its outer edge, which would count everything it surrounds. Say so instead of measuring it.
      const outer = ringArea(traceRegion(flood)) * mask.ws * mask.ws;
      if (outer > flood.count * WRAP_RATIO + 400) return { ok: false, reason: "That space wraps around other rooms (it may be outside the building), so it cannot be measured as one room. Click inside a room, or draw around the area." };

      const fixture = fixtureAround(mask, flood);
      if (fixture) {
        const ring = ringOf(fixture.cells, fixture.win);
        if (ring.length >= 3) {
          const m = measured(ring, upp);
          return { ok: true, kind: "fixture", ...m, confidence: 0.8, note: "That is a cabinet or fixture inside a room, so its own footprint was measured. Click the open floor to measure the room.", ignored: null, fixtures: [], withFixtures: null };
        }
      }

      const a = analyse(mask, flood);
      const ring = ringOf(a.room, a.win);
      if (ring.length < 3) return { ok: false, reason: "That space could not be traced. Draw around it instead." };
      const m = measured(ring, upp);
      const ignored = describeIgnored(parts.items, ring);
      const fixtures = a.groups.map((g) => { const r = ringOf(g.cells, a.win); return r.length >= 3 ? { pointsPx: r, areaSf: round2(ringArea(r) * upp * upp) } : null; }).filter(Boolean);
      let withFixtures = null;
      if (fixtures.length && a.all) { const r = ringOf(a.all, a.win); if (r.length >= 3) withFixtures = measured(r, upp); }
      if (withFixtures && !(withFixtures.areaSf > m.areaSf)) withFixtures = null;
      // OpenTakeoff's own review score for the fill, lowered a little for every thing this file chose to ignore
      // inside the room: each one is a judgement about the drawing, and judgements can be wrong.
      const base = traceConfidence(floodSignals(flood, { areaSF: m.areaSf })).score;
      const confidence = round2(Math.max(0.3, base * (1 - Math.min(0.25, 0.03 * ignored.total))));
      return { ok: true, kind: "room", ...m, confidence, note: ignored.note, ignored: ignored.counts, fixtures: withFixtures ? fixtures : [], withFixtures };
    },
  };
}
