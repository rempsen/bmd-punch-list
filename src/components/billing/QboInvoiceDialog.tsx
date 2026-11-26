import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createQboInvoice, previewQboInvoice } from "@/lib/qbo/invoice.functions";
import type { InvoicePreview } from "@/lib/qbo/invoice.server";

/** Preview, then create the bill as an unsent invoice in QuickBooks. Sending it to the client is done from QuickBooks. */
export function QboInvoiceDialog({ billId, number, onClose, onCreated }: { billId: string; number: string; onClose: () => void; onCreated: () => void }) {
  const preview = useServerFn(previewQboInvoice);
  const create = useServerFn(createQboInvoice);
  const [p, setP] = useState<InvoicePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void preview({ data: { billId } }).then(setP, (e: unknown) => setP({ ok: false, message: e instanceof Error ? e.message : String(e) }));
  }, [billId, preview]);
  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await create({ data: { billId } });
      if (!r.ok) return setError(r.message);
      toast.success(`${number} is in QuickBooks${r.docNumber ? ` as invoice ${r.docNumber}` : ""}, unsent.${r.customerChanges.length ? ` Customer updated: ${r.customerChanges.map((c) => c.field.toLowerCase()).join(", ")}.` : ""}`);
      if (r.warning) toast.warning(r.warning, { duration: 15000 });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create {number} in QuickBooks</DialogTitle>
          <DialogDescription>It is created unsent, for you to check and send from QuickBooks. Nothing is emailed from here.</DialogDescription>
        </DialogHeader>
        {!p && <p className="text-sm text-muted-foreground">Checking QuickBooks…</p>}
        {p && !p.ok && <p className="text-sm text-destructive">{p.message}</p>}
        {p?.ok && (
          <div className="space-y-3 text-sm">
            <p>Customer: <strong>{p.customerName ?? "—"}</strong></p>
            <ul className="space-y-0.5 rounded-md border bg-muted/40 p-3">
              {p.summary.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground">Lines go on “{p.names.lineItem}”, holdback on “{p.names.holdbackItem}”, tax code {p.names.gst}.</p>
            {p.customerChanges.length > 0 && (
              <div className="rounded-md border border-amber-500/50 p-3">
                <p className="mb-1 font-medium">The client record differs from QuickBooks. QuickBooks is updated first:</p>
                <ul className="space-y-0.5">
                  {p.customerChanges.map((c) => (
                    <li key={c.field}>{c.field}: {c.from ?? "(blank)"} → <strong>{c.to}</strong></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !p?.ok} onClick={() => void go()}>{busy ? "Creating…" : "Create unsent invoice"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
