// BMD change (new file): the automatic takeoff. BMD's own code.
//
// The measuring is done by OpenTakeoff's engine from the drawing's real linework ("Click a room", through
// ./engine.js). This file only decides WHERE to click and WHAT each room is: it finds the room tags in the sheet's
// text, clicks beside each one, looks the room up in the room finish schedule, and writes what it found as
// proposals. Nothing here calls an AI; an AI helper may be handed in (`decide`) for the rooms the drawing leaves
// without a finish, and the run is the same without it.
//
// Everything made here is a proposal: origin.method "auto_v1", origin.reviewed false. Proposals are not counted
// in totals and do not reach the estimate (./quantities.js) until a person accepts them (./autoReview.js).
import { computeShapeMetrics } from "../shapeMetrics.js";
import { scaleFor, setScale } from "./takeoffDoc.js";
import { findRoomNames, findRoomTags, finishTagsInRoom, pointInRing, ringHoldsTag, roomKey, seedPoints } from "./roomTags.js";
import { distToRing, sharedLength } from "./baseFromRoom.js";
import { AREA_GROUPS, areaGroup, areaSection } from "./areaSection.js";

export { AREA_GROUPS, areaGroup, areaSection };
import { matchFinish, scheduleRowFor } from "./roomSchedule.js";

export const METHOD = "auto_v1";
/** The honest limits, shown wherever proposals are reviewed. */
export const LIMITS = "Automatic takeoff is strongest on drawings exported from CAD, where it measures to the real linework. On scanned or photographed sheets it cannot find rooms by their walls, and much more will need correcting. It does not use models trained on BMD's trade. Check every outline before you accept it.";

export const LIMITS_SHORT = "Strongest on drawings exported from CAD; scanned sheets need much more correcting. Check every outline before you accept it.";

const WALL_FT = 1.5;   // two outlines this close are either side of one wall
const TRANSITION_TAG = /^(TR|TS|TRANS|TRANSITION|T-?STRIP|T-?MOLD|REDUCER|RD)[ -]?\d*[A-Z]?$/i;

const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n) => round2(Math.max(0.05, Math.min(0.97, n)));

// ── which sheets ─────────────────────────────────────────────────────────────────────────────────────────────

const NOT_FLOOR = /\b(CEILING|REFLECTED|RCP|ROOF|FURNITURE|DEMOLITION|DEMO|SITE|FRAMING|FOUNDATION|ELECTRICAL|LIGHTING|POWER|MECHANICAL|PLUMBING|DUCTWORK|PIPING|SPRINKLER|HVAC|EQUIPMENT|LIFE SAFETY|PAINT|SIGNAGE|LANDSCAPE)\b/;
const FLOOR_PLAN = /\b(FLOOR|FINISH|FINISHES|FLOORING|LEVEL|STOREY|STORY|BASEMENT|MEZZANINE|PENTHOUSE)\b.*\bPLANS?\b|\bPLANS?\b.*\b(FLOOR|FINISH|LEVEL)\b/;

/**
 * Whether a sheet is ticked when the run panel opens, and why, in plain words.
 * @param {{title?: string|null, role?: string|null, roomTags?: number}} s `title`: the plan title the engine read
 *   off the sheet; `role`: the engine's reading of what the sheet is; `roomTags`: how many room tags its text holds
 * @returns {{ticked: boolean, why: string}}
 */
export function sheetChoice({ title = "", role = null, roomTags = 0 } = {}) {
  const t = String(title ?? "").toUpperCase();
  const n = roomTags || 0;
  if (NOT_FLOOR.test(t)) return { ticked: false, why: `${words(t)}: not a floor finish plan` };
  if (role === "plan" && (FLOOR_PLAN.test(t) || !t)) {
    if (n >= 3) return { ticked: true, why: `Floor plan with ${n} room tags` };
    return { ticked: false, why: n ? `Floor plan, but only ${n} room tag${n === 1 ? "" : "s"} found` : "Floor plan, but no room tags found" };
  }
  if (role === "plan") return { ticked: false, why: n >= 3 ? `A plan with ${n} room tags, but not titled as a floor plan` : "Not a floor plan" };
  if (role === "schedule" || role === "legend") return { ticked: false, why: "Schedule or legend: read for finishes, not measured" };
  return { ticked: false, why: n >= 3 ? `${n} room tags, but not titled as a floor plan` : "Not a floor plan" };
}
const words = (t) => { const s = t.replace(/[^A-Z0-9 /&.-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40); return s ? s.charAt(0) + s.slice(1).toLowerCase() : "This sheet"; };

// ── which schedule reading to trust ──────────────────────────────────────────────────────────────────────────

const SANE_NUMBER = /^[A-Z]{0,2}-?\d{1,4}[A-Z]?$/;
const saneRow = (r) => r && SANE_NUMBER.test(roomKey(r.number)) && typeof r.floor === "string" && r.floor.length > 0 && r.floor.length <= 14 && !/\d+\s*SF/i.test(r.floor);

/**
 * OpenTakeoff's schedule reader is asked first; BMD's plain reader second. Whichever read more rows that look like
 * a room and its floor finish is used. A reader whose rows are jumbled (a key like "839SF") counts for nothing.
 * @returns {{rows: object[], reader: "OpenTakeoff"|"BMD"|null}}
 */
export function pickScheduleRows(engineRows, bmdRows) {
  const a = (engineRows ?? []).filter(saneRow), b = (bmdRows ?? []).filter(saneRow);
  if (!a.length && !b.length) return { rows: [], reader: null };
  return a.length >= b.length ? { rows: a, reader: "OpenTakeoff" } : { rows: b, reader: "BMD" };
}

// ── one sheet ────────────────────────────────────────────────────────────────────────────────────────────────

const ringPx = (shape, dims) => (shape.verts_norm || []).map(([x, y]) => [x * dims.w, y * dims.h]);

function proposal(doc, { sheetId, role, pointsPx, dims, upp, cond, label, origin }) {
  const shape = {
    id: uid("shp"),
    sheet_id: sheetId,
    condition_id: cond?.id ?? null,
    measure_role: role,
    verts_norm: pointsPx.map(([x, y]) => [x / dims.w, y / dims.h]),
    created_at: origin.proposed_ts,
    origin,
  };
  if (label) shape.label = label;
  shape.computed = computeShapeMetrics(shape, dims, upp, cond);
  return shape;
}

/** The finish a proposal carries: a finish already on the job (`cond`), or a code from the drawings to add on accept. */
function finishFor(code, conditions) {
  const m = matchFinish(code, conditions);
  return { cond: m.conditionId ? conditions.find((c) => c.id === m.conditionId) : null, tag: m.tag, how: m.how };
}

/**
 * Runs the automatic takeoff on one sheet.
 * @param {object} a
 * @param {object} a.doc the takeoff document
 * @param {{key: string, label: string}} a.sheet
 * @param {{dims: {w: number, h: number}, detectedScale: Function, hasLinework: Function, roomAt: Function, baseAlong: Function}} a.engine ./engine.js for this sheet
 * @param {object[]} a.spans the sheet's text (OpenTakeoff page spans)
 * @param {{rows: object[], reader: string|null}} [a.schedule] the room finish schedule read from the set
 * @param {Map<string, string>} [a.takenRooms] room number → the sheet it was already measured on in this run; added to
 * @param {string} [a.runId]
 * @param {() => string} [a.now]
 * @param {(p: {sheet: string, found: number, done: number, text: string}) => void} [a.onProgress]
 * @param {() => boolean} [a.shouldStop]
 * @param {() => Promise<void>} [a.pause] lets the screen draw between rooms
 * @param {(doc: object) => void} [a.onDoc] called now and then with what has been proposed so far
 * @returns {Promise<{doc: object, report: object}>}
 */
export async function runSheet({ doc, sheet, engine, spans, schedule = { rows: [], reader: null }, takenRooms = new Map(), runId = uid("run"), now = () => new Date().toISOString(), onProgress = () => {}, shouldStop = () => false, pause = async () => {}, onDoc = () => {} }) {
  const started = Date.now();
  const dims = engine.dims;
  const report = {
    sheet: sheet.key, label: sheet.label, skipped: null, stopped: false, scale: null, tags: 0, measured: 0, already: 0, otherSheet: 0, sameOutline: 0,
    notMeasured: [], assigned: { schedule: 0, tag: 0, ai: 0, none: 0 }, newFinishes: [], base: { rooms: 0, lf: 0, notDeducted: 0, byGroup: { suite: 0, common: 0, washroom: 0 } }, inside: { rooms: 0, sf: 0 }, transitions: { count: 0, lf: 0 }, sf: 0, scheduleReader: schedule.reader, scaleDoubt: null, unassigned: [], ms: 0,
  };
  const done = (d) => { report.ms = Date.now() - started; return { doc: d, report }; };
  const say = (found, at, text) => onProgress({ sheet: sheet.label, found, done: at, text });

  // 1. the scale: the one saved for the sheet, else the one written on it. Never a guess.
  let scale = scaleFor(doc, sheet.key);
  if (scale) report.scale = { upp: scale.upp, source: "saved" };
  else {
    const d = await engine.detectedScale();
    if (!d) { report.skipped = `No scale could be read on ${sheet.label}; set it and run again.`; return done(doc); }
    if (d.multi) { report.skipped = `More than one scale is written on ${sheet.label} (${d.label} is one of them); set the right one and run again.`; return done(doc); }
    doc = setScale(doc, sheet.key, d.upp, "detected", dims);
    scale = scaleFor(doc, sheet.key);
    report.scale = { upp: d.upp, source: "sheet", label: d.label };
  }
  const upp = scale.upp;
  if (!(await engine.hasLinework())) { report.skipped = `${sheet.label} is a scan with no drawn linework, so rooms cannot be measured to their walls. Draw around them by hand.`; return done(doc); }

  // 2. the room tags
  const inset = 0.03;
  const tags = findRoomTags(spans, { scheduleNumbers: new Set(schedule.rows.map((r) => r.number)), bounds: { x0: dims.w * inset, y0: dims.h * inset, x1: dims.w * (1 - inset), y1: dims.h * (1 - inset) } });
  report.tags = tags.length;
  if (!tags.length) { report.skipped = `No room tags (a room name with its number) were found in the text of ${sheet.label}.`; return done(doc); }
  say(tags.length, 0, `${sheet.label}: found ${tags.length} rooms`);

  const here = (doc.shapes || []).filter((s) => s.sheet_id === sheet.key && s.measure_role === "floor_area").map((s) => ringPx(s, dims)).filter((r) => r.length >= 3);
  const made = [];        // {tag, ring, floor shape, row}
  const ratios = [];
  const ts = now();
  let shapes = [];
  // the finish tags a room may be lettered with: the job's own first, then the schedule's codes, each once
  const knownTags = [];
  for (const tg of [...(doc.conditions || []).map((c) => c.finish_tag), ...schedule.rows.flatMap((r) => [r.floor, r.base])]) {
    const f = String(tg ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (f && !knownTags.some((k) => k.toUpperCase().replace(/[^A-Z0-9]/g, "") === f)) knownTags.push(tg);
  }

  // Base is measured for every room, whatever its finish: the quantity is the takeoff, and which areas take which
  // base (or none) is the person's choice afterwards, by area: suites, common areas, washrooms.
  const proposeBase = async (m, { code, source, group, section }) => {
    const b = await engine.baseAlong(m.ring, upp);
    m.gaps = b.deducted ? b.gaps ?? [] : [];
    if (!b.runs.length) return;
    const fin = code ? finishFor(code, doc.conditions || []) : null;
    const bnotes = [b.deducted ? (b.openings ? `${b.openings} door opening${b.openings === 1 ? "" : "s"} (${fmt(b.openingsLf)} LF) left out of ${fmt(b.perimeterLf)} LF around the room.` : `No door openings could be told on this room's outline, so this is all ${fmt(b.perimeterLf)} LF around it.`) : "Openings not deducted: this is the full perimeter."];
    const bwhy = fin
      ? `${source}: base ${code}.${fin.how === "like" ? ` ${fin.tag} is the only ${code} finish on this job.` : fin.how === "new" ? ` ${code} is not a finish on this job yet; it is added when you accept.` : ""}`
      : `${source ? `${source} gives no base for this room` : schedule.rows.length ? "The room finish schedule has no row for this room, so it gives no base for it" : "No room finish schedule was read, so nothing gives a base finish"}. The base is measured; choose what it takes, or leave it out.`;
    m.baseFactor = b.deducted && b.openings ? 0.95 : 0.8;
    for (const line of b.runs) {
      m.base.push(proposal(doc, { sheetId: sheet.key, role: "linear", pointsPx: line, dims, upp, cond: fin?.cond ?? null, label: m.name, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: m.floor.origin.confidence, proposed_ts: ts, auto: { run: runId, kind: "base", of: m.floor.id, room: m.tag.number, name: m.tag.name, group, section, from: fin ? "schedule" : "none", why: bwhy, notes: bnotes, openings: b.openings, openings_deducted: b.deducted && b.openings > 0, ...(fin && !fin.cond ? { finish_tag: fin.tag } : {}) } } }));
    }
    shapes.push(...m.base);
    report.base.rooms++;
    report.base.lf = round2(report.base.lf + b.lengthLf);
    report.base.byGroup[group] = round2(report.base.byGroup[group] + b.lengthLf);
    if (!(b.deducted && b.openings > 0)) report.base.notDeducted++;
    if (fin?.how === "new" && !report.newFinishes.includes(fin.tag)) report.newFinishes.push(fin.tag);
  };

  for (let i = 0; i < tags.length; i++) {
    if (shouldStop()) { report.stopped = true; break; }
    const tag = tags[i];
    const name = `${tag.number}${tag.name ? ` ${tag.name}` : ""}`;
    say(tags.length, i + 1, `${sheet.label}: found ${tags.length} rooms, measuring ${i + 1} of ${tags.length}`);
    const seeds = seedPoints(tag);
    const mid = seeds[0];
    // already measured, by hand or by an earlier run: left alone
    if (here.some((r) => pointInRing(r, mid[0], mid[1]))) { report.already++; continue; }
    const other = takenRooms.get(tag.number);
    if (other && other !== sheet.label) { report.otherSheet++; continue; }
    // the same outline reached from a second tag is one room, not two
    const twin = made.find((m) => ringHoldsTag(m.ring, tag));
    if (twin) {
      report.sameOutline++;
      const o = twin.floor.origin;
      o.auto.also = [...(o.auto.also || []), name];
      o.auto.notes = [...o.auto.notes.filter((n) => !n.startsWith("The tags ")), `The tags ${[twin.name, ...o.auto.also].join(" and ")} are inside this one outline: no wall was found between them.`];
      twin.shared = true;
      continue;
    }
    let got = null, why = "";
    for (const [x, y] of seeds) {
      if (x < 0 || y < 0 || x > dims.w || y > dims.h) continue;
      const r = await engine.roomAt(x, y, upp);
      if (!r.ok) { why ||= r.reason; continue; }
      if (r.kind !== "room" || !ringHoldsTag(r.pointsPx, tag)) { why ||= "The space found beside the tag was not the room the tag sits in."; continue; }
      got = { r, seed: [x, y] };
      break;
    }
    if (!got) { report.notMeasured.push({ room: name, why: why || "The room could not be traced." }); await pause(); continue; }
    const { r, seed } = got;

    // 3. which finish
    const notes = [];
    let conf = r.confidence ?? 0.7;
    let from = "none", whyFinish = "", floorFinish = null;
    const found = scheduleRowFor(schedule.rows, tag);
    const row = found.row;
    if (row?.floor) {
      floorFinish = finishFor(row.floor, doc.conditions || []);
      from = "schedule";
      whyFinish = `Room finish schedule, row ${row.number}${row.name ? ` ${row.name}` : ""}: floor ${row.floor}.`;
      if (floorFinish.how === "like") { whyFinish += ` ${floorFinish.tag} is the only ${row.floor} finish on this job.`; conf *= 0.95; }
      if (floorFinish.how === "new") whyFinish += ` ${row.floor} is not a finish on this job yet; it is added when you accept.`;
    } else {
      const inRoom = finishTagsInRoom(spans, r.pointsPx, knownTags);
      if (inRoom.length === 1) {
        floorFinish = finishFor(inRoom[0], doc.conditions || []);
        from = "tag";
        whyFinish = `${inRoom[0]} is lettered inside this room.`;
        conf *= 0.9;
      } else {
        whyFinish = inRoom.length > 1 ? `${inRoom.join(" and ")} are both lettered in this room, so the floor finish was not chosen.` : row ? `The room finish schedule's row ${row.number} gives no floor finish.` : schedule.rows.length ? found.why : "No room finish schedule was read, and no finish tag is lettered in this room.";
        conf = Math.min(conf, 0.4);
      }
    }
    report.assigned[from]++;
    if (floorFinish?.how === "new" && !report.newFinishes.includes(floorFinish.tag)) report.newFinishes.push(floorFinish.tag);

    // the schedule's printed area is a second opinion on the outline; it is weighed once the whole sheet is in (step 5)
    const printed = row?.areaSf > 0 && r.areaSf > 0 ? { measured: r.areaSf, printed: row.areaSf, ratio: r.areaSf / row.areaSf } : null;
    if (r.note) notes.push(r.note);
    if (r.fixtures?.length) notes.push(`${r.fixtures.length === 1 ? "1 area under a cabinet or fixture was" : `${r.fixtures.length} areas under cabinets or fixtures were`} left out (${fmt(round2((r.withFixtures?.areaSf ?? r.areaSf) - r.areaSf))} SF).`);

    const auto = { run: runId, kind: "floor", room: tag.number, name: tag.name, group: areaGroup(tag.name), section: areaSection(areaGroup(tag.name), tag.name), from, why: whyFinish, notes, ...(floorFinish && !floorFinish.cond ? { finish_tag: floorFinish.tag } : {}), ...(row?.areaSf ? { schedule_sf: row.areaSf } : {}) };
    const floor = proposal(doc, { sheetId: sheet.key, role: "floor_area", pointsPx: r.pointsPx, dims, upp, cond: floorFinish?.cond ?? null, label: name, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: clamp(conf), seed_norm: [seed[0] / dims.w, seed[1] / dims.h], proposed_ts: ts, auto } });
    shapes.push(floor);
    const mine = { tag, name, ring: r.pointsPx, floor, row, printed, conf, base: [], baseFactor: 1, inside: 0, insideSf: 0, gaps: null };
    made.push(mine);
    takenRooms.set(tag.number, sheet.label);
    report.measured++;
    report.sf = round2(report.sf + r.areaSf);
    if (from === "none") report.unassigned.push({ shapeId: floor.id, room: tag.number, name: tag.name, texts: textsIn(spans, r.pointsPx), row: row ?? null });

    // 4. base: along the walls of every room, door openings left out where the drawing shows them
    await proposeBase(mine, { code: row?.base ?? null, source: row ? `Room finish schedule, row ${row.number}` : null, group: areaGroup(tag.name), section: areaSection(areaGroup(tag.name), tag.name) });
    if (made.length % 8 === 0) onDoc(withShapes(doc, shapes));   // ratings are settled at the end of the sheet
    await pause();
  }

  // 4b. spaces inside a tagged room that carry only a name (the bedrooms, bathroom and closets of a suite).
  //     "Click a room" stops at the suite's inner walls, so its tag measures only the room the tag sits in. Each
  //     lettered name in a space nobody has measured is clicked too, and belongs to the tagged room it shares the
  //     most wall with. Its finish is never assumed from the suite's row.
  const wallPx = WALL_FT / upp, stepPx = 0.5 / upp;
  const centre = (bx) => [(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2];
  const tagged = made.slice();
  if (!report.stopped && tagged.length) {
    const names = findRoomNames(spans, { tags, bounds: { x0: dims.w * inset, y0: dims.h * inset, x1: dims.w * (1 - inset), y1: dims.h * (1 - inset) } }).slice(0, Math.max(40, tags.length * 4));
    for (const nm of names) {
      if (shouldStop()) { report.stopped = true; break; }
      const [cx, cy] = centre(nm.box);
      if (here.some((r) => pointInRing(r, cx, cy)) || made.some((m) => pointInRing(m.ring, cx, cy))) continue;
      const r = await engine.roomAt(cx, cy, upp);
      if (!r.ok || r.kind !== "room" || !pointInRing(r.pointsPx, cx, cy)) { await pause(); continue; }
      if (tags.some((tg) => ringHoldsTag(r.pointsPx, tg))) continue;   // a tagged room that could not be measured from its tag: not a space inside another
      let parent = null, most = 0;
      for (const m of tagged) {
        const len = sharedLength(r.pointsPx, m.ring, wallPx, stepPx);
        if (len > most) { most = len; parent = m; }
      }
      if (!parent || most * upp < 2) continue;
      if (parent.printed && parent.printed.measured + parent.insideSf + r.areaSf > parent.printed.printed * 1.35) continue;   // more than the suite is printed to hold
      const inRoom = finishTagsInRoom(spans, r.pointsPx, knownTags);
      const fin = inRoom.length === 1 ? finishFor(inRoom[0], doc.conditions || []) : null;
      const suite = `${parent.tag.number}${parent.tag.name ? ` ${parent.tag.name}` : ""}`;
      const label = `${parent.tag.number} ${nm.name}`;
      const why = `A space inside ${suite}, found by its name on the drawing. ${fin ? `${inRoom[0]} is lettered inside it.` : inRoom.length > 1 ? `${inRoom.join(" and ")} are both lettered in it, so its finish was not chosen.` : `${parent.row?.floor ? `The schedule gives ${suite} floor ${parent.row.floor}; a bathroom or closet often differs` : "No finish is lettered in it"}, so choose its finish.`}`;
      const from = fin ? "tag" : "none";
      const conf = Math.min(r.confidence ?? 0.7, fin ? 0.6 : 0.5);
      const notes = r.note ? [r.note] : [];
      const group = areaGroup(nm.name, parent.tag.name), section = areaSection(group, parent.tag.name);
      const auto = { run: runId, kind: "inside", room: parent.tag.number, name: nm.name, group, section, of: parent.floor.id, from, why, notes, ...(fin && !fin.cond ? { finish_tag: fin.tag } : {}) };
      const floor = proposal(doc, { sheetId: sheet.key, role: "floor_area", pointsPx: r.pointsPx, dims, upp, cond: fin?.cond ?? null, label, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: clamp(conf), seed_norm: [cx / dims.w, cy / dims.h], proposed_ts: ts, auto } });
      shapes.push(floor);
      const sub = { tag: { number: parent.tag.number, name: nm.name }, name: label, ring: r.pointsPx, floor, row: null, printed: null, conf, base: [], baseFactor: 1, inside: 0, insideSf: 0, gaps: null, sub: true };
      made.push(sub);
      // its base: a washroom's is never assumed; any other space inside takes the base of the room it is part of
      await proposeBase(sub, { code: group === "washroom" ? null : parent.row?.base ?? null, source: parent.row ? `Room finish schedule, row ${parent.row.number} (${suite}, which this space is inside)` : null, group, section });
      parent.inside++;
      parent.insideSf = round2(parent.insideSf + r.areaSf);
      report.inside.rooms++;
      report.inside.sf = round2(report.inside.sf + r.areaSf);
      report.sf = round2(report.sf + r.areaSf);
      report.assigned[from]++;
      if (fin?.how === "new" && !report.newFinishes.includes(fin.tag)) report.newFinishes.push(fin.tag);
      if (from === "none") report.unassigned.push({ shapeId: floor.id, room: parent.tag.number, name: nm.name, texts: textsIn(spans, r.pointsPx), row: parent.row ?? null });
      await pause();
    }
  }
  for (const m of made) {
    if (!m.printed) continue;
    if (m.insideSf) { m.printed.measured = round2(m.printed.measured + m.insideSf); m.printed.ratio = m.printed.measured / m.printed.printed; }
    if (m.printed.ratio > 0.4 && m.printed.ratio < 1.6) ratios.push(m.printed.ratio);
  }

  // 5. do the measured rooms agree with the areas the schedule prints?
  //    Schedules often measure a little differently (to wall centres), and a sheet's scale can be set wrong. So the
  //    sheet's typical difference is found first. When it is large the whole sheet is doubted and says so; each room
  //    is then judged against the sheet's typical difference, so a room with more spaces inside it still stands out.
  let typical = 1;
  if (ratios.length >= 5) {
    ratios.sort((a, b) => a - b);
    const med = ratios[ratios.length >> 1];
    if (med < 0.85 || med > 1.15) {
      typical = med;
      report.scaleDoubt = { ratio: round2(med), rooms: ratios.length, text: `Rooms on ${sheet.label} measure about ${Math.round(med * 100)}% of the areas printed in the room finish schedule (${ratios.length} rooms compared). The schedule may measure differently, or this sheet's scale may be wrong. Check a known length on this sheet before you accept anything.` };
    }
  }
  for (const m of made) {
    let conf = m.conf;
    const notes = [];
    if (m.printed) {
      const rel = m.printed.ratio / typical;
      const both = `${fmt(m.printed.measured)} SF measured${m.inside ? ` with the ${m.inside === 1 ? "1 space" : `${m.inside} spaces`} found inside it` : ""}; the schedule prints ${fmt(m.printed.printed)} SF.`;
      if (rel >= 0.85 && rel <= 1.15) { if (!report.scaleDoubt) conf = Math.min(0.97, conf + 0.1); notes.push(both); }
      else if (rel < 0.6) { conf *= 0.7; notes.push(`${both} This room probably has more spaces inside it (bedrooms, a bathroom, closets) that were not measured. Click them to add them.`); }
      else if (rel < 0.85) { conf *= 0.9; notes.push(both); }
      else { conf *= 0.75; notes.push(`${both} The outline may take in more than this room.`); }
    }
    if (report.scaleDoubt) { conf = Math.min(conf, 0.7); notes.push(`Areas on this sheet run about ${Math.round(typical * 100)}% of the schedule's: check the scale.`); }
    if (m.shared) conf *= 0.8;
    const o = m.floor.origin;
    o.confidence = clamp(conf);
    o.auto.notes = [...notes, ...o.auto.notes];
    for (const b of m.base) b.origin.confidence = clamp(o.confidence * m.baseFactor);
  }

  // 6. transitions: a door opening between two measured rooms whose floor finishes differ. Only where both finishes
  //    are known, and only at openings the drawing shows; the strip's own finish is the person's to choose unless
  //    the job has exactly one transition.
  if (!report.stopped) {
    const finishOf = (m) => (m.floor.condition_id ? (doc.conditions || []).find((c) => c.id === m.floor.condition_id)?.finish_tag : m.floor.origin.auto.finish_tag) ?? null;
    const same = (a, b) => String(a).toUpperCase().replace(/[^A-Z0-9]/g, "") === String(b).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const gapsOf = async (m) => (m.gaps ??= await engine.baseAlong(m.ring, upp).then((b) => (b.deducted ? b.gaps ?? [] : [])));
    const strips = (doc.conditions || []).filter((c) => TRANSITION_TAG.test(String(c.finish_tag ?? "")));
    const strip = strips.length === 1 ? strips[0] : null;
    const taken = [];   // midpoints already given a strip
    for (let i = 0; i < made.length; i++) {
      for (let j = i + 1; j < made.length; j++) {
        const A = made[i], B = made[j];
        const fa = finishOf(A), fb = finishOf(B);
        if (!fa || !fb || same(fa, fb)) continue;
        if (!sharedLength(A.ring, B.ring, wallPx, stepPx)) continue;
        const near = (gaps, other) => gaps.filter((g) => distToRing(other.ring, (g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2) <= wallPx);
        let found = near(await gapsOf(A), B);
        if (!found.length) found = near(await gapsOf(B), A);
        for (const g of found) {
          const mid = [(g[0][0] + g[1][0]) / 2, (g[0][1] + g[1][1]) / 2];
          if (taken.some((t) => Math.hypot(t[0] - mid[0], t[1] - mid[1]) <= wallPx)) continue;
          taken.push(mid);
          const [lo, hi] = [A, B].sort((p, q) => p.tag.number.localeCompare(q.tag.number, undefined, { numeric: true }) || p.name.localeCompare(q.name));
          const room = lo.tag.number === hi.tag.number ? lo.tag.number : `${lo.tag.number}/${hi.tag.number}`;
          const tagsText = [finishOf(lo), finishOf(hi)].sort((p, q) => p.localeCompare(q, undefined, { numeric: true }));
          const why = `A door opening between ${lo.name} (${finishOf(lo)}) and ${hi.name} (${finishOf(hi)}): different floor finishes meet here.${strip ? ` ${strip.finish_tag} is the only transition on this job.` : " Choose the transition it takes."}`;
          const t = proposal(doc, { sheetId: sheet.key, role: "linear", pointsPx: g, dims, upp, cond: strip, label: room, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: clamp(Math.min(A.floor.origin.confidence, B.floor.origin.confidence) * 0.8), proposed_ts: ts, auto: { run: runId, kind: "transition", room, name: `${tagsText[0]} to ${tagsText[1]}`, between: [A.floor.id, B.floor.id], from: strip ? "job" : "none", why, notes: ["Check the opening on the drawing: a strip is needed only where the two finishes really meet."] } } });
          shapes.push(t);
          report.transitions.count++;
          report.transitions.lf = round2(report.transitions.lf + (t.computed?.perimeter_lf || 0));
        }
      }
      await pause();
    }
  }
  return done(withShapes(doc, shapes));
}

const fmt = (n) => (Number(n) || 0).toLocaleString("en-CA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const withShapes = (doc, shapes) => {
  if (!shapes.length) return doc;
  const labels = [...new Set(shapes.map((s) => s.label).filter(Boolean))].filter((l) => !(doc.shape_labels || []).includes(l));
  return { ...doc, shapes: [...(doc.shapes || []), ...shapes.map((s) => ({ ...s, origin: { ...s.origin, auto: { ...s.origin.auto } } }))], ...(labels.length ? { shape_labels: [...(doc.shape_labels || []), ...labels] } : {}) };
};
/** The text lettered inside an outline (what an AI helper, or a person, would read to decide the room's finish). */
function textsIn(spans, ring) {
  const out = [];
  for (const s of spans ?? []) {
    if (out.length >= 30) break;
    if (pointInRing(ring, s.x + (s.w || 0) / 2, s.y + (s.h || 0) / 2)) out.push(String(s.str).trim().slice(0, 60));
  }
  return out;
}

// ── the optional AI helper's answers ─────────────────────────────────────────────────────────────────────────

/**
 * Applies an AI helper's answers to rooms that were left without a finish. An answer is used only when it names a
 * finish that is already on the job or is a code the schedule uses; anything else is dropped. Its proposals are
 * marked as the AI's and never rated above 60%.
 * @param {object} doc
 * @param {{shapeId: string, tag: string, reason?: string}[]} answers
 * @param {string[]} [scheduleCodes]
 * @returns {{doc: object, applied: number}}
 */
export function applyDecisions(doc, answers, scheduleCodes = []) {
  const flat = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codes = new Set(scheduleCodes.map(flat).filter(Boolean));
  let applied = 0;
  const byId = new Map((answers ?? []).filter((a) => a && typeof a.shapeId === "string" && typeof a.tag === "string" && a.tag.trim()).map((a) => [a.shapeId, a]));
  const shapes = (doc.shapes || []).map((s) => {
    const a = byId.get(s.id);
    if (!a || s.origin?.method !== METHOD || s.origin.reviewed !== false || s.origin.auto?.from !== "none") return s;
    const m = matchFinish(a.tag, doc.conditions || []);
    if (m.how !== "exact" && !codes.has(flat(a.tag))) return s;
    applied++;
    const { finish_tag: _old, ...auto } = s.origin.auto;
    return { ...s, condition_id: m.conditionId, origin: { ...s.origin, confidence: Math.min(s.origin.confidence ?? 0.4, 0.6), auto: { ...auto, from: "ai", why: `AI suggestion: ${String(a.reason || "no reason given").replace(/\s+/g, " ").slice(0, 240)}`, ...(m.conditionId ? {} : { finish_tag: m.tag }) } } };
  });
  return { doc: applied ? { ...doc, shapes } : doc, applied };
}

/** One plain sentence per thing a run left out, for the banner above the review list. */
export function runSummary(reports) {
  const lines = [];
  for (const r of reports ?? []) {
    if (r.skipped) { lines.push(r.skipped); continue; }
    if (r.scaleDoubt) lines.push(r.scaleDoubt.text);
    if (r.stopped) lines.push(`${r.label}: stopped before all ${r.tags} rooms were tried.`);
    if (r.notMeasured.length) lines.push(`${r.label}: ${r.notMeasured.length} tagged room${r.notMeasured.length === 1 ? "" : "s"} could not be measured (${r.notMeasured.slice(0, 6).map((n) => n.room).join(", ")}${r.notMeasured.length > 6 ? "…" : ""}). Click or draw them by hand.`);
    if (r.already) lines.push(`${r.label}: ${r.already} room${r.already === 1 ? " was" : "s were"} already measured and left alone.`);
    if (r.otherSheet) lines.push(`${r.label}: ${r.otherSheet} room${r.otherSheet === 1 ? "" : "s"} already measured on another sheet in this run, not measured again.`);
    if (r.sameOutline) lines.push(`${r.label}: ${r.sameOutline} tag${r.sameOutline === 1 ? "" : "s"} sat in an outline another tag had already measured; those rooms share one proposal.`);
    if (r.base?.rooms && r.base.byGroup) lines.push(`${r.label}: base by area: suites ${fmt(r.base.byGroup.suite)} LF, common areas ${fmt(r.base.byGroup.common)} LF, washrooms ${fmt(r.base.byGroup.washroom)} LF. Accept or leave out each area in the review list.`);
    if (r.inside?.rooms) lines.push(`${r.label}: ${r.inside.rooms === 1 ? "1 space inside a tagged room was" : `${r.inside.rooms} spaces inside tagged rooms were`} found by ${r.inside.rooms === 1 ? "its name" : "their names"} (bedrooms, bathrooms, closets) and proposed under the room's number. Their finishes are not assumed.`);
    if (r.transitions?.count) lines.push(`${r.label}: ${r.transitions.count === 1 ? "1 opening where two floor finishes meet was" : `${r.transitions.count} openings where two floor finishes meet were`} proposed as transitions (${fmt(r.transitions.lf)} LF).`);
    if (r.assigned.none) lines.push(`${r.label}: ${r.assigned.none} room${r.assigned.none === 1 ? " has" : "s have"} no finish chosen. Choose one before accepting.`);
    if (r.base.notDeducted) lines.push(`${r.label}: door openings could not be told on ${r.base.notDeducted} room${r.base.notDeducted === 1 ? "" : "s"}; their base is the full perimeter.`);
  }
  return lines;
}
