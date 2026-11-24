import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { syncSendNow, syncSendPreview, syncSendSetting } from "@/lib/sync/send.functions";
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
        <p className="mt-1 text-sm text-muted-foreground">Every change to a material, labour rate or supplier is kept here until it is sent. QuickBooks sending is below; ArrivePing is not connected for catalogue items yet.</p>
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

      <QuickBooksSend onDone={refresh} />

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

const OPW: Record<string, string> = { update: "Update", create: "Create", deactivate: "Make inactive" };

/** Sending catalogue changes to QuickBooks: see what would go, send the ticked ones, or let the schedule do it. */
function QuickBooksSend({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const previewFn = useServerFn(syncSendPreview);
  const sendFn = useServerFn(syncSendNow);
  const settingFn = useServerFn(syncSendSetting);
  const { data: setting } = useQuery({ queryKey: ["sync-send-setting"], queryFn: () => settingFn({ data: {} }) });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewFn>> | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "preview" | "send" | "switch">(null);

  const load = async () => {
    setBusy("preview");
    try {
      const p = await previewFn();
      setPreview(p);
      setTicked(new Set(p.sends.map((s) => s.outboxId)));
      if (!p.ok) toast.error(p.message);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    const ids = [...ticked];
    if (!ids.length) return;
    if (!window.confirm(`Send ${ids.length} change${ids.length === 1 ? "" : "s"} to QuickBooks now? BMD's values are written over what QuickBooks has. Nothing in QuickBooks is deleted.`)) return;
    setBusy("send");
    try {
      const r = await sendFn({ data: { ids } });
      if ("skipped" in r && r.skipped) return void toast.error(r.skipped);
      toast.success(`Sent ${r.sent}${r.failed ? `, ${r.failed} failed (see the list above)` : ""}${r.held ? `, ${r.held} held` : ""}.`, { duration: 8000 });
      setPreview(null);
      onDone();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const flip = async (enabled: boolean) => {
    if (enabled && !window.confirm("Turn on automatic sending? Every 5 minutes, waiting catalogue changes are written to QuickBooks. BMD's value always wins; nothing is ever deleted in QuickBooks.")) return;
    setBusy("switch");
    try {
      await settingFn({ data: { enabled } });
      void qc.invalidateQueries({ queryKey: ["sync-send-setting"] });
      toast.success(enabled ? "Automatic sending is on" : "Automatic sending is off");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Send to QuickBooks</h2>
      <p className="mt-1 text-sm text-muted-foreground">Materials and labour become QuickBooks items (purchase cost only, never a selling price); suppliers become vendors. BMD's value always wins. A record removed here is made inactive in QuickBooks, never deleted.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Switch checked={setting?.enabled ?? false} disabled={busy !== null || !setting} onCheckedChange={(v) => void flip(v)} aria-label="Send changes to QuickBooks automatically" />
        <span className="text-sm">
          Send changes to QuickBooks automatically (every 5 minutes)
          {setting?.lastSendAt ? <span className="text-muted-foreground"> · last run {when(setting.lastSendAt)}</span> : null}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void load()}>
          {busy === "preview" ? "Checking…" : preview ? "Check again" : "Preview what would be sent"}
        </Button>
        {preview?.ok && preview.sends.length > 0 && (
          <Button disabled={busy !== null || ticked.size === 0} onClick={() => void send()}>
            {busy === "send" ? "Sending…" : `Send ${ticked.size} ticked now`}
          </Button>
        )}
      </div>
      {preview?.ok && (
        <div className="mt-3 space-y-2">
          {preview.sends.length === 0 && preview.held.length === 0 && <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing to send. QuickBooks matches BMD.</p>}
          {preview.sends.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {preview.sends.map((s) => (
                <li key={s.outboxId} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <Checkbox className="mt-0.5" checked={ticked.has(s.outboxId)} onCheckedChange={(v) => setTicked((t) => { const n = new Set(t); if (v === true) n.add(s.outboxId); else n.delete(s.outboxId); return n; })} aria-label={`Send ${s.label}`} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-xs text-muted-foreground"> · {KIND[s.kind] ?? s.kind} · {OPW[s.op]} {s.target === "Vendor" ? "vendor" : "item"}</span>
                    <span className="block text-muted-foreground">{s.summary.length ? s.summary.join("; ") : "no field changes"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview.held.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">Held back ({preview.held.length})</p>
              <ul className="mt-1 space-y-0.5 text-amber-900">
                {preview.held.map((h) => (
                  <li key={h.outboxId}>
                    <span className="font-medium">{h.label}</span>: {h.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
