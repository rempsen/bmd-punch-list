// BMD change (new file): reading and changing a takeoff document for the simple BMD takeoff screen.
// The document is OpenTakeoff's own (schema opentakeoff.takeoff_canvas.v1), written exactly as the full workspace
// writes it, so a takeoff made on the simple screen opens unchanged in the full workspace and the other way round.
// Every function returns a new document and leaves untouched whatever it does not understand (markups, RFIs, roll
// layouts, stitches and the rest), so nothing made in the full workspace is lost by saving from the simple one.
import { computeShapeMetrics, recalibrateShapes } from "../shapeMetrics.js";
import { conditionTotals } from "../totals.js";
import { nextHatchId, nextPaletteColor } from "../takeoffConstants.ts";
import { heightText } from "./feet.js";

const NEED_HEIGHT = "Type how high the tile goes, in feet or inches.";

const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A sheet's name in the document: the file and its page number, counted from 1. */
export const sheetKey = (fileName, pageNumber) => `${fileName}#${pageNumber}`;

/** The scale saved for a sheet: real feet per image pixel, and how it was set. Null when none is set. */
export function scaleFor(doc, sheetId) {
  const s = (doc.sheets || []).find((x) => x.sheet_id === sheetId);
  return s && s.units_per_px > 0 ? { upp: s.units_per_px, source: s.scale_source || "standard" } : null;
}

export const sheetShapes = (doc, sheetId) => (doc.shapes || []).filter((s) => s.sheet_id === sheetId);

/** Sets a sheet's scale and re-measures everything already drawn on that sheet. */
export function setScale(doc, sheetId, upp, source, dims) {
  if (!(upp > 0) || !Number.isFinite(upp)) throw new Error("A scale must be a positive number.");
  const others = (doc.sheets || []).filter((x) => x.sheet_id !== sheetId);
  const mine = sheetShapes(doc, sheetId);
  const remeasured = mine.length ? recalibrateShapes(mine, dims, upp, doc.conditions || []) : [];
  const byId = new Map(remeasured.map((s) => [s.id, s]));
  return {
    ...doc,
    sheets: [...others, { sheet_id: sheetId, units_per_px: upp, scale_source: source }],
    shapes: (doc.shapes || []).map((s) => byId.get(s.id) ?? s),
  };
}

/** Adds a finish to measure. A tag already in use is left as it is. Waste is not set here: it is added on the estimate. */
export function addCondition(doc, tag) {
  const finishTag = String(tag || "").trim();
  if (!finishTag) throw new Error("Give the finish a tag, such as LVT-1.");
  const list = doc.conditions || [];
  if (list.some((c) => c.finish_tag.toLowerCase() === finishTag.toLowerCase())) return doc;
  const colour = nextPaletteColor(list.length);
  return { ...doc, conditions: [...list, { id: uid("cnd"), created_at: new Date().toISOString(), finish_tag: finishTag, color: colour, fill: colour, hatch: nextHatchId(list.length), multiplier: 1, waste_pct: 0, materials: [] }] };
}

/** Renames a finish. The tag must not be blank or already used by another finish on this takeoff. */
export function renameCondition(doc, id, tag) {
  const finishTag = String(tag || "").trim();
  if (!finishTag) throw new Error("Give the finish a tag, such as LVT-1.");
  if ((doc.conditions || []).some((c) => c.id !== id && c.finish_tag.toLowerCase() === finishTag.toLowerCase())) throw new Error(`${finishTag} is already a finish on this takeoff.`);
  return updateCondition(doc, id, { finish_tag: finishTag });
}

const withArea = (doc, area) => (area && !(doc.shape_labels || []).includes(area) ? { ...doc, shape_labels: [...(doc.shape_labels || []), area] } : doc);

/** Names the area a measurement belongs to ("Level 2", "Corridors"); a blank name clears it. The estimate can price each area on its own line. */
export function setShapeArea(doc, shapeId, area) {
  const name = String(area || "").trim();
  const shapes = (doc.shapes || []).map((s) => {
    if (s.id !== shapeId) return s;
    const { label: _old, ...rest } = s;
    return name ? { ...rest, label: name } : rest;
  });
  return withArea({ ...doc, shapes }, name);
}

export function updateCondition(doc, id, patch) {
  return { ...doc, conditions: (doc.conditions || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Removes a finish that has nothing measured against it. */
export function removeCondition(doc, id) {
  if ((doc.shapes || []).some((s) => s.condition_id === id)) throw new Error("Remove this finish's measurements first.");
  return { ...doc, conditions: (doc.conditions || []).filter((c) => c.id !== id) };
}

/**
 * Adds one measurement.
 * @param {{sheetId: string, conditionId: string, role: "floor_area"|"deduct"|"linear"|"count"|"surface_area", pointsPx: number[][], dims: {w: number, h: number}, method?: string, seedPx?: number[], confidence?: number}} m
 */
export function addShape(doc, m) {
  const scale = scaleFor(doc, m.sheetId);
  if (!scale && m.role !== "count") throw new Error("Set the scale for this sheet first.");
  const cond = (doc.conditions || []).find((c) => c.id === m.conditionId);
  if (!cond) throw new Error("Choose a finish to measure first.");
  // Wall tile: a line along the wall on the plan, and how high the tile goes. Each wall keeps the height typed for it.
  const wall = m.role === "surface_area";
  // a double-click to finish lands twice on the last point: that is one corner, not a wall of no length
  if (wall) m = { ...m, pointsPx: m.pointsPx.filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 0.5) };
  if (wall && m.pointsPx.length < 2) throw new Error("Click at least two points along the wall.");
  if (wall && !(Number(m.heightFt) > 0) && (m.heightFt != null || !(Number(cond.height_ft) > 0))) throw new Error(NEED_HEIGHT);
  const shape = {
    id: uid("shp"),
    sheet_id: m.sheetId,
    condition_id: m.conditionId,
    measure_role: m.role,
    verts_norm: m.pointsPx.map(([x, y]) => [x / m.dims.w, y / m.dims.h]),
    created_at: new Date().toISOString(),
    // A person made or accepted this on the simple screen, so it counts at once.
    origin: { method: m.method || "manual", reviewed: true, ...(m.seedPx ? { seed_norm: [m.seedPx[0] / m.dims.w, m.seedPx[1] / m.dims.h] } : {}), ...(m.confidence != null ? { confidence: m.confidence } : {}) },
  };
  if (wall && Number(m.heightFt) > 0) { shape.height_ft = Number(m.heightFt); shape.height_override = true; }
  const area = String(m.area || "").trim();
  if (area) shape.label = area;
  shape.computed = computeShapeMetrics(shape, m.dims, scale?.upp ?? 0, cond);
  return withArea({ ...doc, shapes: [...(doc.shapes || []), shape] }, area);
}

/**
 * Gives a measurement a new outline and measures it again; everything else about it (finish, area name, when and
 * how it was made) stays. `origin` adds facts about how the outline came to be. An unknown id changes nothing.
 */
export function reshapeShape(doc, id, pointsPx, dims, origin = {}) {
  const old = (doc.shapes || []).find((s) => s.id === id);
  if (!old) return doc;
  const cond = (doc.conditions || []).find((c) => c.id === old.condition_id);
  const { verts_norm_holes: _holes, ...kept } = old;   // holes belonged to the old outline
  const shape = { ...kept, verts_norm: pointsPx.map(([x, y]) => [x / dims.w, y / dims.h]), origin: { ...(old.origin || {}), ...origin } };
  shape.computed = computeShapeMetrics(shape, dims, scaleFor(doc, old.sheet_id)?.upp ?? 0, cond);
  return { ...doc, shapes: doc.shapes.map((s) => (s.id === id ? shape : s)) };
}

/**
 * Moves a measurement to another finish (a room marked CPT-1 that should be LVT-1). A room moves with every cut-out
 * made in it; choosing one of those cut-outs moves its room the same way, because totals take a room's area net of
 * its cut-outs. Each moved shape is measured again at the new finish: a wall takes the new finish's height unless
 * someone set its height by hand. Outline, area name and how it was made stay.
 * An unknown measurement, or the finish it already has, changes nothing.
 */
export function setShapeFinish(doc, shapeId, conditionId, dims) {
  const cond = (doc.conditions || []).find((c) => c.id === conditionId);
  if (!cond) throw new Error("Choose a finish that is on this takeoff.");
  const picked = (doc.shapes || []).find((s) => s.id === shapeId);
  if (!picked) return doc;
  const root = (picked.cuts_shape_id && doc.shapes.find((s) => s.id === picked.cuts_shape_id)) || picked;
  const group = (s) => s.id === root.id || s.cuts_shape_id === root.id;
  if (doc.shapes.every((s) => !group(s) || s.condition_id === conditionId)) return doc;
  const upp = scaleFor(doc, root.sheet_id)?.upp ?? 0;
  const moved = (s) => {
    const next = { ...s, condition_id: conditionId };
    // The full workspace stores the height a wall was drawn at; it follows the new finish unless set by hand.
    if (s.measure_role === "surface_area" && s.height_override !== true) {
      if (Number(cond.height_ft) > 0) next.height_ft = Number(cond.height_ft);
      else delete next.height_ft;
    }
    if (dims) next.computed = computeShapeMetrics(next, dims, upp, cond);
    return next;
  };
  return { ...doc, shapes: doc.shapes.map((s) => (group(s) ? moved(s) : s)) };
}

/** Changes how high the tile goes on one wall and measures it again. An unknown id, or a shape that is not a wall, changes nothing. */
export function setShapeHeight(doc, id, heightFt, dims) {
  const old = (doc.shapes || []).find((s) => s.id === id);
  if (!old || old.measure_role !== "surface_area") return doc;
  if (!(Number(heightFt) > 0)) throw new Error(NEED_HEIGHT);
  const cond = (doc.conditions || []).find((c) => c.id === old.condition_id);
  const shape = { ...old, height_ft: Number(heightFt), height_override: true };
  shape.computed = computeShapeMetrics(shape, dims, scaleFor(doc, old.sheet_id)?.upp ?? 0, cond);
  return { ...doc, shapes: doc.shapes.map((s) => (s.id === id ? shape : s)) };
}

/**
 * One wall run read back wall by wall: each straight length, the total, the height and the area, with the sum
 * written out ("30 in + 5 ft + 30 in = 10 ft long × 6 ft high = 60.0 SF").
 */
export function wallRun(shape, dims, upp) {
  const pts = (shape.verts_norm || []).map(([x, y]) => [x * dims.w, y * dims.h]);
  const lengthsFt = pts.slice(1).map((p, i) => round2(Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]) * (upp || 0)));
  const lengthFt = round2(shape.computed?.perimeter_lf ?? lengthsFt.reduce((n, l) => n + l, 0));
  const heightFt = Number(shape.height_ft) || 0;
  const areaSf = round2(shape.computed?.area_sf ?? lengthFt * heightFt);
  const sum = lengthsFt.length > 1 ? `${lengthsFt.map(heightText).join(" + ")} = ` : "";
  return { lengthsFt, lengthFt, heightFt, areaSf, text: `${sum}${heightText(lengthFt)} long × ${heightText(heightFt)} high = ${areaSf.toFixed(1)} SF` };
}

export function removeShape(doc, id) {
  return { ...doc, shapes: (doc.shapes || []).filter((s) => s.id !== id && s.cuts_shape_id !== id) };
}

/**
 * What has been measured for each finish, as measured: no waste and no multiplier beyond the finish's own "× units".
 * @returns {{id: string, tag: string, colour: string, hatch: string, areaSf: number, areaSy: number, wallSf: number, lengthLf: number, count: number, shapes: number}[]}
 */
export function finishTotals(doc, sheetId = null) {
  // proposals waiting for review (the automatic takeoff's, or an import's) are not measured quantities yet
  const shapes = (sheetId ? sheetShapes(doc, sheetId) : doc.shapes || []).filter((s) => s.origin?.reviewed !== false);
  return conditionTotals(doc.conditions || [], shapes).map((r) => ({
    id: r.id, tag: r.finish_tag, colour: r.color, hatch: r.hatch,
    areaSf: round2(r.floor_sf), areaSy: round2(r.floor_sf / 9), wallSf: round2(r.wall_sf), lengthLf: round2(r.lf), count: r.ea, shapes: r.shape_count,
  }));
}
