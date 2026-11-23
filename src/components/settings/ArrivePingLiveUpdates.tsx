import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  arrivepingLiveSync,
  checkArrivePingNow,
  connectArrivePingSync,
  disconnectArrivePingSync,
  testArrivePingSync,
} from "@/lib/arriveping/arriveping.functions";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })
    : "Never";

type CheckResult = {
  ran: boolean;
  checked: number;
  updated: number;
  failed: number;
  error?: string;
};

const checkSummary = (r: CheckResult) =>
  `Checked ${r.checked} ${r.checked === 1 ? "visit" : "visits"} · ${r.updated} updated${r.failed ? ` · ${r.failed} could not be read` : ""}`;

/**
 * Live updates from ArrivePing: BMD's subscription to ArrivePing's integration webhooks (pushed the moment something
 * changes), plus "Check now", which reads every open visit's work order from ArrivePing in case a webhook was missed.
 */
export function ArrivePingLiveUpdates({
  busy,
  setBusy,
}: {
  busy: string | null;
  setBusy: (b: string | null) => void;
}) {
  const stateFn = useServerFn(arrivepingLiveSync);
  const connectFn = useServerFn(connectArrivePingSync);
  const disconnectFn = useServerFn(disconnectArrivePingSync);
  const testFn = useServerFn(testArrivePingSync);
  const checkFn = useServerFn(checkArrivePingNow);
  const qc = useQueryClient();
  const {
    data: s,
    isLoading,
    error,
  } = useQuery({ queryKey: ["arriveping-live"], queryFn: () => stateFn() });
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () =>
    Promise.all(
      [
        ["arriveping-live"],
        ["arriveping-status"],
        ["sync-events"],
        ["visits"],
        ["visit-events"],
      ].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(errText(e));
      toast.error(errText(e));
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  const connect = () =>
    run("connect", async () => {
      const r = await connectFn();
      if (!r.ok) {
        setProblem(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(`Live updates connected · ${checkSummary(r.check)}`);
      if (r.check.error) setProblem(r.check.error);
    });
  const disconnect = () =>
    run("disconnect", async () => {
      const r = await disconnectFn();
      if (!r.ok) {
        setProblem(r.error ?? "Could not disconnect");
        toast.error(r.error ?? "Could not disconnect");
      } else toast.success("Live updates disconnected");
    });
  const sendTest = () =>
    run("ping", async () => {
      const r = await testFn();
      if (!r.ok) {
        setProblem(r.error ?? "ArrivePing did not send the test");
        toast.error(r.error ?? "ArrivePing did not send the test");
      } else
        toast.success(
          "Test sent — it shows in the sync queue below as “ping” within a few seconds",
        );
    });
  const checkNow = () =>
    run("check", async () => {
      const r = await checkFn({ data: { force: true } });
      if (r.error) {
        setProblem(r.error);
        toast.error(r.error);
      } else toast.success(checkSummary(r));
    });

  if (isLoading) return <p className="mt-4 text-sm text-muted-foreground">Loading live updates…</p>;
  if (error || !s)
    return (
      <p className="mt-4 text-sm text-destructive">Could not load live updates: {errText(error)}</p>
    );

  const failingSince =
    s.remote?.lastFailureAt &&
    (!s.remote.lastSuccessAt || s.remote.lastFailureAt > s.remote.lastSuccessAt)
      ? s.remote.lastFailureAt
      : null;
  const wrongAddress = s.connected && s.url && s.url !== s.expectedUrl;
  const shownProblem = problem ?? s.remoteError ?? s.lastCheckError;

  return (
    <section aria-labelledby="arriveping-live-heading" className="mt-4 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id="arriveping-live-heading"
          className="flex items-center gap-1.5 text-sm font-semibold"
        >
          <Zap className="h-4 w-4" aria-hidden /> Live updates from ArrivePing
        </h4>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            !s.connected
              ? "bg-slate-100 text-slate-800"
              : s.remoteError || failingSince || s.remote?.active === false
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-900",
          )}
        >
          {!s.connected
            ? "Not connected"
            : s.remote?.active === false
              ? "Paused in ArrivePing"
              : failingSince
                ? "Deliveries failing"
                : "Connected"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        When a job is assigned, moved, or its crew is on the way, on site or done in ArrivePing, the
        install visit here updates by itself. BMD also re-checks open visits against ArrivePing when
        you open a project.
      </p>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {s.connected && (
          <div className="grid gap-1 sm:contents">
            <dt className="text-muted-foreground">Sending to</dt>
            <dd className="min-w-0 break-all">
              <code className="rounded bg-muted px-1.5 py-0.5">{s.url}</code>
            </dd>
          </div>
        )}
        {s.connected && (
          <div className="grid gap-1 sm:contents">
            <dt className="text-muted-foreground">Last delivery</dt>
            <dd>
              {s.remote?.lastSuccessAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                  <time dateTime={s.remote.lastSuccessAt}>{when(s.remote.lastSuccessAt)}</time>
                </span>
              ) : (
                "None yet"
              )}
              {failingSince && (
                <span className="ml-2 text-amber-700">· failing since {when(failingSince)}</span>
              )}
            </dd>
          </div>
        )}
        <div className="grid gap-1 sm:contents">
          <dt className="text-muted-foreground">Last check</dt>
          <dd>
            {s.lastCheckAt ? <time dateTime={s.lastCheckAt}>{when(s.lastCheckAt)}</time> : "Never"}
          </dd>
        </div>
      </dl>

      {wrongAddress && (
        <p className="mt-3 flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            ArrivePing is sending to a different address than this page ({s.expectedUrl}). If this
            is BMD's published site, press Connect again.
          </span>
        </p>
      )}
      {shownProblem && (
        <p className="mt-3 flex items-start gap-2 text-sm text-destructive" role="alert">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{shownProblem}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-11" disabled={!!busy} onClick={() => void connect()}>
          {busy === "connect" ? "Connecting…" : s.connected ? "Reconnect" : "Connect"}
        </Button>
        {s.connected && (
          <Button
            className="h-11"
            variant="outline"
            disabled={!!busy}
            onClick={() => void sendTest()}
          >
            {busy === "ping" ? "Sending…" : "Send test"}
          </Button>
        )}
        <Button
          className="h-11"
          variant="outline"
          disabled={!!busy}
          onClick={() => void checkNow()}
        >
          <RefreshCw
            className={cn("mr-1.5 h-4 w-4", busy === "check" && "animate-spin")}
            aria-hidden
          />
          {busy === "check" ? "Checking…" : "Check now"}
        </Button>
        {s.connected && (
          <Button
            className="h-11"
            variant="ghost"
            disabled={!!busy}
            onClick={() => void disconnect()}
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </Button>
        )}
      </div>
    </section>
  );
}
