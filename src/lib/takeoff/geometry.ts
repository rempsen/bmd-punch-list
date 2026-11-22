/** Measuring. Shapes are stored in points of the sheet; each carries the scale it was measured at. */
import type { Pt } from "./scale";

export type ShapeKind = "area" | "linear" | "count";
export type Shape = {
  id: string;
  sheet_id: string;
  condition_id: string;
  kind: ShapeKind;
  vertices: Pt[];
  cutouts: Pt[][];
  /** Total width of door openings to leave out of the perimeter, in feet. */
  openings_ft: number;
  multiplier: number;
  section: string | null;
  scale_feet_per_point: number;
  /** Brought forward from an earlier drawing revision and not yet confirmed against the new sheet. */
  needs_checking?: boolean;
};

export function polygonArea(pts: Pt[]): number {
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}
export function polylineLength(pts: Pt[], closed = false): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  if (closed && pts.length > 2) d += Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.y - pts[pts.length - 1]!.y);
  return d;
}
export const areaWithCutouts = (outer: Pt[], holes: Pt[][]) => Math.max(0, polygonArea(outer) - holes.reduce((s, h) => s + polygonArea(h), 0));
/** Perimeter in feet, less the openings (in feet). */
export const perimeterLessOpenings = (pts: Pt[], openingsFt: number, fpp: number) => Math.max(0, polylineLength(pts, true) * fpp - openingsFt);

export type Measure = { sf: number; sy: number; lf: number; ea: number };
export function measureShape(s: Shape): Measure {
  const f = s.scale_feet_per_point;
  const m = s.multiplier > 0 ? s.multiplier : 1;
  if (s.kind === "count") return { sf: 0, sy: 0, lf: 0, ea: s.vertices.length * m };
  if (s.kind === "linear") return { sf: 0, sy: 0, lf: Math.max(0, polylineLength(s.vertices) * f - s.openings_ft) * m, ea: 0 };
  const sf = areaWithCutouts(s.vertices, s.cutouts) * f * f * m;
  return { sf, sy: sf / 9, lf: perimeterLessOpenings(s.vertices, s.openings_ft, f) * m, ea: 0 };
}

export type ConditionTotal = Measure & { bySection: Record<string, Measure> };
const zero = (): Measure => ({ sf: 0, sy: 0, lf: 0, ea: 0 });
const add = (a: Measure, b: Measure) => (["sf", "sy", "lf", "ea"] as const).forEach((k) => (a[k] += b[k]));

export function totalsByCondition(shapes: Shape[]): Record<string, ConditionTotal> {
  const out: Record<string, ConditionTotal> = {};
  for (const s of shapes) {
    const t = (out[s.condition_id] ??= { ...zero(), bySection: {} });
    const m = measureShape(s);
    add(t, m);
    add((t.bySection[s.section ?? ""] ??= zero()), m);
  }
  return out;
}

/** When a sheet's scale changes, every shape on it is measured again at the new scale. */
export const recomputeShapes = (shapes: Shape[], sheetId: string, fpp: number): Shape[] => shapes.map((s) => (s.sheet_id === sheetId ? { ...s, scale_feet_per_point: fpp } : s));

type LinkedLine = { id: string; takeoff_condition_id: string | null; detached: boolean; driver_qty: number; driver_uom: string; section: string };
const round2 = (n: number) => Math.round(n * 100) / 100;
export function qtyFor(total: ConditionTotal, uom: string, section: string): number {
  const m = total.bySection[section] ?? total;
  return round2(uom === "SY" ? m.sy : uom === "LF" ? m.lf : uom === "EA" ? m.ea : m.sf);
}

/**
 * Estimate lines fed by the takeoff, with the quantity they were priced at and what the takeoff says now.
 * A changed line keeps its priced quantity until the estimator accepts the new one. Detached lines are left out.
 * When a condition's lines are split by section, each takes only its own section: one with nothing measured is zero.
 */
export function takeoffLinks(lines: LinkedLine[], totals: Record<string, ConditionTotal>) {
  const linked = lines.filter((l) => l.takeoff_condition_id && !l.detached);
  return linked.map((l) => {
    const t = totals[l.takeoff_condition_id!];
    const split = !!t && linked.some((x) => x.takeoff_condition_id === l.takeoff_condition_id && t.bySection[x.section]);
    const takeoffQty = !t ? 0 : split && !t.bySection[l.section] ? 0 : qtyFor(t, l.driver_uom, l.section);
    return { lineId: l.id, pricedQty: l.driver_qty, takeoffQty, changed: Math.abs(takeoffQty - l.driver_qty) > 0.005 };
  });
}

/**
 * The measurements that count toward quantities: those on the newest version of each drawing file.
 * Measurements on an earlier version stay on record but are not added in, so a drawing revision never doubles a quantity.
 */
export function countedShapes(shapes: Shape[], sheets: { id: string; document_id: string }[], docs: { id: string; section: string; file_name: string; version: number }[]): Shape[] {
  const newest = new Map<string, number>();
  const key = (d: { section: string; file_name: string }) => `${d.section}|${d.file_name.toLowerCase()}`;
  for (const d of docs) newest.set(key(d), Math.max(newest.get(key(d)) ?? 0, d.version));
  const current = new Set(docs.filter((d) => d.version === newest.get(key(d))).map((d) => d.id));
  const live = new Set(sheets.filter((s) => current.has(s.document_id)).map((s) => s.id));
  return shapes.filter((s) => live.has(s.sheet_id));
}

/** A typed length in feet: 16, 16', 16' 6", 16-6, 6", 3 m, 3000mm. Null when it is not a positive length. */
export function parseFeet(input: string): number | null {
  const s = input.trim().toLowerCase();
  let feet: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/.exec(s))) feet = (Number(m[1]) * (m[2] === "mm" ? 0.001 : m[2] === "cm" ? 0.01 : 1)) / 0.3048;
  else if ((m = /^(\d+(?:\.\d+)?)\s*(?:"|in)$/.exec(s))) feet = Number(m[1]) / 12;
  else if ((m = /^(\d+(?:\.\d+)?)\s*(?:'|ft)?(?:\s*-?\s*(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/.exec(s))) feet = Number(m[1]) + Number(m[2] ?? 0) / 12;
  return feet != null && feet > 0 ? feet : null;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** The shape under a point (in sheet points). Marks and lines are picked ahead of the areas they sit on. */
export function hitTest(shapes: Shape[], p: Pt, tolerance: number): string | null {
  for (const s of shapes) if (s.kind === "count" && s.vertices.some((v) => Math.hypot(v.x - p.x, v.y - p.y) <= tolerance * 1.5)) return s.id;
  for (const s of shapes) if (s.kind === "linear" && s.vertices.some((v, i) => i > 0 && distToSegment(p, s.vertices[i - 1]!, v) <= tolerance)) return s.id;
  for (const s of [...shapes].reverse()) if (s.kind === "area" && inside(p, s.vertices) && !s.cutouts.some((c) => inside(p, c))) return s.id;
  return null;
}

type SheetLike = { id: string; page_number: number; sheet_number: string | null };
/**
 * Copies measurements from one drawing revision to the next. A sheet matches by its sheet number; sheets with no number
 * on either side match by page. The copies are marked as needing a check. Nothing on the old revision is changed.
 */
export function carryForward(oldSheets: SheetLike[], newSheets: SheetLike[], shapes: Shape[], newId: () => string = () => crypto.randomUUID()) {
  const key = (s: SheetLike) => (s.sheet_number?.trim() ? `n:${s.sheet_number.trim().toLowerCase()}` : `p:${s.page_number}`);
  const byKey = new Map(newSheets.map((s) => [key(s), s.id]));
  const sheetMap: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const o of oldSheets) {
    const to = byKey.get(key(o));
    if (to) sheetMap[o.id] = to;
    else if (shapes.some((s) => s.sheet_id === o.id)) unmatched.push(o.sheet_number?.trim() || `Page ${o.page_number}`);
  }
  const copies = shapes.filter((s) => sheetMap[s.sheet_id]).map((s): Shape => ({ ...s, id: newId(), sheet_id: sheetMap[s.sheet_id]!, vertices: s.vertices.map((v) => ({ ...v })), cutouts: s.cutouts.map((c) => c.map((v) => ({ ...v }))), needs_checking: true }));
  return { shapes: copies, sheetMap, unmatched };
}
