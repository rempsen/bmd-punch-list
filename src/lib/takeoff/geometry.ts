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
 */
export function takeoffLinks(lines: LinkedLine[], totals: Record<string, ConditionTotal>) {
  return lines
    .filter((l) => l.takeoff_condition_id && !l.detached)
    .map((l) => {
      const t = totals[l.takeoff_condition_id!];
      const takeoffQty = t ? qtyFor(t, l.driver_uom, l.section) : 0;
      return { lineId: l.id, pricedQty: l.driver_qty, takeoffQty, changed: Math.abs(takeoffQty - l.driver_qty) > 0.005 };
    });
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
