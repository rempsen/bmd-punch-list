// BMD change (new file): wall base from a measured room, for the automatic takeoff.
//
// Base runs along a room's walls and stops at its door openings. A room's outline, as "Click a room" traces it,
// crosses each opening in a straight line where nothing is drawn (the fill closed the opening off), or follows a
// door's swing arc. So the outline is walked in short steps, each step is asked "is there a wall here?", and the
// stretches with no wall are left out.
//
// BMD's own code. Positions are image pixels; `upp` is real feet per image pixel.

const STEP_FT = 0.25;          // how often the outline is sampled
const MIN_OPENING_FT = 1.25;   // shorter gaps are a drafting break at a corner, not an opening
const LEAF_MIN_FT = 2, LEAF_MAX_FT = 4.5;   // a door leaf, and so its swing's radius
const MIN_WALL_FT = 0.75;      // a shorter piece of wall between two gaps is a door frame, part of one opening

const round2 = (n) => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The length of a closed outline, in image pixels. */
export function ringLength(ring) {
  let len = 0;
  for (let i = 0; i < ring.length; i++) len += dist(ring[i], ring[(i + 1) % ring.length]);
  return len;
}

/** How far a point is from an outline, in image pixels (0 on the outline). */
export function distToRing(ring, x, y) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

/** How much of outline `a` (image pixels of its length) runs within `tolPx` of outline `b`: the wall they share. */
export function sharedLength(a, b, tolPx, stepPx) {
  const box = (r) => r.reduce((m, [x, y]) => [Math.min(m[0], x), Math.min(m[1], y), Math.max(m[2], x), Math.max(m[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const A = box(a), B = box(b);
  if (A[0] > B[2] + tolPx || B[0] > A[2] + tolPx || A[1] > B[3] + tolPx || B[1] > A[3] + tolPx) return 0;
  let len = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    const d = dist(p, q), n = Math.max(1, Math.round(d / Math.max(stepPx, 0.5)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (distToRing(b, p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t) <= tolPx) len += d / n;
    }
  }
  return len;
}

/**
 * @param {number[][]} ring the room's outline, image pixels
 * @param {number} upp real feet per image pixel
 * @param {((x: number, y: number) => "wall"|"swing"|"open") | null} edgeAt what is drawn at a point on the outline;
 *   null when that cannot be told (a scanned sheet)
 * @returns {{runs: number[][][], gaps: number[][][], lengthLf: number, perimeterLf: number, openings: number, openingsLf: number, deducted: boolean}}
 *   `runs`: the stretches of wall, each a line of points; `deducted` is false when openings could not be told, and
 *   then there is one run, the whole outline, closed. `gaps`: each opening as the straight line across it.
 */
export function baseRuns(ring, upp, edgeAt) {
  const perimeterPx = ringLength(ring);
  const perimeterLf = round2(perimeterPx * upp);
  const whole = () => ({ runs: [[...ring.map((p) => [p[0], p[1]]), [ring[0][0], ring[0][1]]]], gaps: [], lengthLf: perimeterLf, perimeterLf, openings: 0, openingsLf: 0, deducted: false });
  if (!ring || ring.length < 3 || !(upp > 0)) return { runs: [], gaps: [], lengthLf: 0, perimeterLf: 0, openings: 0, openingsLf: 0, deducted: false };
  if (!edgeAt) return whole();

  // 1. sample the outline: every corner, and points between them a step apart
  const stepPx = STEP_FT / upp;
  const pts = [];   // {p, wall, corner}
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.round(dist(a, b) / stepPx));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], corner: k === 0 });
    }
  }
  const n = pts.length;
  for (const s of pts) { const e = edgeAt(s.p[0], s.p[1]); s.wall = e === "wall"; s.swing = e === "swing"; }
  if (pts.every((s) => s.wall)) return { ...whole(), deducted: true };
  if (pts.every((s) => !s.wall)) return { runs: [], gaps: [], lengthLf: 0, perimeterLf, openings: 1, openingsLf: perimeterLf, deducted: true };

  // 2. tidy: runs are read round the ring starting where a wall begins
  const seg = (i) => dist(pts[i].p, pts[(i + 1) % n].p);   // the length each sample stands for
  let start = 0;
  while (!(pts[start].wall && !pts[(start - 1 + n) % n].wall)) start++;
  const order = Array.from({ length: n }, (_, k) => (start + k) % n);
  const spans = [];   // {wall, from, to (index into order, exclusive), len px}
  for (let k = 0; k < n;) {
    const wall = pts[order[k]].wall;
    let j = k, len = 0;
    while (j < n && pts[order[j]].wall === wall) { len += seg(order[j]); j++; }
    spans.push({ wall, from: k, to: j, len });
    k = j;
  }
  const flip = (minFt, wall) => {
    // a short piece standing between two of the other kind takes their kind
    for (const s of spans) if (s.wall === wall && s.len * upp < minFt) s.wall = !wall;
  };
  flip(MIN_OPENING_FT, false);   // short gaps are wall
  const merged = () => {
    const out = [];
    for (const s of spans) {
      const last = out[out.length - 1];
      if (last && last.wall === s.wall) { last.to = s.to; last.len += s.len; } else out.push({ ...s });
    }
    if (out.length > 1 && out[0].wall === out[out.length - 1].wall) { const tail = out.pop(); out[0] = { wall: tail.wall, from: tail.from - n, to: out[0].to, len: out[0].len + tail.len }; }
    return out;
  };
  let tidy = merged();
  spans.length = 0; spans.push(...tidy);
  flip(MIN_WALL_FT, true);       // a sliver of wall inside an opening is its frame
  tidy = merged();
  if (tidy.length === 1) return tidy[0].wall ? { ...whole(), deducted: true } : { runs: [], gaps: [], lengthLf: 0, perimeterLf, openings: 1, openingsLf: perimeterLf, deducted: true };

  // 3. a door drawn with its leaf and swing: the outline runs out along the leaf and back round the swing. The
  //    swing's centre is the hinge; the opening is the straight line from the hinge to the far jamb, and the leaf
  //    is part of the opening, not wall.
  const P = (k) => pts[order[((k % n) + n) % n]];
  const at = (k) => P(k).p;
  const L = tidy.length;
  for (let gi = 0; gi < L; gi++) {
    const g = tidy[gi];
    if (g.wall) continue;
    let sw = 0;
    for (let k = g.from; k < g.to; k++) if (P(k).swing) sw++;
    if (sw < (g.to - g.from) * 0.6) continue;
    const a = at(g.from), b = at(g.to - 1);
    const reach = Math.round(LEAF_MAX_FT / STEP_FT) + 4;
    let best = null;
    for (const dir of [-1, 1]) for (let d = 1; d <= reach; d++) {
      const k = dir < 0 ? g.from - d : g.to - 1 + d;
      const q = P(k);
      if (!q.corner) continue;
      const r = (dist(q.p, a) + dist(q.p, b)) / 2;
      if (r * upp < LEAF_MIN_FT || r * upp > LEAF_MAX_FT) continue;
      let dev = 0;
      for (let j = g.from; j < g.to; j++) dev = Math.max(dev, Math.abs(dist(q.p, at(j)) - r));
      if (dev <= r * 0.12 && (!best || dev < best.dev)) best = { k, dir, r, dev };
    }
    if (!best) continue;
    const prev = tidy[(gi - 1 + L) % L], next = tidy[(gi + 1) % L];
    const hinge = at(best.k);
    const onArc = (k) => P(k).corner && Math.abs(dist(hinge, at(k)) - best.r) <= best.r * 0.12;
    let from = g.from, to = g.to;
    if (best.dir < 0) {
      from = best.k;
      for (let k = g.to; k <= g.to + 4; k++) if (onArc(k)) { to = k; break; }
    } else {
      to = best.k;
      for (let k = g.from - 1; k >= g.from - 4; k--) if (onArc(k)) { from = k; break; }
    }
    if (prev !== g && prev.wall) prev.to += from - g.from;
    if (next !== g && next.wall) next.from += to - g.to;
    g.from = from; g.to = to; g.straight = true;
  }
  const lenOf = (s) => { let l = 0; for (let k = s.from; k < s.to; k++) l += seg(order[((k % n) + n) % n]); return l; };

  // 4. the wall stretches as lines: their two ends, and the outline's corners between
  const runs = [], gaps = [];
  let wallPx = 0, openPx = 0, openings = 0;
  for (const s of tidy) {
    if (s.wall && s.to <= s.from) continue;   // a wall that was all door leaf
    s.len = s.straight ? dist(at(s.from), at(s.to)) : lenOf(s);
    if (!s.wall) {
      openings++; openPx += s.len;
      // the opening as the straight line across it (a swing arc is spanned, not followed)
      const a = at(s.from), b = at(s.to);
      gaps.push([[round2(a[0]), round2(a[1])], [round2(b[0]), round2(b[1])]]);
      continue;
    }
    wallPx += s.len;
    const line = [];
    for (let k = s.from; k < s.to; k++) {
      const q = pts[order[((k % n) + n) % n]];
      if (k === s.from || q.corner) line.push([round2(q.p[0]), round2(q.p[1])]);
    }
    const end = pts[order[((s.to % n) + n) % n]].p;   // where the next stretch begins
    line.push([round2(end[0]), round2(end[1])]);
    if (line.length >= 2) runs.push(line);
  }
  return { runs, gaps, lengthLf: round2(wallPx * upp), perimeterLf, openings, openingsLf: round2(openPx * upp), deducted: true };
}
