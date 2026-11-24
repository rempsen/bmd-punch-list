import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SubcontractOrderDrawer } from "@/components/visits/SubcontractOrderDrawer";
import { useAuth } from "@/lib/auth";
import { dollars } from "@/lib/estimating/data";
import { STATUS_LABEL } from "@/lib/subcontract/logic";
import { useSubcontractOrders, type SubcontractOrderRow } from "@/lib/subcontract/data";
import { cancelSubcontractOrder, createSubcontractOrder } from "@/lib/subcontract/subcontract.functions";

/** What an order looks like on the work-order card: "PO 26-002-SUB-01 · Billed $625.00". */
function orderChipLabel(o: Pick<SubcontractOrderRow, "po_number" | "status" | "subtotal_cents" | "qbo_bill_total_cents">, showMoney: boolean): string {
  const amount = o.status === "billed" || o.status === "paid" ? o.qbo_bill_total_cents : o.subtotal_cents;
  const money = showMoney && amount !== null && amount > 0 ? ` ${dollars(amount)}` : "";
  return `PO ${o.po_number} · ${STATUS_LABEL[o.status]}${money}`;
}

/**
 * The subcontractor purchase order for one work order: a chip with its number and status, and a menu to make, open,
 * send or cancel it. Shown only when the crew is a vendor record (a subcontractor); staff crews have no PO.
 */
export function SubcontractOrderChip({ projectId, visitId, technicianSupplierId, canEdit }: { projectId: string; visitId: string; technicianSupplierId: string | null; canEdit: boolean }) {
  const { canAny } = useAuth();
  const showMoney = canAny("view_pricing");
  const qc = useQueryClient();
  const { data: orders = [] } = useSubcontractOrders(projectId);
  const create = useServerFn(createSubcontractOrder);
  const cancel = useServerFn(cancelSubcontractOrder);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const order = orders.find((o) => o.visit_id === visitId && o.status !== "cancelled") ?? null;
  if (!technicianSupplierId && !order) return null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["subcontract-orders", projectId] });
  const make = async () => {
    setBusy(true);
    try {
      const r = await create({ data: { visitId } });
      if (!r.ok) return void toast.error(r.message);
      refresh();
      if (r.uncosted.length) toast.message(`Purchase order started. No rate yet for ${r.uncosted.join(", ")}: enter one before sending.`);
      else toast.success("Purchase order started.");
      setOpen(r.orderId);
    } finally {
      setBusy(false);
    }
  };
  const drop = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const r = await cancel({ data: { orderId: order.id } });
      if (!r.ok) return void toast.error(r.message);
      refresh();
      toast.success(`Purchase order ${order.po_number} cancelled.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {order ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted" disabled={busy}>
              {orderChipLabel(order, showMoney)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setOpen(order.id)}>Open purchase order</DropdownMenuItem>
            {canEdit && (order.status === "draft" || order.status === "sent") && (
              <DropdownMenuItem className="text-destructive" onSelect={() => void drop()}>
                Cancel purchase order
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        canEdit && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={() => void make()}>
            Create purchase order
          </Button>
        )
      )}
      {open && <SubcontractOrderDrawer orderId={open} projectId={projectId} canEdit={canEdit} onClose={() => setOpen(null)} />}
    </>
  );
}
