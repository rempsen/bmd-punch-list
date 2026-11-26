import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { qboClientDiffs, qboPushClients } from "@/lib/qbo/invoice.functions";
import type { ClientDiff } from "@/lib/qbo/invoice.server";

/** Clients whose QuickBooks customer says something different. The client record wins: QuickBooks is updated to match. */
export function QboCustomerSync({ onClose }: { onClose: () => void }) {
  const diffsFn = useServerFn(qboClientDiffs);
  const pushFn = useServerFn(qboPushClients);
  const [diffs, setDiffs] = useState<ClientDiff[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const check = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await diffsFn();
      if (!r.ok) return setError(r.message);
      setDiffs(r.diffs);
      setPicked(new Set(r.diffs.map((d) => d.clientId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const push = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await pushFn({ data: { clientIds: [...picked] } });
      toast.success(`${r.updated} QuickBooks ${r.updated === 1 ? "customer" : "customers"} updated from the client records.`);
      if (r.failed.length) setError(r.failed.map((f) => `${f.name}: ${f.message}`).join("\n"));
      setBusy(false);
      await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Clients and QuickBooks customers</DialogTitle>
          <DialogDescription>Where a client and its QuickBooks customer differ, the client record is the up-to-date one: QuickBooks is updated to match. A blank on the client never clears QuickBooks.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto text-sm">
          {diffs == null ? (
            <p className="text-muted-foreground">Reads every customer from QuickBooks and compares it with the linked client. Nothing changes until you press Update.</p>
          ) : diffs.length === 0 ? (
            <p>Every linked client matches its QuickBooks customer.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {diffs.map((d) => (
                <li key={d.clientId} className="flex gap-3 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Update ${d.name}`}
                    checked={picked.has(d.clientId)}
                    onChange={(e) => {
                      const s = new Set(picked);
                      if (e.target.checked) s.add(d.clientId);
                      else s.delete(d.clientId);
                      setPicked(s);
                    }}
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{d.name}</p>
                    {d.changes.map((c) => (
                      <p key={c.field} className="break-words text-xs text-muted-foreground">
                        {c.field}: {c.from ?? "(blank)"} → <span className="text-foreground">{c.to}</span>
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="mt-3 whitespace-pre-line text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
          {diffs == null ? (
            <Button disabled={busy} onClick={() => void check()}>{busy ? "Reading QuickBooks…" : "Compare with QuickBooks"}</Button>
          ) : (
            diffs.length > 0 && <Button disabled={busy || picked.size === 0} onClick={() => void push()}>{busy ? "Updating…" : `Update ${picked.size} in QuickBooks`}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
