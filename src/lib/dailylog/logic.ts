/** Pure rules for daily logs, crew requests and the crew's lists. No I/O. */
import { priceLine, type Uom } from "@/lib/estimating/calc";
import { SCHEDULE_TZ } from "@/lib/visits/logic";

// ── Daily logs ──────────────────────────────────────────────────────────────────────────────────────────────
/** The calendar day in Winnipeg, as YYYY-MM-DD. A log belongs to this day. */
export function winnipegDate(now: Date = new Date(), timeZone = SCHEDULE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);
}

type LogRef = { id: string; author_id: string; log_date: string };

/** One log per job, per day, per person: saving again the same day changes that log. */
export function saveTarget(logs: LogRef[], userId: string, today: string): { mode: "update"; id: string } | { mode: "create" } {
  const mine = logs.find((l) => l.author_id === userId && l.log_date === today);
  return mine ? { mode: "update", id: mine.id } : { mode: "create" };
}

/** Changing or deleting a log: its author on the same day, or office staff any time. */
export function canChangeLog(log: Pick<LogRef, "author_id" | "log_date">, who: { userId: string | null | undefined; today: string; office: boolean }): boolean {
  return who.office || (!!who.userId && log.author_id === who.userId && log.log_date === who.today);
}

export function filterLogs<T extends Pick<LogRef, "author_id" | "log_date">>(logs: T[], f: { authorId?: string | null; from?: string | null; to?: string | null }): T[] {
  return logs.filter((l) => (!f.authorId || l.author_id === f.authorId) && (!f.from || l.log_date >= f.from) && (!f.to || l.log_date <= f.to));
}

export type WeatherFields = { weather_status: string; weather_conditions: string | null; temp_now_c: number | null; temp_high_c: number | null; temp_low_c: number | null };
const deg = (n: number) => `${Math.round(Number(n)) || 0}°`;

/** The weather as one line. Anything not known reads "Weather unavailable"; nothing is ever filled in. */
export function weatherLine(w: WeatherFields): string {
  if (w.weather_status !== "ok" || !w.weather_conditions) return "Weather unavailable";
  const range = w.temp_high_c != null && w.temp_low_c != null;
  if (w.temp_now_c != null) return `${w.weather_conditions} · ${deg(w.temp_now_c)}C now${range ? ` · high ${deg(w.temp_high_c!)}, low ${deg(w.temp_low_c!)}` : ""}`;
  return range ? `${w.weather_conditions} · high ${deg(w.temp_high_c!)}C, low ${deg(w.temp_low_c!)}C` : w.weather_conditions;
}

// ── Next steps → requests ───────────────────────────────────────────────────────────────────────────────────
const NEED = /\b(need(s|ed)?|pick[\s-]?up|order|bring)\b/i;
/** Whether a line reads like something the crew needs. Only used to suggest; a request is never made without a press. */
export const looksLikeNeed = (line: string): boolean => NEED.test(line);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The lines written under "Next steps / what's needed", without bullets or numbering. */
export function nextStepLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "").trim())
    .filter((l) => l !== "");
}

export type RequestOffer = { line: string; suggested: boolean; requested: boolean };
/** Every line can be made a request with one press. Need-like lines are suggested; lines already requested are marked. */
export function requestOffers(nextSteps: string, existing: { what: string }[]): RequestOffer[] {
  const have = new Set(existing.map((r) => norm(r.what)));
  return nextStepLines(nextSteps).map((line) => ({ line, suggested: looksLikeNeed(line), requested: have.has(norm(line)) }));
}

// ── Requests ────────────────────────────────────────────────────────────────────────────────────────────────
export const REQUEST_STATUSES = ["open", "ordered", "on_its_way", "done", "cant_do"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { open: "Open", ordered: "Ordered", on_its_way: "On its way", done: "Done", cant_do: "Can't do" };

const MOVES: Record<RequestStatus, RequestStatus[]> = {
  open: ["ordered", "on_its_way", "done", "cant_do"],
  ordered: ["on_its_way", "done", "cant_do"],
  on_its_way: ["done", "cant_do"],
  done: ["open"],
  cant_do: ["open"],
};
export const nextRequestMoves = (from: RequestStatus): RequestStatus[] => MOVES[from] ?? [];
export const canMoveRequest = (from: RequestStatus, to: RequestStatus): boolean => nextRequestMoves(from).includes(to);
/** Still waiting on something: open, ordered or on its way. */
export const isOpenRequest = (s: RequestStatus): boolean => s === "open" || s === "ordered" || s === "on_its_way";

/** What to write when a request moves. "Can't do" needs a reason; every other move clears it. */
export function requestMovePatch(from: RequestStatus, to: RequestStatus, info: { reason?: string | null }): { status: RequestStatus; status_reason: string | null } {
  if (!canMoveRequest(from, to)) throw new Error(`A request can't go from ${REQUEST_STATUS_LABEL[from]} to ${REQUEST_STATUS_LABEL[to]}.`);
  if (to !== "cant_do") return { status: to, status_reason: null };
  const reason = info.reason?.trim();
  if (!reason) throw new Error("Say why it can't be done.");
  return { status: to, status_reason: reason };
}

/** Open requests first (soonest needed-by first, undated after), then finished ones; newest first within a tie. */
export function sortRequests<T extends { status: RequestStatus; needed_by: string | null; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(isOpenRequest(b.status)) - Number(isOpenRequest(a.status)) ||
      (a.needed_by ?? "9999").localeCompare(b.needed_by ?? "9999") ||
      b.created_at.localeCompare(a.created_at),
  );
}

// ── Materials for the crew ──────────────────────────────────────────────────────────────────────────────────
/** What the database returns for one material row of the estimate. There is no cost, markup or supplier in it. */
export type MaterialRaw = {
  item_key: string;
  section: string;
  description: string;
  line_description: string;
  driver_qty: number;
  driver_uom: string;
  qty_per_driver: number;
  waste_pct: number;
  coverage_per_purchase_unit: number | null;
  round_up: boolean;
  purchase_uom: string;
};

/**
 * The quantity to order, worked out by the estimate's own arithmetic (`priceLine`), so it is the number shown
 * under "Order" on the estimate. Cost plays no part. Null when the units cannot be worked out.
 */
export function orderQuantity(r: MaterialRaw): number | null {
  const coverage = r.coverage_per_purchase_unit == null ? null : Number(r.coverage_per_purchase_unit);
  try {
    const priced = priceLine(
      {
        driverQty: Number(r.driver_qty),
        driverUom: r.driver_uom as Uom,
        markupPct: 0,
        taxCode: "GST",
        components: [
          {
            kind: "material",
            unitCostCents: 0,
            costUom: r.purchase_uom as Uom,
            purchaseUom: r.purchase_uom as Uom,
            ...(coverage ? { coveragePerPurchaseUnit: coverage } : {}),
            qtyPerDriver: Number(r.qty_per_driver),
            wastePct: Number(r.waste_pct),
            roundUp: !!r.round_up,
            pstApplies: false,
          },
        ],
      },
      { pstPct: 0 },
    );
    const q = priced.components[0]!.purchaseQty;
    return Number.isFinite(q) ? q : null;
  } catch {
    return null;
  }
}

export type MaterialItem = { key: string; description: string; where: string; quantity: number | null; unit: string; loaded: boolean };
export const MATERIAL_ITEM_KEYS = ["key", "description", "where", "quantity", "unit", "loaded"] as const;
export type MaterialGroup = { section: string; items: MaterialItem[] };

/** The crew's list, grouped by section in estimate order. Only the named fields are carried over, whatever arrives. */
export function shapeMaterialList(raw: MaterialRaw[], checks: { item_key: string; loaded: boolean }[]): MaterialGroup[] {
  const loaded = new Set(checks.filter((c) => c.loaded).map((c) => c.item_key));
  const groups: MaterialGroup[] = [];
  for (const r of raw) {
    const section = r.section?.trim() || "General";
    let g = groups.find((x) => x.section === section);
    if (!g) groups.push((g = { section, items: [] }));
    g.items.push({ key: r.item_key, description: r.description, where: r.line_description, quantity: orderQuantity(r), unit: r.purchase_uom, loaded: loaded.has(r.item_key) });
  }
  return groups;
}

// ── Tool list ───────────────────────────────────────────────────────────────────────────────────────────────
type ToolRef = { name: string; sort_order: number };
/** The standard tools a job does not have yet (names compared loosely), placed after the job's own items. */
export function toolsToCopy(standard: ToolRef[], existing: ToolRef[]): ToolRef[] {
  const have = new Set(existing.map((t) => norm(t.name)));
  let next = existing.reduce((m, t) => Math.max(m, t.sort_order), 0);
  const out: ToolRef[] = [];
  for (const t of [...standard].sort((a, b) => a.sort_order - b.sort_order)) {
    const name = t.name.trim();
    if (!name || have.has(norm(name))) continue;
    have.add(norm(name));
    out.push({ name, sort_order: (next += 1) });
  }
  return out;
}
