import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, errText } from "@/lib/platform/db";
import { qboConnectStart, qboDisconnect, qboPullProducts, qboStatus } from "@/lib/qbo/qbo.functions";

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
        <p className="mt-3 rounded-md bg-muted/60 p-3 text-sm">
          Held for review from the last read: {pullSummary(staged ?? {})}. These are a copy. Nothing has been added to the catalogue, and nothing in QuickBooks has changed.
        </p>
      )}
    </section>
  );
}
