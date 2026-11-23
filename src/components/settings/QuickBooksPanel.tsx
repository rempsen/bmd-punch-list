import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { db, errText } from "@/lib/platform/db";
import { qboConnectStart, qboDisconnect, qboPullProducts, qboStatus } from "@/lib/qbo/qbo.functions";
import { actionKey, chosenActions, planSummary, type Action, type ImportPick } from "@/lib/sync/import";
import { applyImport, applyRetypes, loadImportPlan } from "@/lib/sync/import.data";

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

/** Company settings → Integrations: the app's own QuickBooks connection, and pulling products and vendors from it. */
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
  const [picks, setPicks] = useState<Map<string, ImportPick>>(new Map());   // where each row started, and why
  const [ticked, setTicked] = useState<Set<string>>(new Set());              // what is ticked now

  const preview = async () => {
    setBusy("preview");
    try {
      const r = await loadImportPlan("quickbooks");
      setPicks(r.picks);
      setTicked(new Set([...r.picks].filter(([, p]) => p.on).map(([k]) => k)));
      setPlan(r.plan);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const runImport = async () => {
    if (!plan) return;
    const { actions, addedSuppliers, retypes } = chosenActions(plan, (k) => ticked.has(k));
    const also = addedSuppliers.length ? `\n\n${addedSuppliers.length === 1 ? "1 supplier you left unticked comes" : `${addedSuppliers.length} suppliers you left unticked come`} along because a ticked product names ${addedSuppliers.length === 1 ? "it" : "them"}: ${addedSuppliers.slice(0, 5).join(", ")}${addedSuppliers.length > 5 ? "…" : ""}.` : "";
    const re = retypes.length ? `\n\n${retypes.length === 1 ? "1 vendor BMD already has is" : `${retypes.length} vendors BMD already has are`} also marked as supplying materials and labour, as their bills show both.` : "";
    if (!window.confirm(`Import ${(actions.length + retypes.length).toLocaleString("en-CA")} records into BMD Projects? Nothing in QuickBooks is changed. Where BMD already has a value, BMD's value stays. What you left unticked stays held for later.${also}${re}`)) return;
    setBusy("import");
    try {
      const r = actions.length ? await applyImport("quickbooks", actions) : { created: 0, linked: 0, skipped: 0 };
      const changed = await applyRetypes(retypes);
      toast.success(`Imported: ${r.created.toLocaleString("en-CA")} added, ${r.linked.toLocaleString("en-CA")} matched to what BMD already had${changed ? `, ${changed.toLocaleString("en-CA")} vendor${changed === 1 ? "" : "s"} re-marked` : ""}.`, { duration: 9000 });
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
      {plan && <DryRun plan={plan} picks={picks} ticked={ticked} setTicked={setTicked} busy={busy !== null} onImport={() => void runImport()} onClose={() => setPlan(null)} />}
    </section>
  );
}

const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-CA")} ${count === 1 ? one : many}`;
const ROWS: [keyof ReturnType<typeof planSummary>["byKind"], string][] = [
  ["material", "Materials"],
  ["labour", "Labour rates"],
  ["supplier", "Suppliers & subcontractors"],
  ["cost_code", "Cost codes"],
];

/** The dry run: exactly what an import would add and match, with a tick on every row, before anything is written. */
function DryRun({ plan, picks, ticked, setTicked, busy, onImport, onClose }: { plan: Action[]; picks: Map<string, ImportPick>; ticked: Set<string>; setTicked: (s: Set<string>) => void; busy: boolean; onImport: () => void; onClose: () => void }) {
  const [show, setShow] = useState<string | null>(null);
  const { actions, retypes } = chosenActions(plan, (k) => ticked.has(k));
  const all = planSummary(plan);
  const chosen = planSummary([...actions, ...plan.filter((a) => a.op === "skip")]);
  const rows = (kind: string, op: string) => plan.filter((a) => a.kind === kind && a.op === op);
  const listed = show ? rows(show.split("|")[0]!, show.split("|")[1]!) : [];
  const setMany = (keys: string[], on: boolean) => {
    const next = new Set(ticked);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    setTicked(next);
  };
  const cell = (kind: string, op: "create" | "link" | "linked") => {
    const list = rows(kind, op);
    if (list.length === 0) return <span className="text-muted-foreground">0</span>;
    const on = op === "linked" ? list.length : list.filter((a) => ticked.has(actionKey(a))).length;
    const id = `${kind}|${op}`;
    return (
      <button type="button" className="font-medium text-primary underline" aria-expanded={show === id} onClick={() => setShow(show === id ? null : id)}>
        {op === "linked" || on === list.length ? list.length.toLocaleString("en-CA") : `${on.toLocaleString("en-CA")} of ${list.length.toLocaleString("en-CA")}`}
      </button>
    );
  };
  const left = plan.filter((a) => (a.op === "create" || a.op === "link") && !ticked.has(actionKey(a))).length;
  const keys = listed.filter((a) => a.op !== "linked").map(actionKey);
  return (
    <div className="mt-3 rounded-md border border-border p-3 text-sm">
      <h3 className="font-semibold">Dry run: nothing has been imported yet</h3>
      <p className="mt-1 text-muted-foreground">Tap a number to see the rows and tick what comes in. Vendors start ticked only if BMD has bought materials or labour from them; tax, billing and one-job lines start unticked.</p>
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
                <td className="py-1.5 text-right tabular-nums">{cell(k, "create")}</td>
                <td className="py-1.5 text-right tabular-nums">{cell(k, "link")}</td>
                <td className="py-1.5 text-right tabular-nums">{cell(k, "linked")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && (
        <div className="mt-2 rounded border border-border bg-muted/40 p-2">
          {keys.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-2 text-xs">
              <Button variant="outline" size="sm" className="h-8 bg-background" onClick={() => setMany(keys, true)}>Tick all {keys.length.toLocaleString("en-CA")}</Button>
              <Button variant="outline" size="sm" className="h-8 bg-background" onClick={() => setMany(keys, false)}>Untick all</Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setTicked(new Set([...[...ticked].filter((k) => !keys.includes(k)), ...keys.filter((k) => picks.get(k)?.on)]))}>Back to suggested</Button>
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto text-xs">
            {listed.map((a) => {
              const k = actionKey(a);
              const why = picks.get(k)?.why;
              const cost = typeof a.fields["unit_cost_cents"] === "number" ? ` · $${(a.fields["unit_cost_cents"] / 100).toFixed(2)}` : a.op === "create" && (a.kind === "material" || a.kind === "labour") ? " · cost unknown" : "";
              return (
                <li key={k} className="py-0.5">
                  {a.op === "linked" ? (
                    <span className="pl-6">{a.name}</span>
                  ) : (
                    <label className="flex min-h-8 cursor-pointer items-center gap-2">
                      <Checkbox checked={ticked.has(k)} onCheckedChange={(v) => setMany([k], v === true)} aria-label={`Import ${a.name}`} />
                      <span>
                        {a.name}
                        {cost}
                        {a.kind === "supplier" && (a.fields["supplies"] === "labour" || a.fields["supplies"] === "both") && <span className="font-medium"> · {a.fields["supplies"] === "both" ? "materials and labour" : "labour"}</span>}
                        {a.kept?.length ? " · BMD's own value kept" : ""}
                        {why && <span className="text-muted-foreground"> · {why}</span>}
                      </span>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
        {retypes.length > 0 && (
          <li className="text-foreground">
            {n(retypes.length, "vendor BMD already has", "vendors BMD already has")} will be marked as supplying materials and labour, because {retypes.length === 1 ? "its" : "their"} bills show both:{" "}
            {retypes.slice(0, 6).map((a) => a.name).join(", ")}
            {retypes.length > 6 ? ` and ${retypes.length - 6} more` : ""}.
          </li>
        )}
        {left > 0 && <li>{n(left, "row is", "rows are")} unticked. {left === 1 ? "It stays" : "They stay"} held here and can be imported later.</li>}
        <li>{n(all.skipped, "QuickBooks item is", "QuickBooks items are")} left where {all.skipped === 1 ? "it is" : "they are"} (categories, fees, holdback and similar).</li>
        <li>New materials and labour arrive with the unit still to confirm, because QuickBooks does not hold units.</li>
        {chosen.unknownCosts > 0 && <li>{n(chosen.unknownCosts, "ticked item arrives", "ticked items arrive")} with the cost unknown, because QuickBooks has no cost there. Unknown is not zero.</li>}
        {chosen.kept > 0 && <li>{n(chosen.kept, "value differs", "values differ")} from QuickBooks where BMD already has its own. BMD's {chosen.kept === 1 ? "stays" : "stay"}.</li>}
        {chosen.duplicates.length > 0 && (
          <li>
            {n(chosen.duplicates.length, "ticked group looks", "ticked groups look")} like the same product under different names, for example: {chosen.duplicates.slice(0, 3).map((g) => g.join(" / ")).join("; ")}. Untick the extras, or merge them in the catalogue afterwards.
          </li>
        )}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-11" disabled={busy || actions.length + retypes.length === 0} onClick={onImport}>
          {actions.length + retypes.length === 0 ? "Nothing ticked to import" : `Import ${(actions.length + retypes.length).toLocaleString("en-CA")} records`}
        </Button>
        <Button variant="ghost" className="h-11" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
