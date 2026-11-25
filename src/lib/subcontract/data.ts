import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { OrderLine, SubcontractOrder } from "./logic";

export type SubcontractOrderRow = SubcontractOrder & { supplier: { name: string } | null };
export type SubcontractOrderLineRow = OrderLine & { id: string };

// The money columns (subtotal_cents, qbo_bill_total_cents) are not readable through the table at all; pricing staff
// get them from the subcontract_order_totals RPC and they are merged in below.
const COLS = "id,project_id,visit_id,supplier_id,po_number,status,notes,qbo_po_id,qbo_po_sent_at,qbo_bill_id,billed_at,paid_at,created_at,supplier:suppliers(name)";

/**
 * A job's subcontractor purchase orders, oldest first. Shared by the work-order cards and the Billing tab.
 * Pass `canPrice` (view_pricing) to get the totals; without it they come back as 0 / null.
 */
export function useSubcontractOrders(projectId: string, canPrice: boolean, enabled = true) {
  return useQuery({
    queryKey: ["subcontract-orders", projectId, canPrice],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("subcontract_orders").select(COLS).eq("project_id", projectId).order("created_at");
      if (error) throw error;
      const totals = new Map<string, { subtotal_cents: number; qbo_bill_total_cents: number | null }>();
      if (canPrice) {
        const { data: t, error: te } = await db.rpc("subcontract_order_totals", { _project: projectId });
        if (te) throw te;
        for (const r of (t ?? []) as { order_id: string; subtotal_cents: number | string; qbo_bill_total_cents: number | string | null }[])
          totals.set(r.order_id, { subtotal_cents: Number(r.subtotal_cents), qbo_bill_total_cents: r.qbo_bill_total_cents === null ? null : Number(r.qbo_bill_total_cents) });
      }
      return ((data ?? []) as unknown as Omit<SubcontractOrderRow, "subtotal_cents" | "qbo_bill_total_cents">[]).map(
        (o): SubcontractOrderRow => ({ ...o, subtotal_cents: 0, qbo_bill_total_cents: null, ...totals.get(o.id) }),
      );
    },
  });
}

/** One order's lines with their rates; readable by pricing staff only (the table's rule), so pass `enabled` from that. */
export function useSubcontractOrderLines(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["subcontract-order-lines", orderId],
    enabled: enabled && !!orderId,
    queryFn: async () => {
      const { data, error } = await db.from("subcontract_order_lines").select("id,visit_line_id,description,quantity,uom,unit_cost_cents,cost_code,sort_order").eq("order_id", orderId!).order("sort_order");
      if (error) throw error;
      return ((data ?? []) as SubcontractOrderLineRow[]).map((l) => ({ ...l, quantity: Number(l.quantity), unit_cost_cents: l.unit_cost_cents === null ? null : Number(l.unit_cost_cents) }));
    },
  });
}
