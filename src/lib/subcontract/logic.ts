/**
 * Subcontractor purchase orders, pure rules: a work order's lines (500 SF of LVT, 10 LF of base) become a purchase
 * order to the subcontractor doing the work; the bill QuickBooks raises against that order, and its payment, move
 * the order on. Costs come from the catalogue's labour rates; a rate nobody has entered stays null, never 0.
 */

export type SubcontractStatus = "draft" | "sent" | "billed" | "paid" | "cancelled";

export type VisitLine = { id: string; description: string; quantity: number; uom: string; cost_code: string | null; sort_order?: number | null };
export type LabourRate = { id: string; name: string; uom: string; unit_cost_cents: number | null; cost_code: string | null; active: boolean };
export type OrderLine = { visit_line_id: string | null; description: string; quantity: number; uom: string; unit_cost_cents: number | null; cost_code: string | null; sort_order: number };

export type SubcontractOrder = {
  id: string;
  project_id: string;
  visit_id: string | null;
  supplier_id: string;
  po_number: string;
  status: SubcontractStatus;
  subtotal_cents: number;
  notes: string | null;
  qbo_po_id: string | null;
  qbo_po_sent_at: string | null;
  qbo_bill_id: string | null;
  qbo_bill_total_cents: number | null;
  billed_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export const STATUS_LABEL: Record<SubcontractStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  billed: "Billed",
  paid: "Paid",
  cancelled: "Cancelled",
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The labour rate for a work-order line: same cost code and unit first, then same cost code, then nothing. Never 0. */
export function rateFor(line: Pick<VisitLine, "cost_code" | "uom">, rates: LabourRate[]): LabourRate | null {
  if (!line.cost_code) return null;
  const code = norm(line.cost_code);
  const candidates = rates.filter((r) => r.active && norm(r.cost_code) === code && r.unit_cost_cents !== null);
  if (!candidates.length) return null;
  return candidates.find((r) => norm(r.uom) === norm(line.uom)) ?? candidates[0]!;
}

/** Draft order lines from a work order's lines, costed from the catalogue where a rate exists. */
export function orderFromWorkOrder(lines: VisitLine[], rates: LabourRate[]): OrderLine[] {
  return [...lines]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((l, i) => {
      const rate = rateFor(l, rates);
      return {
        visit_line_id: l.id,
        description: l.description,
        quantity: Number(l.quantity) || 0,
        uom: l.uom,
        unit_cost_cents: rate?.unit_cost_cents ?? null,
        cost_code: l.cost_code,
        sort_order: i,
      };
    });
}

/** Sum of the lines that have a cost; lines without one add nothing and are reported in `uncosted`. */
export function orderTotal(lines: Pick<OrderLine, "quantity" | "unit_cost_cents">[]): { subtotal_cents: number; uncosted: number } {
  let subtotal = 0;
  let uncosted = 0;
  for (const l of lines) {
    if (l.unit_cost_cents === null || l.unit_cost_cents === undefined) uncosted++;
    else subtotal += Math.round(l.unit_cost_cents * l.quantity);
  }
  return { subtotal_cents: subtotal, uncosted };
}

/** "26-002-SUB-01": the job number (or its id's first block when it has none) and the order's sequence on that job. */
export function poNumber(project: { project_number: string | null; id?: string }, seq: number): string {
  const base = (project.project_number?.trim() || project.id?.slice(0, 8) || "JOB").toUpperCase();
  return `${base}-SUB-${String(Math.max(1, Math.floor(seq))).padStart(2, "0")}`;
}

/** Which status a QuickBooks reading moves an order to. Cancelled orders never move; a paid order never goes back. */
export function nextStatus(
  current: SubcontractStatus,
  seen: { bill: boolean; balanceCents: number | null },
): SubcontractStatus {
  if (current === "cancelled" || current === "paid") return current;
  if (!seen.bill) return current === "draft" ? "draft" : current;
  if (seen.balanceCents !== null && seen.balanceCents <= 0) return "paid";
  return "billed";
}

/** Reads a QuickBooks Bill and says whether it is the bill for this order: linked to the purchase order, or carrying its number. */
export function billMatchesOrder(
  bill: Record<string, unknown>,
  order: Pick<SubcontractOrder, "qbo_po_id" | "po_number">,
): boolean {
  const poId = order.qbo_po_id ? String(order.qbo_po_id) : null;
  const linked = (txns: unknown) =>
    Array.isArray(txns) && txns.some((t) => t && typeof t === "object" && String((t as Record<string, unknown>)["TxnType"] ?? "") === "PurchaseOrder" && String((t as Record<string, unknown>)["TxnId"] ?? "") === poId);
  if (poId) {
    if (linked(bill["LinkedTxn"])) return true;
    const lines = bill["Line"];
    if (Array.isArray(lines) && lines.some((l) => l && typeof l === "object" && linked((l as Record<string, unknown>)["LinkedTxn"]))) return true;
  }
  const needle = order.po_number.trim().toLowerCase();
  if (!needle) return false;
  for (const key of ["DocNumber", "PrivateNote", "Memo"]) {
    const v = bill[key];
    if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** The whole-dollar amount QuickBooks reports, in cents; null when it is missing or not a number. */
export function qboCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Lines that still have no rate; a purchase order is not sent while any remain, so a blank cost is never sent as 0. */
export function uncostedLines(lines: Pick<OrderLine, "description" | "unit_cost_cents">[]): string[] {
  return lines.filter((l) => l.unit_cost_cents === null || l.unit_cost_cents === undefined).map((l) => l.description);
}

/** The lines as QuickBooks wants them: account-based expense lines. Every line has a cost by the time this runs. */
export function subcontractPoLines(lines: OrderLine[], accountId: string): Record<string, unknown>[] {
  return lines.map((l) => ({
    DetailType: "AccountBasedExpenseLineDetail",
    Amount: Math.round((l.unit_cost_cents ?? 0) * l.quantity) / 100,
    Description: `${l.description} (${l.quantity} ${l.uom})`,
    AccountBasedExpenseLineDetail: { AccountRef: { value: accountId } },
  }));
}
