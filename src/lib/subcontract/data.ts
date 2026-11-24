import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { OrderLine, SubcontractOrder } from "./logic";

export type SubcontractOrderRow = SubcontractOrder & { supplier: { name: string } | null };
export type SubcontractOrderLineRow = OrderLine & { id: string };

const COLS = "id,project_id,visit_id,supplier_id,po_number,status,subtotal_cents,notes,qbo_po_id,qbo_po_sent_at,qbo_bill_id,qbo_bill_total_cents,billed_at,paid_at,created_at,supplier:suppliers(name)";

/** A job's subcontractor purchase orders, oldest first. Shared by the work-order cards and the Billing tab. */
export function useSubcontractOrders(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["subcontract-orders", projectId],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("subcontract_orders").select(COLS).eq("project_id", projectId).order("created_at");
      if (error) throw error;
      return ((data ?? []) as unknown as SubcontractOrderRow[]).map((o) => ({ ...o, subtotal_cents: Number(o.subtotal_cents), qbo_bill_total_cents: o.qbo_bill_total_cents === null ? null : Number(o.qbo_bill_total_cents) }));
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
