import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { qtyFor, type ConditionTotal, type Measure } from "./geometry";

/** One row the takeoff workspace wrote on its last save: a finish's measured quantities (no waste) in one section. */
export type QtyRow = { finish_id: string; condition_key: string; section: string; floor_sf: number; wall_sf: number; border_sf: number; lf: number; ea: number };
export type FinishTotals = Record<string, ConditionTotal>;
export const GENERAL = "General";

const zero = (): Measure => ({ sf: 0, sy: 0, lf: 0, ea: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Quantities per finish, with the part measured in each section. Area with no section name is "General". */
export function totalsByFinish(rows: QtyRow[]): FinishTotals {
  const out: FinishTotals = {};
  for (const r of rows) {
    const t = (out[r.finish_id] ??= { ...zero(), bySection: {} });
    const s = (t.bySection[r.section.trim() || GENERAL] ??= zero());
    const sf = Number(r.floor_sf) + Number(r.wall_sf) + Number(r.border_sf);
    for (const m of [t, s]) {
      m.sf = round2(m.sf + sf);
      m.sy = round2(m.sf / 9);
      m.lf = round2(m.lf + Number(r.lf));
      m.ea = round2(m.ea + Number(r.ea));
    }
  }
  return out;
}

type FollowLine = { id: string; finish_id: string | null; source: string; detached: boolean; driver_qty: number; driver_uom: string; section: string };
const follows = (l: FollowLine) => l.source === "takeoff" && !!l.finish_id && !l.detached;

/**
 * What the takeoff now measures for each estimate line that follows it.
 * A changed line keeps its priced quantity until the estimator accepts the new one.
 * When a finish's lines are split by section, each takes only its own section.
 */
export function finishLinks(lines: FollowLine[], totals: FinishTotals) {
  const linked = lines.filter(follows);
  return linked.map((l) => {
    const t = totals[l.finish_id!];
    const split = !!t && linked.some((x) => x.finish_id === l.finish_id && t.bySection[x.section]);
    const takeoffQty = !t ? 0 : split && !t.bySection[l.section] ? 0 : qtyFor(t, l.driver_uom, l.section);
    return { lineId: l.id, pricedQty: l.driver_qty, takeoffQty, changed: Math.abs(takeoffQty - l.driver_qty) > 0.005 };
  });
}

export type Offer = { finishId: string; tag: string; section: string; measure: Measure };

/** Finishes measured in the takeoff that have no line following them on this price yet, one entry per section. */
export function takeoffOffers(lines: FollowLine[], totals: FinishTotals, finishes: { id: string; tag: string }[]): Offer[] {
  const on = new Set(lines.filter(follows).map((l) => l.finish_id));
  const out: Offer[] = [];
  for (const f of finishes) {
    const t = totals[f.id];
    if (!t || on.has(f.id)) continue;
    for (const [section, measure] of Object.entries(t.bySection)) if (measure.sf > 0 || measure.lf > 0 || measure.ea > 0) out.push({ finishId: f.id, tag: f.tag, section, measure });
  }
  return out;
}

/** The unit a new line is priced in: the assembly's own when it fits what was measured, otherwise what was measured. */
export function offerUom(m: Measure, templateUom: string | null, category?: string): "SF" | "SY" | "LF" | "EA" {
  if (category === "carpet_broadloom" && m.sf > 0) return "SY";
  if ((templateUom === "SF" || templateUom === "SY") && m.sf > 0) return templateUom;
  if (templateUom === "LF" && m.lf > 0) return "LF";
  if (templateUom === "EA" && m.ea > 0) return "EA";
  return m.sf > 0 ? "SF" : m.lf > 0 ? "LF" : "EA";
}
export const offerQty = (m: Measure, uom: string) => round2(uom === "SY" ? m.sy : uom === "LF" ? m.lf : uom === "EA" ? m.ea : m.sf);

export function useTakeoffQuantities(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["takeoff-quantities", projectId],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const { data, error } = await db.from("takeoff_quantities").select("finish_id,condition_key,section,floor_sf,wall_sf,border_sf,lf,ea").eq("project_id", projectId!);
      if (error) throw error;
      return (data ?? []) as QtyRow[];
    },
  });
}
