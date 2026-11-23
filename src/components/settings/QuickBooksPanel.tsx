import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, errText } from "@/lib/platform/db";
import { qboConnectStart, qboDisconnect, qboPullProducts, qboStatus } from "@/lib/qbo/qbo.functions";
import { planSummary, type Action } from "@/lib/sync/import";
import { applyImport, loadImportPlan } from "@/lib/sync/import.data";

const KINDS: [string, string][] = [
  ["material", "products"],
  ["labour", "labour items"],
  ["cost_code", "cost-code items"],
  ["supplier", "vendors"],
  ["category", "categories"],
  ["other", "other items (fees, holdback and the like)"],
];
/** "12 products, 3 labour items, 390 vendors" */
export const pullSummary = (counts: Record<string, number>) => KINDS.filter(([k]) => counts[k]).map(([k, label]) => `${counts[k]!.toLocaleString("en-CA")} ${label}`).join(", ") || "nothing";
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

/** Company settings → Sync: the app's own QuickBooks connection, and pulling products and vendors from it. */
export function QuickBooksPanel({ result, message }: { result?: string | undefined; message?: string | undefined }) {
  const statusFn = useServerFn(qboStatus);
  const startFn = useServerFn(qboConnectStart);
  const disconnectFn = useServerFn(qboDisconnect);
  const pullFn = useServerFn(qboPullProducts);
  const qc = useQueryClient();
  const { data: s, isLoading, error } = useQuery({ queryKey: ["qbo-status"], queryFn: () => statusFn() });
  const { data: staged } = useQuery({
    queryKey: ["qbo-staged"],
    queryFn: async () => {
      const { data, error: e } = await db.from("sync_staging").select("kind").eq("system", "quickbooks").limit(5000);
      if (e) throw e;
      const counts: Record<string, number> = {};
      for (const r of (data ?? []) as { kind: string }[]) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
      return counts;
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [plan, setPlan] = useState<Action[] | null>(null);   // the dry run on screen

  const preview = async () => {
    setBusy("preview");
    try {
      setPlan((await loadImportPlan("quickbooks")).plan);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const runImport = async () => {
    if (!plan) return;
    const n = planSummary(plan).writes;
    if (!window.confirm(`Import ${n.toLocaleString("en-CA")} records into BMD Projects? Nothing in QuickBooks is changed. Where BMD already has a value, BMD's value stays.`)) return;
    setBusy("import");
    try {
      const r = await applyImport("quickbooks", plan);
      toast.success(`Imported: ${r.created.toLocaleString("en-CA")} added, ${r.linked.toLocaleString("en-CA")} matched to what BMD already had.`, { duration: 9000 });
      setPlan(null);
      for (const k of ["catalogue", "sync", "qbo-staged"]) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast.error(`The import stopped: ${errText(e)}. What was imported before the stop is kept; run the dry run again to see what is left.`, { duration: 12000 });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (result === "connected") toast.success("QuickBooks connected");
    if (result === "error") toast.error(message || "Could not connect QuickBooks");
  }, [result, message]);

  const connect = async () => {
    setBusy("connect");
    try {
      window.location.assign((await startFn()).url);
    } catch (e) {
      toast.error(errText(e));
      setBusy(null);
    }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect QuickBooks? Nothing in QuickBooks or in BMD Projects is removed, but pulls stop until you connect again.")) return;
    setBusy("disconnect");
    try {
      await disconnectFn();
      toast.success("QuickBooks disconnected");
      void qc.invalidateQueries({ queryKey: ["qbo-status"] });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const pull = async () => {
    setBusy("pull");
    try {
      const r = await pullFn();
      if (r.ok) toast.success(`Read from QuickBooks: ${pullSummary(r.counts)}. Nothing has been added to the catalogue yet.`);
      else toast.error(r.message);
      void qc.invalidateQueries({ queryKey: ["qbo-status"] });
      void qc.invalidateQueries({ queryKey: ["qbo-staged"] });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Checking QuickBooks…</section>;
  if (error || !s) return <section className="rounded-lg border border-border bg-card p-4 text-sm text-destructive">Could not check QuickBooks: {errText(error)}</section>;
  const c = s.connection;
  const stagedTotal = Object.values(staged ?? {}).reduce((a, b) => a + b, 0);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">QuickBooks</h2>
      {!s.configured ? (
        <div className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Not set up yet. BMD Projects needs its own QuickBooks app keys before it can connect. They are added once, through the secure secret form, as <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code>. Until then nothing here can
            reach QuickBooks.
          </p>
        </div>
      ) : !c ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Not connected. Connecting signs you in to QuickBooks and asks which company to use. BMD Projects only reads from it for now.</p>
          {s.canManage ? (
            <Button className="mt-3 h-11" disabled={busy !== null} onClick={() => void connect()}>
              {busy === "connect" ? "Opening QuickBooks…" : "Connect to QuickBooks"}
            </Button>
          ) : (
            <p className="mt-2 text-sm">Ask someone who manages integrations to connect it.</p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Connected to <span className="font-medium">{c.company_name ?? "QuickBooks"}</span> since {when(c.connected_at)}
          </p>
          {c.last_error && <p className="mt-1 text-sm text-destructive">Last problem: {c.last_error}. If pulls keep failing, disconnect and connect again.</p>}
          <p className="mt-1 text-sm text-muted-foreground">{c.last_pull_at ? `Last read ${when(c.last_pull_at)}.` : "Nothing has been read yet."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {s.canPull && (
              <Button className="h-11" disabled={busy !== null} onClick={() => void pull()}>
                {busy === "pull" ? "Reading QuickBooks…" : "Pull products and vendors"}
              </Button>
            )}
            {s.canManage && (
              <Button variant="ghost" className="h-11" disabled={busy !== null} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            )}
          </div>
        </>
      )}
      {stagedTotal > 0 && (
        <div className="mt-3 rounded-md bg-muted/60 p-3 text-sm">
          <p>Held for review from the last read: {pullSummary(staged ?? {})}. These are a copy. Nothing in QuickBooks has changed.</p>
          {s.canPull && (
            <Button variant="outline" className="mt-2 h-10 bg-background" disabled={busy !== null} onClick={() => void preview()}>
              {busy === "preview" ? "Working it out…" : plan ? "Run the dry run again" : "Dry run: show what an import would do"}
            </Button>
          )}
        </div>
      )}
      {plan && <DryRun plan={plan} busy={busy !== null} onImport={() => void runImport()} onClose={() => setPlan(null)} />}
    </section>
  );
}

const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-CA")} ${count === 1 ? one : many}`;
const ROWS: [keyof ReturnType<typeof planSummary>["byKind"], string][] = [
  ["material", "Materials"],
  ["labour", "Labour rates"],
  ["supplier", "Suppliers"],
  ["cost_code", "Cost codes"],
];

/** The dry run: exactly what an import would add, match and leave alone, before anything is written. */
function DryRun({ plan, busy, onImport, onClose }: { plan: Action[]; busy: boolean; onImport: () => void; onClose: () => void }) {
  const sum = planSummary(plan);
  const [show, setShow] = useState<string | null>(null);
  const listed = show ? plan.filter((a) => `${a.kind}|${a.op}` === show) : [];
  const cell = (kind: string, op: "create" | "link" | "linked", n: number) =>
    n === 0 ? (
      <span className="text-muted-foreground">0</span>
    ) : (
      <button type="button" className="font-medium text-primary underline" onClick={() => setShow(show === `${kind}|${op}` ? null : `${kind}|${op}`)}>
        {n.toLocaleString("en-CA")}
      </button>
    );
  return (
    <div className="mt-3 rounded-md border border-border p-3 text-sm">
      <h3 className="font-semibold">Dry run: nothing has been imported yet</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">Would be added</th>
              <th className="py-1 text-right font-medium">Matched to BMD's</th>
              <th className="py-1 text-right font-medium">Already linked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ROWS.map(([k, label]) => (
              <tr key={k}>
                <td className="py-1.5">{label}</td>
                <td className="py-1.5 text-right tabular-nums">{cell(k, "create", sum.byKind[k].create)}</td>
                <td className="py-1.5 text-right tabular-nums">{cell(k, "link", sum.byKind[k].link)}</td>
                <td className="py-1.5 text-right tabular-nums">{cell(k, "linked", sum.byKind[k].linked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded border border-border bg-muted/40 p-2 text-xs">
          {listed.slice(0, 500).map((a) => (
            <li key={`${a.kind}-${a.external_id}`} className="py-0.5">
              {a.name}
              {typeof a.fields["unit_cost_cents"] === "number" ? ` · $${(a.fields["unit_cost_cents"] / 100).toFixed(2)}` : a.op === "create" && (a.kind === "material" || a.kind === "labour") ? " · cost unknown" : ""}
              {a.kept?.length ? " · BMD's own value kept" : ""}
            </li>
          ))}
          {listed.length > 500 && <li className="py-0.5 text-muted-foreground">and {(listed.length - 500).toLocaleString("en-CA")} more</li>}
        </ul>
      )}
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>{n(sum.skipped, "QuickBooks item is", "QuickBooks items are")} left where {sum.skipped === 1 ? "it is" : "they are"} (categories, fees, holdback and similar).</li>
        <li>New materials and labour arrive with the unit still to confirm, because QuickBooks does not hold units.</li>
        {sum.unknownCosts > 0 && <li>{n(sum.unknownCosts, "arrives", "arrive")} with the cost unknown, because QuickBooks has no cost there. Unknown is not zero.</li>}
        {sum.kept > 0 && <li>{n(sum.kept, "value differs", "values differ")} from QuickBooks where BMD already has its own. BMD's {sum.kept === 1 ? "stays" : "stay"}.</li>}
        {sum.duplicates.length > 0 && (
          <li>
            {n(sum.duplicates.length, "group looks", "groups look")} like the same product under different names, for example: {sum.duplicates.slice(0, 3).map((g) => g.join(" / ")).join("; ")}. They are all imported; merge them in the catalogue afterwards.
          </li>
        )}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-11" disabled={busy || sum.writes === 0} onClick={onImport}>
          {sum.writes === 0 ? "Nothing to import" : `Import ${sum.writes.toLocaleString("en-CA")} records`}
        </Button>
        <Button variant="ghost" className="h-11" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
