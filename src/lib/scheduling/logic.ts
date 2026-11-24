/** Pure rules for the Scheduling screens: weeks, technicians, areas. No I/O. Days are site days (Winnipeg). */
import { SCHEDULE_TZ } from "@/lib/visits/logic";

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The site day an instant falls on, as YYYY-MM-DD. */
export const siteDay = (at: string | Date, tz = SCHEDULE_TZ) => ymd(typeof at === "string" ? new Date(at) : at, tz);

/** The Monday (YYYY-MM-DD) of the week holding this day. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}
export const isIsoDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
export const thisMonday = (now: Date = new Date(), tz = SCHEDULE_TZ) => mondayOf(siteDay(now, tz));
export const shiftWeek = (monday: string, weeks: number) => addDays(monday, weeks * 7);
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Every site day a visit touches; a visit with no end is one day. */
export function visitDays(v: { starts_at: string; ends_at: string | null }, tz = SCHEDULE_TZ): string[] {
  const first = siteDay(v.starts_at, tz);
  const last = v.ends_at ? siteDay(v.ends_at, tz) : first;
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whether a visit touches the week starting on `monday`. */
export const inWeek = (v: { starts_at: string; ends_at: string | null }, monday: string, tz = SCHEDULE_TZ) => {
  const end = addDays(monday, 6);
  return visitDays(v, tz).some((d) => d >= monday && d <= end);
};

// ── Technicians ────────────────────────────────────────────────────────────────────────────────────────────
export type Technician = { id: string; name: string; source: "bmd" | "arriveping" };
export const UNASSIGNED = "unassigned";
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** BMD field staff first, then crew names ArrivePing has reported that aren't already a BMD person. */
export function mergeTechnicians(bmd: { id: string; full_name: string | null; email: string | null }[], arrivepingNames: (string | null | undefined)[]): Technician[] {
  const out: Technician[] = bmd.map((s) => ({ id: s.id, name: s.full_name || s.email || "Unknown", source: "bmd" as const }));
  const seen = new Set(out.flatMap((t) => [norm(t.name), ...(bmd.find((b) => b.id === t.id)?.email ? [norm(bmd.find((b) => b.id === t.id)!.email!)] : [])]));
  for (const raw of arrivepingNames) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    out.push({ id: `ap:${norm(name)}`, name, source: "arriveping" });
  }
  return out;
}

type Assignable = { assigned_user_id?: string | null; assigned_name?: string | null; arriveping_assigned_to?: string | null };

/** Which technician row a visit sits in: BMD's own assignment first, then who ArrivePing says has it. */
export function technicianOf(v: Assignable, techs: Technician[]): string {
  if (v.assigned_user_id && techs.some((t) => t.id === v.assigned_user_id)) return v.assigned_user_id;
  const byName = (n: string | null | undefined) => (n?.trim() ? techs.find((t) => norm(t.name) === norm(n)) : undefined);
  const named = byName(v.assigned_name) ?? (v.assigned_user_id ? undefined : byName(v.arriveping_assigned_to));
  if (named) return named.id;
  const free = v.assigned_name?.trim() || (!v.assigned_user_id ? v.arriveping_assigned_to?.trim() : null);
  return free ? `ap:${norm(free)}` : UNASSIGNED;
}

/** The week as rows (technician id, or "unassigned", or a free name not in the list) × days. */
export function bucketWeek<V extends Assignable & { starts_at: string; ends_at: string | null }>(visits: V[], monday: string, techs: Technician[], tz = SCHEDULE_TZ): Map<string, Map<string, V[]>> {
  const days = new Set(weekDays(monday));
  const out = new Map<string, Map<string, V[]>>();
  for (const v of [...visits].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const row = technicianOf(v, techs);
    for (const d of visitDays(v, tz)) {
      if (!days.has(d)) continue;
      const r = out.get(row) ?? new Map<string, V[]>();
      r.set(d, [...(r.get(d) ?? []), v]);
      out.set(row, r);
    }
  }
  return out;
}

/** BMD's assignment against ArrivePing's: nothing to send, waiting for ArrivePing, or ArrivePing shows the same person. */
export function assignmentState(v: Assignable, technicianName: string | null): "none" | "pending" | "confirmed" {
  const wanted = technicianName ?? v.assigned_name ?? null;
  if (!v.assigned_user_id && !v.assigned_name) return "none";
  return wanted && v.arriveping_assigned_to && norm(wanted) === norm(v.arriveping_assigned_to) ? "confirmed" : "pending";
}

// ── Areas ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Area = { floor_id: string; room_id: string };
export type Room = { id: string; floor_id: string };

/** The checked rooms as the visit's `areas` value, in floor and room order. Unknown rooms are dropped. */
export function areasFromSelection(selected: Iterable<string>, rooms: Room[]): Area[] {
  const pick = new Set(selected);
  return rooms.filter((r) => pick.has(r.id)).map((r) => ({ floor_id: r.floor_id, room_id: r.id }));
}

/** Reads a stored `areas` value back into a set of room ids, ignoring anything malformed. */
export function selectionFromAreas(areas: unknown): Set<string> {
  if (!Array.isArray(areas)) return new Set();
  return new Set(areas.flatMap((a) => (a && typeof a === "object" && typeof (a as Area).room_id === "string" ? [(a as Area).room_id] : [])));
}

/** "Whole floor": every room on the floor is checked, or all are cleared when they already are. */
export function toggleFloor(selected: Set<string>, floorId: string, rooms: Room[]): Set<string> {
  const ids = rooms.filter((r) => r.floor_id === floorId).map((r) => r.id);
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  const next = new Set(selected);
  for (const id of ids) all ? next.delete(id) : next.add(id);
  return next;
}

/** "6 areas · Floor 3", "12 areas · 2 floors", or "—". */
export function areasSummary(areas: unknown, floorLabel: (id: string) => string | undefined): string {
  const list = Array.isArray(areas) ? (areas as Area[]).filter((a) => a && a.room_id) : [];
  if (!list.length) return "—";
  const floors = [...new Set(list.map((a) => a.floor_id))];
  const n = `${list.length} area${list.length === 1 ? "" : "s"}`;
  return floors.length === 1 ? `${n} · ${floorLabel(floors[0]!) ?? "1 floor"}` : `${n} · ${floors.length} floors`;
}

/** Chip colour family for a visit, by what ArrivePing last said (else BMD's own status). */
export function chipTone(v: { status: string; arriveping_status?: string | null }): "scheduled" | "en_route" | "in_progress" | "complete" | "cancelled" {
  const s = v.arriveping_status || v.status;
  if (s === "cancelled" || s === "cancel_requested" || v.status === "cancelled") return "cancelled";
  if (s === "completed") return "complete";
  if (s === "arrived") return "in_progress";
  if (s === "en_route") return "en_route";
  return "scheduled";
}
