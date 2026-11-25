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
/** One part of a breakdown: "Suite Type B", "Common areas", "Washrooms", or "Other" for work with no area recorded. */
export type AreaPart = { label: string; area: AreaKey; qty: number };
export type Areas = AreaPart[];
export type AreaRow = { condition_key: string; section: string; area: AreaKey; label: string; lf: number };
const RANK: Record<AreaKey, number> = { suite: 0, common: 1, washroom: 2, other: 3 };

type Auto = { kind?: string; group?: string; section?: string; room?: string; name?: string };
type Shape = { condition_id?: string | null; measure_role?: string; label?: string | null; computed?: { perimeter_lf?: number } | null; origin?: { method?: string; reviewed?: boolean; auto?: Auto | null } | null };
type Doc = { conditions?: { id: string; finish_tag?: string | null; multiplier?: number | null }[]; shapes?: Shape[] } | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const VARIANT_SEP = " – ";
// The same reading of a room's name, and the same roll-up, as the takeoff's own (vendor/…/lib/bmd/areaSection.js).
// Kept in step by the shared cases in both test files.
const WASHROOM = /(^|[^A-Z])(BATH(ROOM)?|W\.?\/?C\.?|WASHROOM|WR|ENSUITE|EN-SUITE|POWDER( ROOM)?|TOILETS?|SHOWERS?|LAV(ATORY)?|RESTROOM|TUB ROOM)([^A-Z]|$)/;
const SUITE = /(^|[^A-Z])(SUITE|UNIT|APT\.?|APARTMENT|GUEST ?ROOM|DWELLING)([^A-Z]|$)/;
const groupOf = (a: Auto): Exclude<AreaKey, "other"> => {
  if (a.group === "suite" || a.group === "common" || a.group === "washroom") return a.group;
  const n = String(a.name ?? "").toUpperCase();
  return WASHROOM.test(n) ? "washroom" : SUITE.test(n) ? "suite" : "common";
};
const title = (s: string) => s.trim().replace(/\s+/g, " ").split(" ").map((w) => (w.length <= 2 || /[\d.]/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
/** The estimate section for an area: suites under their own type ("Suite Type B"), else "Common areas" or "Washrooms". */
export function areaSection(group: Exclude<AreaKey, "other">, suiteName = ""): string {
  if (group === "washroom") return "Washrooms";
  if (group !== "suite") return "Common areas";
  const n = title(suiteName);
  return !n || /^(suite|unit|apt\.?|apartment)s?$/i.test(n) || !SUITE.test(n.toUpperCase()) ? "Suites" : n;
}
const areaLabel = (a: Auto): string => (typeof a.section === "string" && a.section.trim() ? a.section.trim() : areaSection(groupOf(a), groupOf(a) === "suite" ? String(a.name ?? "") : ""));

/**
 * Accepted lines (base, borders, anything measured in LF) by takeoff finish, estimate section and area.
 * Automatic base rolls up by area, never by each room's own name, exactly as the takeoff's saved quantities do.
 * Proposals are left out.
 */
export function docAreaRows(doc: Doc): AreaRow[] {
  const out = new Map<string, AreaRow>();
  const conds = new Map((doc?.conditions ?? []).map((c) => [c.id, c]));
  for (const s of doc?.shapes ?? []) {
    if (!s || s.measure_role !== "linear" || s.origin?.reviewed === false || !s.condition_id) continue;
    const c = conds.get(s.condition_id);
    if (!c) continue;
    const tag = String(c.finish_tag ?? "");
    const i = tag.indexOf(VARIANT_SEP);
    const own = i === -1 ? "" : tag.slice(i + VARIANT_SEP.length).trim();
    const typed = String(s.label ?? "").trim();
    const a = s.origin?.method === "auto_v1" ? s.origin.auto : null;
    const base = a?.kind === "base";
    let section = typed;
    if (a && (a.kind === "transition" || a.kind === "count")) section = typed === String(a.room ?? "").trim() ? "" : typed;
    else if (a) {
      const roomName = [a.room, a.name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
      if (!typed || typed === roomName) section = areaLabel(a);
    }
    const area: AreaKey = base ? groupOf(a!) : "other";
    const label = base ? areaLabel(a!) : "Other";
    const key = `${s.condition_id}\n${section || own}\n${label}`;
    const row = out.get(key) ?? { condition_key: s.condition_id, section: section || own, area, label, lf: 0 };
    row.lf = round2(row.lf + (Number(s.computed?.perimeter_lf) || 0) * (Number(c.multiplier) || 1));
    out.set(key, row);
  }
  return [...out.values()];
}

export type FinishAreas = Record<string, { total: Areas; bySection: Record<string, Areas> }>;
const add = (list: Areas, r: AreaRow) => {
  const p = list.find((x) => x.label === r.label);
  if (p) p.qty = round2(p.qty + r.lf);
  else list.push({ label: r.label, area: r.area, qty: r.lf });
};
const sorted = (list: Areas) => list.sort((a, b) => RANK[a.area] - RANK[b.area] || a.label.localeCompare(b.label, undefined, { numeric: true }));

/** The rows per job finish. `links` says which finish each takeoff finish is (the takeoff's saved quantities carry it). */
export function areasByFinish(rows: AreaRow[], links: { condition_key: string; finish_id: string }[]): FinishAreas {
  const finishOf = new Map(links.map((l) => [l.condition_key, l.finish_id]));
  const out: FinishAreas = {};
  for (const r of rows) {
    const f = finishOf.get(r.condition_key);
    if (!f) continue;
    const t = (out[f] ??= { total: [], bySection: {} });
    add(t.total, r);
    add((t.bySection[r.section.trim() || GENERAL] ??= []), r);
  }
  for (const t of Object.values(out)) { sorted(t.total); Object.values(t.bySection).forEach(sorted); }
  return out;
}

type Line = { id: string; finish_id: string | null; source: string; detached: boolean; driver_qty: number; driver_uom: string; section: string };
const follows = (l: Line) => l.source === "takeoff" && !!l.finish_id && !l.detached;
const sortedIn = (a: Areas) => a.some((p) => p.area !== "other" && p.qty > 0);

/**
 * Where a line's LF is, by area: each suite type, common areas, washrooms. Only for a line that follows the takeoff
 * in LF. A line that is itself one area (its section is "Suite Type B") needs none. Lines split by section each take
 * their own section, by the same rule their quantity follows. `matches` is false when the areas no longer add up to
 * the line's quantity (the takeoff changed, or the quantity was typed over).
 */
export function lineAreas(line: Line, lines: Line[], areas: FinishAreas): { areas: Areas; matches: boolean } | null {
  if (!follows(line) || line.driver_uom !== "LF") return null;
  const t = areas[line.finish_id!];
  if (!t) return null;
  const split = lines.some((x) => follows(x) && x.finish_id === line.finish_id && t.bySection[x.section]);
  const a = (split ? t.bySection[line.section] : t.total)?.filter((p) => p.qty > 0);
  if (!a || !sortedIn(a) || (split && a.length < 2)) return null;
  return { areas: a.map((p) => ({ ...p })), matches: Math.abs(a.reduce((n, p) => n + p.qty, 0) - line.driver_qty) <= 0.05 };
}

const qty = (n: number) => n.toLocaleString("en-CA", { maximumFractionDigits: 1 });
/** The breakdown as labelled quantities for a quote. Empty when nothing is sorted into an area. */
export function areaParts(a: Areas): { label: string; qty: number }[] {
  return sortedIn(a) ? a.filter((p) => p.qty > 0).map((p) => ({ label: p.label, qty: p.qty })) : [];
}
export function areasText(a: Areas): string | null {
  const parts = areaParts(a);
  return parts.length ? parts.map((p) => `${p.label} ${qty(p.qty)} LF`).join(" · ") : null;
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
