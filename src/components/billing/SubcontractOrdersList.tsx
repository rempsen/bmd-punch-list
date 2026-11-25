import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SubcontractOrderDrawer } from "@/components/visits/SubcontractOrderDrawer";
import { useAuth } from "@/lib/auth";
import { dollars } from "@/lib/estimating/data";
import { errText } from "@/lib/platform/db";
import { useSubcontractOrders } from "@/lib/subcontract/data";
import { STATUS_LABEL } from "@/lib/subcontract/logic";
import { subcontractReadBack } from "@/lib/subcontract/subcontract.functions";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Winnipeg", month: "short", day: "numeric", year: "numeric" }) : "—");

/** The job's subcontractor purchase orders and where each stands in QuickBooks: sent, billed, paid. */
export function SubcontractOrdersList({ projectId }: { projectId: string }) {
  const { canAny, isSuperAdmin } = useAuth();
  const canPrice = canAny("view_pricing");
  const canCheck = isSuperAdmin || canAny("manage_projects");
  const qc = useQueryClient();
  const { data: orders = [], isLoading, error } = useSubcontractOrders(projectId, canPrice);
  const readBack = useServerFn(subcontractReadBack);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const r = await readBack({ data: { projectId } });
      if (!r.ok) return void toast.error(r.message);
      void qc.invalidateQueries({ queryKey: ["subcontract-orders", projectId] });
      if (!r.checked) toast.message("No purchase orders are waiting on a bill.");
      else if (!r.billed && !r.paid) toast.message(`Checked ${r.checked}; QuickBooks has no new bills or payments for them yet.`);
      else toast.success(`${r.billed ? `${r.billed} now billed` : ""}${r.billed && r.paid ? ", " : ""}${r.paid ? `${r.paid} now paid` : ""}.`);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return null;
  if (error) return <section className="border-t border-border py-4"><h3 className="font-medium">Subcontractor orders</h3><p className="mt-2 text-xs text-muted-foreground">Subcontractor orders unavailable: {errText(error)}</p></section>;
  const live = orders.filter((o) => o.status !== "cancelled");
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">Subcontractor orders</h3>
          <p className="text-xs text-muted-foreground">Purchase orders to subcontractors from this job's work orders. QuickBooks' bill against each, and its payment, are read back here.</p>
        </div>
        {canCheck && live.some((o) => o.status === "sent" || o.status === "billed") && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>
            Check QuickBooks
          </Button>
        )}
      </div>
      {live.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">None yet. Start one from a work order whose crew is a subcontractor.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 font-normal">PO</th>
              <th className="py-1 font-normal">Subcontractor</th>
              {canPrice && <th className="py-1 text-right font-normal">Order</th>}
              <th className="py-1 font-normal">Status</th>
              <th className="py-1 font-normal">Billed</th>
              <th className="py-1 font-normal">Paid</th>
            </tr>
          </thead>
          <tbody>
            {live.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="py-1.5">
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setOpen(o.id)}>
                    {o.po_number}
                  </button>
                </td>
                <td className="py-1.5">{o.supplier?.name ?? "—"}</td>
                {canPrice && <td className="py-1.5 text-right">{dollars(o.subtotal_cents)}</td>}
                <td className="py-1.5">{STATUS_LABEL[o.status]}</td>
                <td className="py-1.5">{o.billed_at ? `${day(o.billed_at)}${canPrice && o.qbo_bill_total_cents !== null ? ` · ${dollars(o.qbo_bill_total_cents)}` : ""}` : "—"}</td>
                <td className="py-1.5">{day(o.paid_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <SubcontractOrderDrawer orderId={open} projectId={projectId} canEdit={canCheck} onClose={() => setOpen(null)} />}
    </section>
  );
}
