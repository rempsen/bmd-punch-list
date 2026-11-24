// BMD change (new file): finding room tags on a plan from the sheet's own text, for the automatic takeoff.
//
// A room tag is a room number with the room's name written directly above it ("SUITE TYPE A" over "142").
// A sheet is full of other numbers: grid bubbles, door numbers, dimensions, keynotes. So a number counts as a
// room only when a name is drawn with it, or when the room finish schedule has a row for that number and the
// number is lettered at the same size as the sheet's named room tags.
//
// BMD's own code. Positions are image pixels; `spans` are the boxes OpenTakeoff's lib/pageSpans.ts makes from
// the page text ({str, x, y, w, h, rot?}; x, y the top left).

// A room number as lettered on a plan. Anything else (a door tag "D6", a four-figure dimension, "A-134") is a room
// number only when the room finish schedule lists it.
const NUMBER = /^\d{1,3}[A-Z]?$/;
const NAME = /^[A-Z][A-Z0-9 .,'’/&#()-]{1,}$/;
// words that sit beside a number in a table or title block, never over a room
const NOT_A_NAME = new Set(["NUMBER", "NO", "NO.", "NAME", "MARK", "SYMBOL", "CODE", "TYPE", "QTY", "SIZE", "TOTAL", "SHEET", "DATE", "SCALE", "REV", "REVISION", "DESCRIPTION", "REMARKS", "COMMENTS", "DETAIL", "ROOM", "UP", "DN", "DW", "DOWN", "TYP", "TYP."]);

const up = (s) => String(s ?? "").trim().toUpperCase();
/** A room number as it is compared everywhere: capitals, no spaces. */
export const roomKey = (s) => up(s).replace(/\s+/g, "");
const boxOf = (s) => ({ x0: s.x, y0: s.y, x1: s.x + (s.w || 0), y1: s.y + (s.h || 0) });
const upright = (s) => !s.rot;

/**
 * The room tags on a sheet.
 * @param {{str: string, x: number, y: number, w: number, h: number, rot?: number}[]} spans
 * @param {{scheduleNumbers?: Set<string>, bounds?: {x0: number, y0: number, x1: number, y1: number}}} [opts]
 *   `scheduleNumbers`: the room numbers the room finish schedule lists; `bounds`: where the drawing is (text in
 *   the border and title block is left out).
 * @returns {{number: string, name: string, box: {x0: number, y0: number, x1: number, y1: number}, nameBox: object|null, h: number, by: "name"|"schedule"|"name+schedule"}[]}
 */
export function findRoomTags(spans, opts = {}) {
  const sched = opts.scheduleNumbers ?? new Set();
  const b = opts.bounds;
  const list = (spans ?? []).filter((s) => s && typeof s.str === "string" && s.str.trim() && upright(s));
  const isNumber = (s) => NUMBER.test(up(s.str)) || (sched.has(roomKey(s.str)) && /\d/.test(s.str));
  const named = [];
  const bare = [];
  for (const sp of list) {
    if (!isNumber(sp)) continue;
    const box = boxOf(sp);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    if (b && (cx < b.x0 || cx > b.x1 || cy < b.y0 || cy > b.y1)) continue;
    const h = Math.max(sp.h || 0, 4);
    // the name: capitals lettered at the same size, directly above, centred on the number
    let best = null, gap = Infinity;
    for (const c of list) {
      if (c === sp || isNumber(c)) continue;
      const raw = c.str.trim();
      if (/[a-z]/.test(raw) || !NAME.test(up(raw)) || NOT_A_NAME.has(up(raw))) continue;
      const ch = Math.max(c.h || 0, 4);
      if (ch < h * 0.7 || ch > h * 1.45) continue;
      const cb = boxOf(c);
      const dy = box.y0 - cb.y1;
      if (dy < -h * 0.35 || dy > h * 1.6) continue;
      const ccx = (cb.x0 + cb.x1) / 2;
      if (Math.abs(ccx - cx) > Math.max((cb.x1 - cb.x0) / 2, h) + h * 0.5) continue;
      if (dy < gap) { gap = dy; best = c; }
    }
    const key = roomKey(sp.str);
    if (best) named.push({ number: key, name: best.str.trim().replace(/\s+/g, " "), box, nameBox: boxOf(best), h, by: sched.has(key) ? "name+schedule" : "name" });
    else bare.push({ number: key, name: "", box, nameBox: null, h, by: "schedule" });
  }
  // A second line of a name ("STAFF W/C &" over "LOCKERS" over "121") leaves the upper line unused: join it on.
  for (const t of named) {
    const nb = t.nameBox, h = t.h;
    const above = list.find((c) => {
      if (isNumber(c) || /[a-z]/.test(c.str) || !NAME.test(up(c.str)) || NOT_A_NAME.has(up(c.str))) return false;
      const cb = boxOf(c);
      const dy = nb.y0 - cb.y1;
      return dy >= -h * 0.35 && dy <= h * 1.2 && Math.abs((cb.x0 + cb.x1) / 2 - (nb.x0 + nb.x1) / 2) <= h * 1.5 && Math.abs((c.h || h) - h) <= h * 0.3 && !(cb.x0 === nb.x0 && cb.y0 === nb.y0);
    });
    if (above && /[&,/-]$/.test(above.str.trim())) {
      const cb = boxOf(above);
      t.name = `${above.str.trim()} ${t.name}`.replace(/\s+/g, " ");
      t.nameBox = { x0: Math.min(nb.x0, cb.x0), y0: cb.y0, x1: Math.max(nb.x1, cb.x1), y1: nb.y1 };
    }
  }
  // "HEALTH OFFICE" over "1" over "112": the short number is part of the name, and the number under it is the room.
  for (const t of named) {
    if (t.number.length > 1) continue;
    const under = bare.find((c) => {
      const dy = c.box.y0 - t.box.y1;
      return dy >= -t.h * 0.35 && dy <= t.h * 1.6 && Math.abs((c.box.x0 + c.box.x1) / 2 - (t.box.x0 + t.box.x1) / 2) <= t.h * 1.5 && Math.abs(c.h - t.h) <= t.h * 0.3 && c.number.length > 1;
    });
    if (!under) continue;
    bare.splice(bare.indexOf(under), 1);
    t.name = `${t.name} ${t.number}`;
    t.nameBox = { x0: Math.min(t.nameBox.x0, t.box.x0), y0: t.nameBox.y0, x1: Math.max(t.nameBox.x1, t.box.x1), y1: t.box.y1 };
    t.number = under.number;
    t.box = under.box;
    t.by = sched.has(t.number) ? "name+schedule" : "name";
  }
  // Numbers with no name: rooms only when the schedule lists them and they are lettered like the named tags.
  const sizes = named.map((t) => t.h).sort((a, c) => a - c);
  const usual = sizes.length ? sizes[sizes.length >> 1] : 0;
  const out = [...named];
  for (const t of bare) {
    if (!sched.has(t.number) || !/\d{2}/.test(t.number)) continue;
    if (usual && Math.abs(t.h - usual) > usual * 0.3) continue;
    out.push(t);
  }
  // one tag per number and place (text is sometimes drawn twice)
  const seen = new Set();
  return out.filter((t) => {
    const k = `${t.number}@${Math.round(t.box.x0 / 4)},${Math.round(t.box.y0 / 4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Where to try clicking for a tag's room, best first: on the number, then just clear of the tag each way. */
export function seedPoints(tag) {
  const { x0, y0, x1, y1 } = tag.box;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = Math.max(y1 - y0, 4);
  const top = tag.nameBox ? tag.nameBox.y0 : y0;
  const left = tag.nameBox ? Math.min(tag.nameBox.x0, x0) : x0, right = tag.nameBox ? Math.max(tag.nameBox.x1, x1) : x1;
  return [[cx, cy], [cx, y1 + 1.5 * h], [cx, top - 1.5 * h], [left - 1.5 * h, cy], [right + 1.5 * h, cy]];
}

export function pointInRing(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** True when the outline holds the tag: its number, or its name. */
export function ringHoldsTag(ring, tag) {
  const mid = (bx) => [(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2];
  const [nx, ny] = mid(tag.box);
  if (pointInRing(ring, nx, ny)) return true;
  if (!tag.nameBox) return false;
  const [mx, my] = mid(tag.nameBox);
  return pointInRing(ring, mx, my);
}

/**
 * Finish tags printed inside a room's outline ("CPT-1" lettered on the floor), from a list of tags that are
 * known on this job. A tag printed as part of a longer note does not count.
 * @param {{str: string, x: number, y: number, w: number, h: number}[]} spans
 * @param {number[][]} ring
 * @param {string[]} knownTags
 * @returns {string[]} the known tags found, each once, in the order met
 */
export function finishTagsInRoom(spans, ring, knownTags) {
  const flat = (s) => up(s).replace(/[^A-Z0-9]/g, "");
  const known = new Map((knownTags ?? []).map((t) => [flat(t), t]).filter(([k]) => k.length >= 2));
  const found = [];
  for (const s of spans ?? []) {
    const hit = known.get(flat(s.str));
    if (!hit || found.includes(hit)) continue;
    if (pointInRing(ring, s.x + (s.w || 0) / 2, s.y + (s.h || 0) / 2)) found.push(hit);
  }
  return found;
}
