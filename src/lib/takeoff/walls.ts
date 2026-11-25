/**
 * The edges of tiled walls, read from the takeoff: for each wall run, its length along the top and its height at
 * each end. This is what a Schluter edge or other tile trim is measured against. Quantities only.
 */
import { GENERAL } from "./quantities";

export type WallEdges = { runs: number; topLf: number; endsLf: number; allLf: number };
export type FinishWallEdges = Record<string, { total: WallEdges; bySection: Record<string, WallEdges> }>;

type Shape = { condition_id?: string | null; measure_role?: string; label?: string | null; height_ft?: number | null; computed?: { perimeter_lf?: number } | null; origin?: { reviewed?: boolean } | null };
type Doc = { conditions?: { id: string; finish_tag?: string | null; multiplier?: number | null; height_ft?: number | null }[]; shapes?: Shape[] } | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const zero = (): WallEdges => ({ runs: 0, topLf: 0, endsLf: 0, allLf: 0 });
const VARIANT_SEP = " – ";

/** Accepted wall runs per job finish and estimate section ("Walls", "Suite Type B walls": the sections the takeoff's quantities use). */
export function wallEdgesByFinish(doc: Doc, links: { condition_key: string; finish_id: string }[]): FinishWallEdges {
  const finishOf = new Map(links.map((l) => [l.condition_key, l.finish_id]));
  const conds = new Map((doc?.conditions ?? []).map((c) => [c.id, c]));
  const out: FinishWallEdges = {};
  for (const s of doc?.shapes ?? []) {
    if (!s || s.measure_role !== "surface_area" || s.origin?.reviewed === false || !s.condition_id) continue;
    const c = conds.get(s.condition_id), f = finishOf.get(s.condition_id);
    if (!c || !f) continue;
    const tag = String(c.finish_tag ?? "");
    const i = tag.indexOf(VARIANT_SEP);
    const named = String(s.label ?? "").trim() || (i === -1 ? "" : tag.slice(i + VARIANT_SEP.length).trim());
    const section = named ? `${named} walls` : "Walls";
    const mult = Number(c.multiplier) || 1;
    const top = (Number(s.computed?.perimeter_lf) || 0) * mult;
    const ends = 2 * (Number(s.height_ft) || Number(c.height_ft) || 0) * mult;
    const t = (out[f] ??= { total: zero(), bySection: {} });
    for (const e of [t.total, (t.bySection[section || GENERAL] ??= zero())]) {
      e.runs += mult;
      e.topLf = round2(e.topLf + top);
      e.endsLf = round2(e.endsLf + ends);
      e.allLf = round2(e.topLf + e.endsLf);
    }
  }
  return out;
}

type Line = { id: string; finish_id: string | null; source: string; detached: boolean; section: string };
const follows = (l: Line) => l.source === "takeoff" && !!l.finish_id && !l.detached;

/** The wall edges behind one estimate line, by the same rule its quantity follows: its own section when the finish is split by section. */
export function lineWallEdges(line: Line, lines: Line[], edges: FinishWallEdges): WallEdges | null {
  if (!follows(line)) return null;
  const t = edges[line.finish_id!];
  if (!t) return null;
  const split = lines.some((x) => follows(x) && x.finish_id === line.finish_id && t.bySection[x.section]);
  const e = split ? t.bySection[line.section] : t.total;
  return e && e.runs > 0 ? { ...e } : null;
}

const n = (v: number) => v.toLocaleString("en-CA", { maximumFractionDigits: 1 });
export const edgeText = (e: WallEdges): string => `The takeoff has ${e.runs} run${e.runs === 1 ? "" : "s"}: ${n(e.topLf)} LF along the top and ${n(e.endsLf)} LF up the ends, ${n(e.allLf)} LF in all.`;
