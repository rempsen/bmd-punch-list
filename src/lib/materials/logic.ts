import { ownQty } from "@/lib/estimating/calc";
/** Pure rules for material order lines: statuses, grouping and what an estimate seeds. No I/O. */

export const MATERIAL_STATUSES = ["to_order", "on_order", "received", "on_site"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export const isMaterialStatus = (s: unknown): s is MaterialStatus => typeof s === "string" && (MATERIAL_STATUSES as readonly string[]).includes(s);

/** Each tab is named for the work done there: order it, receive it, take it to site, done. */
export const STATUS_LABEL: Record<MaterialStatus, string> = { to_order: "Ordering", on_order: "Receiving", received: "To site", on_site: "On site" };

/** A line moves one step forward or one step back; nothing skips. */
export function canMove(from: MaterialStatus, to: MaterialStatus): boolean {
  const a = MATERIAL_STATUSES.indexOf(from);
  const b = MATERIAL_STATUSES.indexOf(to);
  return Math.abs(a - b) === 1;
}

/** The fields to write when a line moves. Going back clears what the later step recorded. */
export function transitionPatch(
  from: MaterialStatus,
  to: MaterialStatus,
  info: { at?: string; by?: string | null; qty?: number | null; note?: string | null; po?: string | null } = {},
): Record<string, unknown> {
  if (!canMove(from, to)) throw new Error(`A line can't go from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`);
  const at = info.at ?? new Date().toISOString();
  if (from === "to_order" && to === "on_order") return { status: to, ordered_at: at, ...(info.po?.trim() ? { po_number: info.po.trim() } : {}) };
  if (from === "on_order" && to === "to_order") return { status: to, ordered_at: null, po_number: null };
  if (from === "on_order" && to === "received") return { status: to, received_at: at, received_by: info.by ?? null, received_qty: info.qty ?? null, received_note: info.note?.trim() || null };
  if (from === "received" && to === "on_site") return { status: to, on_site_at: at, on_site_by: info.by ?? null };
  if (from === "received" && to === "on_order") return { status: to, received_at: null, received_by: null, received_qty: null, received_note: null };
  return { status: to, on_site_at: null, on_site_by: null };
}

/** Why the selected ordered lines can't go back to Ordering, or null when they can. A QuickBooks PO has to be dealt with in QuickBooks. */
export function undoOrderBlock(rows: { qbo_po_id: string | null }[]): string | null {
  return rows.some((r) => r.qbo_po_id) ? "Some lines are on a purchase order in QuickBooks. Void or change it there first." : null;
}

/** Lines for one purchase order must share a supplier. Lines with no supplier group under null. */
export function groupBySupplier<T extends { supplier_id: string | null }>(rows: T[]): Map<string | null, T[]> {
  const out = new Map<string | null, T[]>();
  for (const r of rows) out.set(r.supplier_id, [...(out.get(r.supplier_id) ?? []), r]);
  return out;
}

/** Why the selected lines can't become one PO, or null when they can. */
export function poBlock(rows: { supplier_id: string | null; status: string; qbo_po_id: string | null }[]): string | null {
  if (rows.length === 0) return "Select the lines to order.";
  if (rows.some((r) => r.status !== "to_order")) return "Only lines still to order can go on a purchase order.";
  if (rows.some((r) => r.qbo_po_id)) return "Some selected lines are already on a purchase order.";
  const g = groupBySupplier(rows);
  if (g.has(null)) return "Give every selected line a supplier first.";
  if (g.size > 1) return "Select lines for one supplier at a time.";
  return null;
}

// ── Seeding from an estimate version (same rule as the database's seed_material_orders) ───────────────────────
export type SeedComponent = {
  kind: string;
  source?: string | null;
  not_applicable?: boolean | null;
  catalogue_material_id: string | null;
  label?: string | null;
  qty_per_driver: number | null;
  waste_pct: number | null;
  coverage_per_purchase_unit: number | null;
  round_up: boolean | null;
  purchase_uom: string | null;
  cost_uom: string | null;
  unit_cost_cents: number | null;
};
export type SeedLine = { id: string; description: string; driver_qty: number | null; driver_uom: string | null; selection?: string | null; components: SeedComponent[] };
export type SeedRow = { estimate_line_id: string; catalogue_item_id: string | null; description: string; quantity: number; unit: string; unit_cost_cents: number | null };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function convert(q: number, from: string | null, to: string | null) {
  if (from === "SF" && to === "SY") return q / 9;
  if (from === "SY" && to === "SF") return q * 9;
  return q;
}

/** Material components of required lines only; labour and fixed costs never become orders. */
export function seedRows(lines: SeedLine[]): SeedRow[] {
  const out: SeedRow[] = [];
  for (const l of lines) {
    if ((l.selection ?? "required") !== "required") continue;
    for (const c of l.components) {
      if (c.kind !== "material" || c.not_applicable) continue;
      // a part with its own quantity (a Schluter edge by the LF on a wall tiled by the SF) is ordered by that quantity
      const own = c.source !== "finish_material" && ownQty(l.driver_uom ?? "", c.cost_uom ?? c.purchase_uom, c.coverage_per_purchase_unit);
      const d = (own ? 1 : (l.driver_qty ?? 0)) * (c.qty_per_driver ?? 1) * (1 + (c.waste_pct ?? 0) / 100);
      let q: number;
      if (own) q = d;
      else if (c.coverage_per_purchase_unit && c.coverage_per_purchase_unit > 0) q = d / c.coverage_per_purchase_unit;
      else q = convert(d, l.driver_uom, c.purchase_uom);
      if (c.round_up) q = Math.ceil(q - 1e-9);
      if (!(q > 0)) continue;
      const cost =
        c.unit_cost_cents == null ? null
        : c.cost_uom === c.purchase_uom ? c.unit_cost_cents
        : c.coverage_per_purchase_unit && c.coverage_per_purchase_unit > 0 ? Math.round(c.unit_cost_cents * c.coverage_per_purchase_unit)
        : null;
      out.push({ estimate_line_id: l.id, catalogue_item_id: c.catalogue_material_id, description: c.label || l.description, quantity: r2(q), unit: c.purchase_uom ?? l.driver_uom ?? "", unit_cost_cents: cost });
    }
  }
  return out;
}

// ── QuickBooks purchase order body ──────────────────────────────────────────────────────────────────────────
export type PoLine = { description: string; quantity: number; unit: string; unit_cost_cents: number | null; qboItemId: string | null };

/** A PurchaseOrder body. Lines with a linked QuickBooks item use it; others go to the fallback expense account with the description. */
export function purchaseOrderBody(vendorId: string, lines: PoLine[], opts: { accountId: string | null; memo?: string; email?: string }) {
  const Line = lines.map((l) => {
    const rate = (l.unit_cost_cents ?? 0) / 100;
    const Amount = Math.round(rate * l.quantity * 100) / 100;
    const Description = `${l.description}${l.unit ? ` (${l.quantity} ${l.unit})` : ""}`;
    if (l.qboItemId) return { DetailType: "ItemBasedExpenseLineDetail", Amount, Description, ItemBasedExpenseLineDetail: { ItemRef: { value: l.qboItemId }, Qty: l.quantity, UnitPrice: rate } };
    if (!opts.accountId) throw new Error(`"${l.description}" has no QuickBooks item, and QuickBooks has no materials expense account to put it on.`);
    return { DetailType: "AccountBasedExpenseLineDetail", Amount, Description, AccountBasedExpenseLineDetail: { AccountRef: { value: opts.accountId } } };
  });
  return {
    VendorRef: { value: vendorId },
    Line,
    ...(opts.memo ? { Memo: opts.memo.slice(0, 4000) } : {}),
    ...(opts.email ? { POEmail: { Address: opts.email } } : {}),
  };
}
