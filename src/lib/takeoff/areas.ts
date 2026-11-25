/**
 * Base broken out by area: suites, common areas and washrooms.
 *
 * The automatic takeoff records the area on every line of base it measures. This reads the accepted lines back out
 * of the takeoff, per finish and section, so the estimate and the quote can show where a line's LF comes from.
 * Quantities only: nothing here knows a cost or a price.
 */
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { GENERAL } from "./quantities";

export type AreaKey = "suite" | "common" | "washroom" | "other";
export type Areas = Record<AreaKey, number>;
export type AreaRow = { condition_key: string; section: string; area: AreaKey; lf: number };
export const AREA_LABEL: Record<AreaKey, string> = { suite: "Suites", common: "Common areas", washroom: "Washrooms", other: "Other" };
const ORDER: AreaKey[] = ["suite", "common", "washroom", "other"];

type Shape = { condition_id?: string | null; measure_role?: string; label?: string | null; computed?: { perimeter_lf?: number } | null; origin?: { method?: string; reviewed?: boolean; auto?: { kind?: string; group?: string; name?: string } | null } | null };
type Doc = { conditions?: { id: string; finish_tag?: string | null; multiplier?: number | null }[]; shapes?: Shape[] } | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const zero = (): Areas => ({ suite: 0, common: 0, washroom: 0, other: 0 });
const VARIANT_SEP = " – ";
// The same reading of a room's name the takeoff uses, for base accepted before the area was recorded on it.
const WASHROOM = /(^|[^A-Z])(BATH(ROOM)?|W\.?\/?C\.?|WASHROOM|WR|ENSUITE|EN-SUITE|POWDER( ROOM)?|TOILETS?|SHOWERS?|LAV(ATORY)?|RESTROOM|TUB ROOM)([^A-Z]|$)/;
const SUITE = /(^|[^A-Z])(SUITE|UNIT|APT\.?|APARTMENT|GUEST ?ROOM|DWELLING)([^A-Z]|$)/;
const fromName = (name: string): AreaKey => (WASHROOM.test(name) ? "washroom" : SUITE.test(name) ? "suite" : "common");

/** Accepted lines (base, borders, anything measured in LF) by takeoff finish, section and area. Proposals are left out. */
export function docAreaRows(doc: Doc): AreaRow[] {
  const out = new Map<string, AreaRow>();
  const conds = new Map((doc?.conditions ?? []).map((c) => [c.id, c]));
  for (const s of doc?.shapes ?? []) {
    if (!s || s.measure_role !== "linear" || s.origin?.reviewed === false || !s.condition_id) continue;
    const c = conds.get(s.condition_id);
    if (!c) continue;
    const tag = String(c.finish_tag ?? "");
    const i = tag.indexOf(VARIANT_SEP);
    const section = String(s.label ?? "").trim() || (i === -1 ? "" : tag.slice(i + VARIANT_SEP.length).trim());
    const a = s.origin?.auto;
    const base = s.origin?.method === "auto_v1" && a?.kind === "base";
    const area: AreaKey = !base ? "other" : a?.group === "suite" || a?.group === "common" || a?.group === "washroom" ? a.group : fromName(String(a?.name ?? "").toUpperCase());
    const key = `${s.condition_id}\n${section}\n${area}`;
    const row = out.get(key) ?? { condition_key: s.condition_id, section, area, lf: 0 };
    row.lf = round2(row.lf + (Number(s.computed?.perimeter_lf) || 0) * (Number(c.multiplier) || 1));
    out.set(key, row);
  }
  return [...out.values()];
}

export type FinishAreas = Record<string, { total: Areas; bySection: Record<string, Areas> }>;

/** The rows per job finish. `links` says which finish each takeoff finish is (the takeoff's saved quantities carry it). */
export function areasByFinish(rows: AreaRow[], links: { condition_key: string; finish_id: string }[]): FinishAreas {
  const finishOf = new Map(links.map((l) => [l.condition_key, l.finish_id]));
  const out: FinishAreas = {};
  for (const r of rows) {
    const f = finishOf.get(r.condition_key);
    if (!f) continue;
    const t = (out[f] ??= { total: zero(), bySection: {} });
    const s = (t.bySection[r.section.trim() || GENERAL] ??= zero());
    t.total[r.area] = round2(t.total[r.area] + r.lf);
    s[r.area] = round2(s[r.area] + r.lf);
  }
  return out;
}

type Line = { id: string; finish_id: string | null; source: string; detached: boolean; driver_qty: number; driver_uom: string; section: string };
const follows = (l: Line) => l.source === "takeoff" && !!l.finish_id && !l.detached;

/**
 * Where a line's LF is, by area. Only for a line that follows the takeoff in LF, and only when at least some of it
 * is sorted into suites, common areas or washrooms. Lines split by section each take their own section, by the same
 * rule their quantity follows. `matches` is false when the areas no longer add up to the line's quantity (the
 * takeoff changed, or the quantity was typed over).
 */
export function lineAreas(line: Line, lines: Line[], areas: FinishAreas): { areas: Areas; matches: boolean } | null {
  if (!follows(line) || line.driver_uom !== "LF") return null;
  const t = areas[line.finish_id!];
  if (!t) return null;
  const split = lines.some((x) => follows(x) && x.finish_id === line.finish_id && t.bySection[x.section]);
  const a = split ? t.bySection[line.section] : t.total;
  if (!a || a.suite + a.common + a.washroom <= 0) return null;
  const sum = ORDER.reduce((n, k) => n + a[k], 0);
  return { areas: { ...a }, matches: Math.abs(sum - line.driver_qty) <= 0.05 };
}

const qty = (n: number) => n.toLocaleString("en-CA", { maximumFractionDigits: 1 });
/** The breakdown as labelled quantities, in a fixed order, empty areas left out. Empty when nothing is sorted into an area. */
export function areaParts(a: Areas): { label: string; qty: number }[] {
  if (a.suite + a.common + a.washroom <= 0) return [];
  return ORDER.filter((k) => a[k] > 0).map((k) => ({ label: AREA_LABEL[k], qty: a[k] }));
}
export const partsText = (parts: { label: string; qty: number }[]): string => parts.map((p) => `${p.label} ${qty(p.qty)} LF`).join(" · ");
export function areasText(a: Areas): string | null {
  const parts = areaParts(a);
  return parts.length ? partsText(parts) : null;
}

/** The job's accepted LF by finish and area, read from its takeoff. */
export function useTakeoffAreas(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["takeoff-areas", projectId],
    enabled: !!projectId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<FinishAreas> => {
      const [tk, links] = await Promise.all([
        db.from("project_takeoffs").select("conditions:doc->conditions,shapes:doc->shapes").eq("project_id", projectId!).maybeSingle(),
        db.from("takeoff_quantities").select("condition_key,finish_id").eq("project_id", projectId!),
      ]);
      if (tk.error) throw tk.error;
      if (links.error) throw links.error;
      return areasByFinish(docAreaRows(tk.data as Doc), (links.data ?? []) as { condition_key: string; finish_id: string }[]);
    },
  });
}
