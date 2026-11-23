import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errText } from "@/lib/platform/db";
import { markReviewed, useRefreshSync, useSync } from "@/lib/sync/data";
import { changeSummary } from "@/lib/sync/logic";

const SYSTEMS: { id: string; name: string; note: string }[] = [
  { id: "quickbooks", name: "QuickBooks", note: "Connected directly from BMD Projects, under Integrations." },
  { id: "arriveping", name: "ArrivePing", note: "Customers and work orders connect under Integrations. Catalogue items are not exchanged with ArrivePing yet." },
  { id: "companycam", name: "CompanyCam", note: "Read-only for now. Not connected to the sync yet." },
];
const KIND: Record<string, string> = { material: "Material", labour: "Labour rate", supplier: "Supplier", client: "Client", cost_code: "Cost code", project: "Project" };
const OP: Record<string, string> = { create: "New", update: "Changed", delete: "Deleted" };
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

/** Company settings → Sync: what BMD Projects is holding for the other systems, and what has moved between them. */
export function SyncPanel() {
  const { data, isLoading, error } = useSync();
  const refresh = useRefreshSync();
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Could not load the sync status: {errText(error)}</p>;
  const kept = data.log.filter((l) => l.outcome === "bmd_kept" && !l.reviewed_at);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">BMD Projects is the source of truth</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes made here are sent to QuickBooks and ArrivePing. Changes made there come back here. If the two disagree, the value in BMD Projects stays and is sent again, and the difference is listed below for you to look at.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {SYSTEMS.map((s) => (
            <li key={s.id} className="rounded-md border border-border p-3">
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{s.note}</p>
              <p className="mt-1 text-sm tabular-nums">{(data.links[s.id] ?? 0).toLocaleString("en-CA")} records linked</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 font-semibold">Waiting to be sent ({data.waiting.toLocaleString("en-CA")})</h2>
          <Button variant="outline" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Every change to a material, labour rate or supplier is kept here until a connection exists. Nothing has been sent anywhere yet.</p>
        {data.outbox.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing is waiting.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {data.outbox.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                <span className="font-medium">{o.label ?? "(no name)"}</span>
                <span className="text-xs text-muted-foreground">
                  {KIND[o.kind] ?? o.kind} · {OP[o.op]}
                  {o.status === "failed" ? " · failed" : ""}
                </span>
                <span className="min-w-0 flex-1 basis-full text-muted-foreground sm:basis-auto">{o.op === "delete" ? "Removed from the catalogue" : changeSummary(o.changes)}</span>
                <span className="text-xs text-muted-foreground">{when(o.updated_at)}</span>
                {o.error && <span className="basis-full text-xs text-destructive">{o.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">BMD kept its value ({kept.length})</h2>
        <p className="mt-1 text-sm text-muted-foreground">Times another system tried to change something BMD Projects had also changed. BMD's value stayed. Nothing here needs a decision; it is for you to look over.</p>
        {kept.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing to look at.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {kept.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.label ?? KIND[l.kind] ?? l.kind}</span> · {l.system} · {when(l.at)}
                </span>
                <Button size="sm" variant="outline" onClick={() => void markReviewed(l.id).then(refresh, (e) => toast.error(errText(e)))}>
                  Mark as looked at
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">History</h2>
        {data.log.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing has been pulled in or sent out yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {data.log.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="text-xs text-muted-foreground">{when(l.at)}</span>
                <span>
                  {l.direction === "in" ? "From" : "To"} {l.system}: {l.label ?? KIND[l.kind] ?? l.kind} ({l.outcome.replace("_", " ")})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
