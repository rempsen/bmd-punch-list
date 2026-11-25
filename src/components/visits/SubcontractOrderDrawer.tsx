import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { dollars } from "@/lib/estimating/data";
import { errText } from "@/lib/platform/db";
import { useSubcontractOrderLines, useSubcontractOrders } from "@/lib/subcontract/data";
import { STATUS_LABEL, orderTotal, uncostedLines } from "@/lib/subcontract/logic";
import { sendSubcontractOrder, updateSubcontractOrder } from "@/lib/subcontract/subcontract.functions";

type Draft = { id?: string; visit_line_id: string | null; description: string; quantity: string; uom: string; rate: string; cost_code: string | null };

const toCents = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const fromCents = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Winnipeg", month: "short", day: "numeric", year: "numeric" }) : "");

/** Review a subcontractor purchase order's lines and rates, then send it to QuickBooks. Sent orders are read-only. */
export function SubcontractOrderDrawer({ orderId, projectId, canEdit, onClose }: { orderId: string; projectId: string; canEdit: boolean; onClose: () => void }) {
  const { canAny } = useAuth();
  const canPrice = canAny("view_pricing");
  const qc = useQueryClient();
  const { data: orders = [] } = useSubcontractOrders(projectId, canPrice);
  const order = orders.find((o) => o.id === orderId) ?? null;
  const lines = useSubcontractOrderLines(orderId, canPrice);
  const update = useServerFn(updateSubcontractOrder);
  const send = useServerFn(sendSubcontractOrder);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canEdit && canPrice && order?.status === "draft";

  useEffect(() => {
    if (lines.data) setDraft(lines.data.map((l) => ({ id: l.id, visit_line_id: l.visit_line_id, description: l.description, quantity: String(l.quantity), uom: l.uom, rate: fromCents(l.unit_cost_cents), cost_code: l.cost_code })));
  }, [lines.data]);
  useEffect(() => {
    if (order) setNotes(order.notes ?? "");
  }, [order]);

  const asLines = () => draft.map((d) => ({ id: d.id, visit_line_id: d.visit_line_id, description: d.description, quantity: Number(d.quantity) || 0, uom: d.uom, unit_cost_cents: toCents(d.rate), cost_code: d.cost_code }));
  const totals = orderTotal(asLines());
  const blank = uncostedLines(asLines());
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["subcontract-orders", projectId] });
    void qc.invalidateQueries({ queryKey: ["subcontract-order-lines", orderId] });
  };

  const save = async (): Promise<boolean> => {
    const r = await update({ data: { orderId, lines: asLines(), notes } });
    if (!r.ok) {
      toast.error(r.message);
      return false;
    }
    refresh();
    return true;
  };
  const onSave = async () => {
    setBusy(true);
    try {
      if (await save()) toast.success("Purchase order saved.");
    } finally {
      setBusy(false);
    }
  };
  const onSend = async () => {
    setBusy(true);
    try {
      if (!(await save())) return;
      const r = await send({ data: { orderId, email: email.trim() || undefined } });
      if (!r.ok) return void toast.error(r.message);
      refresh();
      toast.success(`Purchase order ${r.poNumber} is in QuickBooks${r.qboDocNumber && r.qboDocNumber !== r.poNumber ? ` as ${r.qboDocNumber}` : ""}${r.emailed ? " and emailed to the subcontractor" : ""}.`);
    } finally {
      setBusy(false);
    }
  };
  const set = (i: number, patch: Partial<Draft>) => setDraft((d) => d.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{order ? `Purchase order ${order.po_number}` : "Purchase order"}</SheetTitle>
          <SheetDescription>
            {order ? `${order.supplier?.name ?? "Subcontractor"} · ${STATUS_LABEL[order.status]}` : ""}
            {order?.qbo_po_sent_at ? ` · sent to QuickBooks ${when(order.qbo_po_sent_at)}` : ""}
            {order?.billed_at ? ` · billed ${when(order.billed_at)}${order.qbo_bill_total_cents !== null && canPrice ? ` (${dollars(order.qbo_bill_total_cents)})` : ""}` : ""}
            {order?.paid_at ? ` · paid ${when(order.paid_at)}` : ""}
          </SheetDescription>
        </SheetHeader>
        {!canPrice ? (
          <p className="mt-4 text-sm text-muted-foreground">The lines and rates are for pricing staff. The order's status is shown on the work order.</p>
        ) : lines.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : lines.error ? (
          <p className="mt-4 text-sm text-destructive">{errText(lines.error)}</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_5rem_4rem_6rem_6rem] gap-2 text-xs text-muted-foreground">
                <span>Work</span>
                <span className="text-right">Qty</span>
                <span>Unit</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Amount</span>
              </div>
              {draft.map((l, i) => {
                const cents = toCents(l.rate);
                return (
                  <div key={l.id ?? i} className="grid grid-cols-[1fr_5rem_4rem_6rem_6rem] items-center gap-2 text-sm">
                    {editable ? <Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} /> : <span className="truncate">{l.description}</span>}
                    {editable ? <Input className="text-right" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /> : <span className="text-right">{l.quantity}</span>}
                    <span className="text-muted-foreground">{l.uom}</span>
                    {editable ? (
                      <Input className="text-right" inputMode="decimal" placeholder="—" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
                    ) : (
                      <span className="text-right">{cents === null ? "—" : dollars(cents)}</span>
                    )}
                    <span className="text-right">{cents === null ? <span className="text-muted-foreground">no rate</span> : dollars(Math.round(cents * (Number(l.quantity) || 0)))}</span>
                  </div>
                );
              })}
              {editable && (
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => [...d, { visit_line_id: null, description: "", quantity: "1", uom: "EA", rate: "", cost_code: null }])}>
                  + Add a line
                </Button>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-sm">
                <span className="text-muted-foreground">{blank.length ? `${blank.length} line${blank.length === 1 ? "" : "s"} without a rate` : "All lines costed"}</span>
                <span className="font-medium">Subtotal {dollars(totals.subtotal_cents)}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="sub-po-notes">
                Notes for the subcontractor
              </label>
              <Textarea id="sub-po-notes" value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            {editable && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Send to QuickBooks as a purchase order to {order?.supplier?.name ?? "the vendor"}. Add an email to have QuickBooks send it too; leave blank to only record it.</p>
                <Input type="email" placeholder="subcontractor@example.com (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => void onSave()}>
                    Save draft
                  </Button>
                  <Button disabled={busy || !draft.length || blank.length > 0} onClick={() => void onSend()} title={blank.length ? "Enter a rate on every line first" : undefined}>
                    Send to QuickBooks
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
