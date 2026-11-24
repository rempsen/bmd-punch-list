// BMD change (new file): reading a room finish schedule (room number → floor finish, base finish, printed area)
// for the automatic takeoff, and matching the codes it uses to the finishes on the job.
//
// OpenTakeoff has its own schedule reader (lib/sheetgraph.ts) and the automatic takeoff asks it first. It does not
// read every layout: a schedule exported from Revit with two header lines ("Floor" over "Finish") and two tables
// side by side comes back with its rows mixed up. This reader handles that plain case and nothing cleverer: it
// finds the Room, Floor and Base column headings, and reads each room's line under them by position.
//
// BMD's own code. `spans` are OpenTakeoff's page spans ({str, x, y, w, h}; x, y the top left, image pixels).
import { roomKey } from "./roomTags.js";

const up = (s) => String(s ?? "").trim().toUpperCase();
const mid = (s) => s.x + (s.w || 0) / 2;
const midY = (s) => s.y + (s.h || 0) / 2;
const ROOM_NO = /^[A-Z]{0,2}-?\d{1,4}[A-Z]?$/;
const AREA = /^([\d,]+(?:\.\d+)?)\s*(SF|S\.F\.|SQ\.?\s*FT\.?|FT2|M2|SM|M²)$/i;
// what a cell says when the room has no such finish
const NOTHING = /^(N\/?A|NONE|-+|—|–|N\.?I\.?C\.?|EXIST(ING)?\.?|MANUF\.?|BY OTHERS)?$/i;

/** The finish a schedule cell names, or "" when it names none ("N/A", "-", "MANUF."). */
export function cellFinish(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  return NOTHING.test(t) ? "" : t;
}

/**
 * The room finish schedules on a sheet.
 * @returns {{rows: {number: string, name: string, floor: string, base: string, areaSf: number|null}[], tables: number}}
 */
export function readRoomSchedule(spans) {
  const list = (spans ?? []).filter((s) => s && typeof s.str === "string" && s.str.trim() && !s.rot);
  const rows = [];
  let tables = 0;
  const floors = list.filter((s) => /^FLOOR(ING)?\b/.test(up(s.str)) && up(s.str).length <= 16);
  for (const floor of floors) {
    const h = Math.max(floor.h || 0, 6);
    const line = list.filter((s) => Math.abs(midY(s) - midY(floor)) <= h * 0.8).sort((a, b) => a.x - b.x);
    const at = line.indexOf(floor);
    const base = line.slice(at + 1).find((s) => /^BASE\b/.test(up(s.str)));
    // the room column: the nearest "Room" / "No." / "#" heading to the left
    const room = line.slice(0, at).reverse().find((s) => /^(ROOM|RM\.?|NO\.?|NUMBER|#)\b/.test(up(s.str)) || up(s.str) === "#");
    if (!base || !room) continue;
    const before = line[line.indexOf(room) - 1], afterRoom = line[line.indexOf(room) + 1];
    const prevFloor = line[at - 1], afterBase = line[line.indexOf(base) + 1];
    const half = (a, b) => (mid(a) + mid(b)) / 2;
    const band = {
      room: [Math.max(before ? half(before, room) : -Infinity, room.x - 6 * h), half(room, afterRoom)],
      floor: [half(prevFloor, floor), half(floor, base)],
      base: [half(floor, base), afterBase ? half(base, afterBase) : mid(base) + (mid(base) - mid(floor)) / 2],
    };
    // another table beside this one ends this one's lines
    const inBand = (s, [a, b]) => mid(s) >= a && mid(s) < b;
    const below = list.filter((s) => s.y > floor.y + h * 0.5);
    // a room's number is the first thing on its line in the room column
    const inRoom = below.filter((s) => s.x >= band.room[0] && mid(s) < band.room[1]);
    const keys = inRoom.filter((s) => ROOM_NO.test(up(s.str)) && /\d/.test(s.str) && !inRoom.some((o) => o !== s && o.x < s.x && Math.abs(midY(o) - midY(s)) <= Math.max(s.h || 0, 6) * 0.55)).sort((a, b) => a.y - b.y);
    if (!keys.length) continue;
    let made = 0;
    for (const key of keys) {
      const kh = Math.max(key.h || 0, 6);
      const same = below.filter((s) => s !== key && Math.abs(midY(s) - midY(key)) <= kh * 0.55);
      const cell = (b) => same.filter((s) => inBand(s, b)).sort((a, c) => a.x - c.x).map((s) => s.str.trim()).join(" ");
      const names = same.filter((s) => s.x > key.x && mid(s) < band.room[1] && !AREA.test(s.str.trim())).sort((a, c) => a.x - c.x);
      let name = names.map((s) => s.str.trim()).join(" ");
      // a name that runs onto a second line ("STAFF W/C &" then "LOCKERS")
      if (names.length && /[&,/-]$/.test(name)) {
        const first = names[0];
        const next = below.find((s) => Math.abs(s.x - first.x) <= kh * 0.5 && s.y > first.y + kh * 0.5 && s.y < first.y + kh * 2.4 && !ROOM_NO.test(up(s.str)));
        if (next) name = `${name} ${next.str.trim()}`;
      }
      const floorText = cellFinish(cell(band.floor)), baseText = cellFinish(cell(band.base));
      const areaSpan = same.find((s) => AREA.test(s.str.trim()) && s.x > key.x && s.x < floor.x + (floor.w || 0));
      const m = areaSpan ? AREA.exec(areaSpan.str.trim()) : null;
      const areaSf = m && /F/i.test(m[2]) ? Number(m[1].replace(/,/g, "")) : null;
      if (!floorText && !baseText && !name) continue;
      rows.push({ number: roomKey(key.str), name: name.replace(/\s+/g, " "), floor: floorText, base: baseText, areaSf: Number.isFinite(areaSf) ? areaSf : null });
      made++;
    }
    if (made) tables++;
  }
  return { rows, tables };
}

const words = (s) => up(s).replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
/** True when a plan's room name and a schedule's are the same room: one's words all appear in the other. */
export function sameRoomName(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return false;
  const [few, many] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return few.every((w) => many.includes(w));
}

/**
 * The schedule row for a room tag. A number the schedule lists once is that row. A number it lists more than once
 * (corridor 4 and coat closet 4) is settled by the name; if the name does not settle it, there is no answer.
 * @returns {{row: object|null, why: string}}
 */
export function scheduleRowFor(rows, tag) {
  const mine = (rows ?? []).filter((r) => r.number === roomKey(tag.number));
  if (!mine.length) return { row: null, why: `The room finish schedule has no row for ${tag.number}.` };
  if (mine.length === 1) return { row: mine[0], why: "" };
  const byName = mine.filter((r) => tag.name && sameRoomName(r.name, tag.name));
  if (byName.length === 1) return { row: byName[0], why: "" };
  // identical rows are one answer
  const same = (byName.length ? byName : mine).every((r, _, all) => r.floor === all[0].floor && r.base === all[0].base);
  if (same && byName.length) return { row: byName[0], why: "" };
  return { row: null, why: `The room finish schedule lists ${tag.number} ${mine.length} times with different finishes.` };
}

const flat = (s) => up(s).replace(/[^A-Z0-9]/g, "");

/**
 * Which finish on the job a code from the drawings means.
 *   "exact": the same tag, punctuation aside ("LVT 1" is LVT-1);
 *   "like":  the code has no number and exactly one finish on the job starts with it ("CPT" → CPT-1, the only CPT);
 *   "new":   nothing on the job matches. The code is kept as written and becomes a finish only when a person
 *            accepts a measurement that uses it.
 * @param {string} code
 * @param {{id: string, finish_tag: string}[]} conditions
 * @returns {{how: "exact"|"like"|"new", conditionId: string|null, tag: string}}
 */
export function matchFinish(code, conditions) {
  const want = flat(code);
  const list = (conditions ?? []).filter((c) => c && c.id && flat(c.finish_tag));
  const exact = list.find((c) => flat(c.finish_tag) === want);
  if (exact) return { how: "exact", conditionId: exact.id, tag: exact.finish_tag };
  if (want && !/\d/.test(want)) {
    const like = list.filter((c) => { const f = flat(c.finish_tag); return f.startsWith(want) && /^\d+[A-Z]?$/.test(f.slice(want.length)); });
    const distinct = new Set(like.map((c) => flat(c.finish_tag)));
    if (distinct.size === 1) return { how: "like", conditionId: like[0].id, tag: like[0].finish_tag };
  }
  return { how: "new", conditionId: null, tag: String(code ?? "").replace(/\s+/g, " ").trim() };
}
