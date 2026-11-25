// BMD change (new file): reviewing what the automatic takeoff proposed. BMD's own code.
//
// A proposal is a measurement with origin.method "auto_v1" and origin.reviewed false. Until a person accepts it,
// it is not counted in totals and is not sent to the estimate. Accepting changes `reviewed` and nothing about the
// outline. Each function here returns a new document, so one press is one undo step.
import { addCondition } from "./takeoffDoc.js";
import { AREA_GROUPS, METHOD, areaGroup } from "./autoTakeoff.js";
import { areaSection } from "./areaSection.js";

export const isProposal = (s) => s?.origin?.method === METHOD && s.origin.reviewed === false;
export const proposalsIn = (doc) => (doc?.shapes || []).filter(isProposal);

/** How many things there are to review among some shapes: each room's floor is one, and each room's base is one. */
export function reviewCount(shapes) {
  const seen = new Set();
  for (const s of shapes || []) if (isProposal(s)) seen.add(itemId(s));
  return seen.size;
}

/** Where a proposal's finish came from, in the words shown on screen. */
export const FROM_LABEL = { schedule: "Schedule row", tag: "Tag in the room", ai: "AI suggestion", person: "You chose", job: "Only one on the job", symbol: "Matches your example", none: "No finish chosen" };
const KINDS = new Set(["base", "inside", "transition", "count"]);
const itemId = (s) => { const a = s.origin.auto || {}; return a.kind === "base" && a.of ? `base:${a.of}` : a.kind === "count" && a.sweep ? `count:${a.sweep}` : s.id; };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The proposals as a review list: by sheet, then by finish, lowest confidence first. A room's floor is one item;
 * its base (which may be several lines, one between each pair of door openings) is one item.
 * @param {object} doc
 * @param {{key: string, label: string|null, page: number}[]} sheets in the order they are listed on screen
 * @returns {{sheetKey: string, sheetLabel: string, count: number, groups: {finish: string|null, isNew: boolean, items: object[]}[]}[]}
 */
export function reviewList(doc, sheets = []) {
  const conds = new Map((doc?.conditions || []).map((c) => [c.id, c]));
  const items = new Map();   // item id → item
  for (const s of proposalsIn(doc)) {
    const a = s.origin.auto || {};
    const id = itemId(s);
    const kind = KINDS.has(a.kind) ? a.kind : "floor";
    const unit = kind === "count" ? "EA" : s.measure_role === "linear" ? "LF" : "SF";
    let it = items.get(id);
    if (!it) {
      const cond = s.condition_id ? conds.get(s.condition_id) : null;
      it = {
        id, ids: [], kind, sheetKey: s.sheet_id, room: a.room || "", name: a.name || "",
        qty: 0, unit, finish: cond?.finish_tag ?? a.finish_tag ?? null, conditionId: cond?.id ?? null, isNew: !cond && !!a.finish_tag,
        from: a.from || "none", why: a.why || "", notes: a.notes || [], also: a.also || [], confidence: s.origin.confidence ?? 0, verts: [],
      };
      items.set(id, it);
    }
    it.ids.push(s.id);
    it.qty = round2(it.qty + ((it.unit === "EA" ? s.computed?.count || 1 : it.unit === "LF" ? s.computed?.perimeter_lf : s.computed?.area_sf) || 0));
    it.verts.push(...(s.verts_norm || []));
  }
  const order = new Map(sheets.map((s, i) => [s.key, i]));
  const bySheet = new Map();
  for (const it of items.values()) {
    if (!bySheet.has(it.sheetKey)) bySheet.set(it.sheetKey, []);
    bySheet.get(it.sheetKey).push(it);
  }
  return [...bySheet.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9))
    .map(([sheetKey, list]) => {
      const sh = sheets.find((s) => s.key === sheetKey);
      const groups = new Map();
      for (const it of list) {
        const k = it.finish ?? "";
        if (!groups.has(k)) groups.set(k, { finish: it.finish, isNew: it.isNew, items: [] });
        groups.get(k).items.push(it);
      }
      const sorted = [...groups.values()].sort((a, b) => (a.finish === null ? -1 : b.finish === null ? 1 : a.finish.localeCompare(b.finish, undefined, { numeric: true })));
      for (const g of sorted) g.items.sort((a, b) => a.confidence - b.confidence || a.room.localeCompare(b.room, undefined, { numeric: true }));
      return { sheetKey, sheetLabel: sh ? sh.label || `Page ${sh.page}` : sheetKey, count: list.length, groups: sorted };
    });
}

/**
 * Accepts proposals: they become ordinary measurements and count from then on. A proposal whose finish is a code
 * from the drawings that is not on the job yet gets that finish added now. A proposal with no finish is not
 * accepted; choose its finish first.
 * @returns {{doc: object, accepted: number, needFinish: number}}
 */
export function acceptProposals(doc, shapeIds, now = () => new Date().toISOString()) {
  const want = new Set(shapeIds);
  let next = doc, accepted = 0, needFinish = 0;
  const ts = now();
  // finishes first, so every accepted shape of one code lands on one finish
  for (const s of proposalsIn(doc)) {
    if (!want.has(s.id) || s.condition_id) continue;
    const tag = s.origin.auto?.finish_tag;
    if (tag) next = addCondition(next, tag);
  }
  const byTag = new Map((next.conditions || []).map((c) => [c.finish_tag.toLowerCase(), c.id]));
  const shapes = (next.shapes || []).map((s) => {
    if (!want.has(s.id) || !isProposal(s)) return s;
    const tag = s.origin.auto?.finish_tag;
    const conditionId = s.condition_id || (tag ? byTag.get(tag.toLowerCase()) : null);
    if (!conditionId) { needFinish++; return s; }
    accepted++;
    const { finish_tag: _t, ...auto } = s.origin.auto || {};
    return { ...s, condition_id: conditionId, origin: { ...s.origin, reviewed: true, accepted_ts: ts, auto } };
  });
  return { doc: accepted ? { ...next, shapes } : doc, accepted, needFinish };
}

/** Gives proposals a finish that is on the job. The choice is recorded as the person's. */
export function setProposalFinish(doc, shapeIds, conditionId) {
  if (!(doc.conditions || []).some((c) => c.id === conditionId)) throw new Error("Choose a finish to measure first.");
  const want = new Set(shapeIds);
  return {
    ...doc,
    shapes: (doc.shapes || []).map((s) => {
      if (!want.has(s.id) || !isProposal(s)) return s;
      const { finish_tag: _t, ...auto } = s.origin.auto || {};
      return { ...s, condition_id: conditionId, origin: { ...s.origin, auto: { ...auto, from: "person", why: "You chose this finish." } } };
    }),
  };
}

/** Removes proposals. Removing a room's floor proposal removes its base, the spaces found inside it and its transitions too. */
export function removeProposals(doc, shapeIds) {
  const want = new Set(shapeIds);
  // what hangs off a removed proposal goes too, and what hangs off that (a suite, the bathroom inside it, its base)
  for (let grew = true; grew;) {
    grew = false;
    for (const s of doc.shapes || []) {
      if (want.has(s.id) || !isProposal(s)) continue;
      const a = s.origin.auto || {};
      if ((a.of && want.has(a.of)) || (a.between || []).some((id) => want.has(id))) { want.add(s.id); grew = true; }
    }
  }
  return { ...doc, shapes: (doc.shapes || []).filter((s) => !(isProposal(s) && want.has(s.id))) };
}

/** The proposals rated above a confidence (0 to 1) that have a finish. */
export const idsAbove = (doc, min) => proposalsIn(doc).filter((s) => (s.origin.confidence ?? 0) > min && (s.condition_id || s.origin.auto?.finish_tag)).map((s) => s.id);
/** The proposals on one sheet. */
export const idsOnSheet = (doc, sheetKey) => proposalsIn(doc).filter((s) => s.sheet_id === sheetKey).map((s) => s.id);

/**
 * The automatic takeoff's base, broken out by area: suites, common areas and washrooms, always in that order.
 * `proposedLf` and `rooms` are what is still waiting (with `ids`, and `needFinish`: how many of those lines have no
 * finish yet); `acceptedLf` is what has been accepted and counts. `types`: for suites, the same figures per suite type.
 * @returns {{group: string, label: string, proposedLf: number, acceptedLf: number, rooms: number, ids: string[], needFinish: number}[]}
 */
export function baseByGroup(doc) {
  const out = new Map(AREA_GROUPS.map(([group, label]) => [group, { group, label, proposedLf: 0, acceptedLf: 0, rooms: new Set(), ids: [], needFinish: 0, types: new Map() }]));
  for (const s of doc?.shapes || []) {
    const a = s?.origin?.auto;
    if (s?.origin?.method !== METHOD || a?.kind !== "base") continue;
    const g = out.get(a.group) ?? out.get(areaGroup(a.name));
    const lf = s.computed?.perimeter_lf || 0;
    // suites are listed by type: every Suite Type B together, every Suite Type D together
    let t = null;
    if (g.group === "suite") {
      const label = (typeof a.section === "string" && a.section.trim()) || areaSection("suite", a.name);
      if (!g.types.has(label)) g.types.set(label, { label, proposedLf: 0, acceptedLf: 0, rooms: new Set() });
      t = g.types.get(label);
    }
    if (s.origin.reviewed === false) {
      g.proposedLf += lf; g.ids.push(s.id); g.rooms.add(a.of ?? s.id);
      if (t) { t.proposedLf += lf; t.rooms.add(a.of ?? s.id); }
      if (!s.condition_id && !a.finish_tag) g.needFinish++;
    } else { g.acceptedLf += lf; if (t) t.acceptedLf += lf; }
  }
  const tidy = (x) => ({ ...x, proposedLf: round2(x.proposedLf), acceptedLf: round2(x.acceptedLf), rooms: x.rooms.size });
  return [...out.values()].map((g) => ({ ...tidy(g), types: [...g.types.values()].map(tidy).sort((p, q) => p.label.localeCompare(q.label, undefined, { numeric: true })) }));
}

/** Accepts base lines in one step, first giving them all one finish when `conditionId` is given. */
export function acceptBase(doc, shapeIds, conditionId = null, now) {
  const withFinish = conditionId ? setProposalFinish(doc, shapeIds, conditionId) : doc;
  const out = acceptProposals(withFinish, shapeIds, now);
  return out.accepted ? out : { ...out, doc };
}
