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
const MIN_WALL_FT = 0.75;      // a shorter piece of wall between two gaps is a door frame, part of one opening

const round2 = (n) => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The length of a closed outline, in image pixels. */
export function ringLength(ring) {
  let len = 0;
  for (let i = 0; i < ring.length; i++) len += dist(ring[i], ring[(i + 1) % ring.length]);
  return len;
}

/**
 * @param {number[][]} ring the room's outline, image pixels
 * @param {number} upp real feet per image pixel
 * @param {((x: number, y: number) => "wall"|"swing"|"open") | null} edgeAt what is drawn at a point on the outline;
 *   null when that cannot be told (a scanned sheet)
 * @returns {{runs: number[][][], lengthLf: number, perimeterLf: number, openings: number, openingsLf: number, deducted: boolean}}
 *   `runs`: the stretches of wall, each a line of points; `deducted` is false when openings could not be told, and
 *   then there is one run, the whole outline, closed.
 */
export function baseRuns(ring, upp, edgeAt) {
  const perimeterPx = ringLength(ring);
  const perimeterLf = round2(perimeterPx * upp);
  const whole = () => ({ runs: [[...ring.map((p) => [p[0], p[1]]), [ring[0][0], ring[0][1]]]], lengthLf: perimeterLf, perimeterLf, openings: 0, openingsLf: 0, deducted: false });
  if (!ring || ring.length < 3 || !(upp > 0)) return { runs: [], lengthLf: 0, perimeterLf: 0, openings: 0, openingsLf: 0, deducted: false };
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
  for (const s of pts) s.wall = edgeAt(s.p[0], s.p[1]) === "wall";
  if (pts.every((s) => s.wall)) return { ...whole(), deducted: true };
  if (pts.every((s) => !s.wall)) return { runs: [], lengthLf: 0, perimeterLf, openings: 1, openingsLf: perimeterLf, deducted: true };

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
  if (tidy.length === 1) return tidy[0].wall ? { ...whole(), deducted: true } : { runs: [], lengthLf: 0, perimeterLf, openings: 1, openingsLf: perimeterLf, deducted: true };

  // 3. the wall stretches as lines: their two ends, and the outline's corners between
  const runs = [];
  let wallPx = 0, openPx = 0, openings = 0;
  for (const s of tidy) {
    if (!s.wall) { openings++; openPx += s.len; continue; }
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
  return { runs, lengthLf: round2(wallPx * upp), perimeterLf, openings, openingsLf: round2(openPx * upp), deducted: true };
}
