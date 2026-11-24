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
import { findRoomTags, finishTagsInRoom, pointInRing, ringHoldsTag, roomKey, seedPoints } from "./roomTags.js";
import { matchFinish, scheduleRowFor } from "./roomSchedule.js";

export const METHOD = "auto_v1";
/** The honest limits, shown wherever proposals are reviewed. */
export const LIMITS = "Automatic takeoff is strongest on drawings exported from CAD, where it measures to the real linework. On scanned or photographed sheets it cannot find rooms by their walls, and much more will need correcting. It does not use models trained on BMD's trade. Check every outline before you accept it.";

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
    notMeasured: [], assigned: { schedule: 0, tag: 0, ai: 0, none: 0 }, newFinishes: [], base: { rooms: 0, lf: 0, notDeducted: 0 }, sf: 0, scheduleReader: schedule.reader, scaleDoubt: null, unassigned: [], ms: 0,
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
      if (!twin.shared) { twin.shared = true; o.confidence = clamp(o.confidence * 0.8); }
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

    // the schedule's printed area is a second opinion on the outline
    if (row?.areaSf > 0 && r.areaSf > 0) {
      const ratio = r.areaSf / row.areaSf;
      if (ratio > 0.4 && ratio < 1.6) ratios.push(ratio);
      const both = `${fmt(r.areaSf)} SF measured; the schedule prints ${fmt(row.areaSf)} SF.`;
      if (ratio >= 0.85 && ratio <= 1.15) { conf = Math.min(0.97, conf + 0.1); notes.push(both); }
      else if (ratio < 0.6) { conf *= 0.7; notes.push(`${both} This room probably has more spaces inside it (bedrooms, a bathroom, closets) that were not measured. Click them to add them.`); }
      else if (ratio < 0.85) { conf *= 0.9; notes.push(both); }
      else { conf *= 0.75; notes.push(`${both} The outline may take in more than this room.`); }
    }
    if (r.note) notes.push(r.note);
    if (r.fixtures?.length) notes.push(`${r.fixtures.length === 1 ? "1 area under a cabinet or fixture was" : `${r.fixtures.length} areas under cabinets or fixtures were`} left out (${fmt(round2((r.withFixtures?.areaSf ?? r.areaSf) - r.areaSf))} SF).`);

    const auto = { run: runId, kind: "floor", room: tag.number, name: tag.name, from, why: whyFinish, notes, ...(floorFinish && !floorFinish.cond ? { finish_tag: floorFinish.tag } : {}), ...(row?.areaSf ? { schedule_sf: row.areaSf } : {}) };
    const floor = proposal(doc, { sheetId: sheet.key, role: "floor_area", pointsPx: r.pointsPx, dims, upp, cond: floorFinish?.cond ?? null, label: name, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: clamp(conf), seed_norm: [seed[0] / dims.w, seed[1] / dims.h], proposed_ts: ts, auto } });
    shapes.push(floor);
    made.push({ tag, name, ring: r.pointsPx, floor, row });
    takenRooms.set(tag.number, sheet.label);
    report.measured++;
    report.sf = round2(report.sf + r.areaSf);
    if (from === "none") report.unassigned.push({ shapeId: floor.id, room: tag.number, name: tag.name, texts: textsIn(spans, r.pointsPx), row: row ?? null });

    // 4. base: along the walls, door openings left out where the drawing shows them
    if (row?.base) {
      const baseFinish = finishFor(row.base, doc.conditions || []);
      const b = await engine.baseAlong(r.pointsPx, upp);
      if (b.runs.length) {
        const bnotes = [b.deducted ? (b.openings ? `${b.openings} door opening${b.openings === 1 ? "" : "s"} (${fmt(b.openingsLf)} LF) left out of ${fmt(b.perimeterLf)} LF around the room.` : `No door openings could be told on this room's outline, so this is all ${fmt(b.perimeterLf)} LF around it.`) : "Openings not deducted: this is the full perimeter."];
        const bwhy = `Room finish schedule, row ${row.number}: base ${row.base}.${baseFinish.how === "like" ? ` ${baseFinish.tag} is the only ${row.base} finish on this job.` : baseFinish.how === "new" ? ` ${row.base} is not a finish on this job yet; it is added when you accept.` : ""}`;
        const bconf = clamp((floor.origin.confidence) * (b.deducted && b.openings ? 0.95 : 0.8));
        for (const line of b.runs) {
          shapes.push(proposal(doc, { sheetId: sheet.key, role: "linear", pointsPx: line, dims, upp, cond: baseFinish.cond, label: name, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: bconf, proposed_ts: ts, auto: { run: runId, kind: "base", of: floor.id, room: tag.number, name: tag.name, from: "schedule", why: bwhy, notes: bnotes, openings: b.openings, openings_deducted: b.deducted && b.openings > 0, ...(baseFinish.cond ? {} : { finish_tag: baseFinish.tag }) } } }));
        }
        report.base.rooms++;
        report.base.lf = round2(report.base.lf + b.lengthLf);
        if (!(b.deducted && b.openings > 0)) report.base.notDeducted++;
        if (baseFinish.how === "new" && !report.newFinishes.includes(baseFinish.tag)) report.newFinishes.push(baseFinish.tag);
      }
    }
    if (made.length % 8 === 0) onDoc(withShapes(doc, shapes));
    await pause();
  }

  // 5. do the measured rooms agree with the areas the schedule prints?
  if (ratios.length >= 5) {
    ratios.sort((a, b) => a - b);
    const med = ratios[ratios.length >> 1];
    if (med < 0.85 || med > 1.15) {
      report.scaleDoubt = { ratio: round2(med), rooms: ratios.length, text: `Rooms on ${sheet.label} measure about ${Math.round(med * 100)}% of the areas printed in the room finish schedule (${ratios.length} rooms compared). The schedule may measure differently, or this sheet's scale may be wrong. Check a known length on this sheet before you accept anything.` };
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
    if (r.assigned.none) lines.push(`${r.label}: ${r.assigned.none} room${r.assigned.none === 1 ? " has" : "s have"} no finish chosen. Choose one before accepting.`);
    if (r.base.notDeducted) lines.push(`${r.label}: door openings could not be told on ${r.base.notDeducted} room${r.base.notDeducted === 1 ? "" : "s"}; their base is the full perimeter.`);
  }
  return lines;
}
