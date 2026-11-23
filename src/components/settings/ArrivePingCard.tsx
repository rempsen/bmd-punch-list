import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, Copy, RotateCw, Route as RouteIcon, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { SettingsBox } from "@/components/settings/SettingsBox";
import { ArrivePingLiveUpdates } from "@/components/settings/ArrivePingLiveUpdates";
import { SyncQueue } from "@/components/settings/SyncQueue";
import { Button } from "@/components/ui/button";
import {
  arrivepingStatus,
  arrivepingTest,
  retryAllFailed,
} from "@/lib/arriveping/arriveping.functions";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

type TestResult = { ok: true; tools: string[] } | { ok: false; error: string };

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })
    : "Never";

/** Settings → Integrations → ArrivePing: whether the connection works, the webhook ArrivePing calls, and the sync queue. */
export function ArrivePingCard() {
  const statusFn = useServerFn(arrivepingStatus);
  const testFn = useServerFn(arrivepingTest);
  const retryAllFn = useServerFn(retryAllFailed);
  const qc = useQueryClient();
  const {
    data: s,
    isLoading,
    error,
  } = useQuery({ queryKey: ["arriveping-status"], queryFn: () => statusFn() });
  // One action at a time across the card and the queue: "test", "retry" (all failed), or the id of the row being retried.
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const runTest = async () => {
    setBusy("test");
    try {
      const r = await testFn();
      const result: TestResult = r.ok
        ? { ok: true, tools: r.tools ?? [] }
        : { ok: false, error: r.error || "ArrivePing did not answer" };
      setTest(result);
      if (result.ok) toast.success(`Connected to ArrivePing · ${toolCount(result.tools.length)}`);
      else toast.error(result.error);
    } catch (e) {
      setTest({ ok: false, error: errText(e) });
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const retryAll = async () => {
    setBusy("retry");
    try {
      const r = await retryAllFn();
      if (!r.ok) toast.error(r.error);
      else if (r.total === 0) toast.info("Nothing to retry");
      else {
        const parts = [`${r.sent} sent`, `${r.failed} failed`];
        if (r.skipped + r.ignored > 0) parts.push(`${r.skipped + r.ignored} set aside`);
        const text = `Retried ${r.total} — ${parts.join(", ")}${r.remaining > 0 ? `; ${r.remaining} remaining` : ""}`;
        if (r.failed > 0) toast.warning(text);
        else toast.success(text);
      }
    } catch (e) {
      toast.error(errText(e));
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["arriveping-status"] }),
        qc.invalidateQueries({ queryKey: ["sync-events"] }),
      ]);
      setBusy(null);
    }
  };

  const copyWebhook = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy — select the address and copy it instead");
    }
  };

  return (
    <SettingsBox aria-labelledby="arriveping-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="arriveping-heading" className="flex items-center gap-2 font-semibold">
          <RouteIcon className="h-4 w-4" aria-hidden /> ArrivePing
        </h3>
        {s && <Pill configured={s.configured} canTest={s.canManage} test={test} />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Install visits go to ArrivePing as work orders. ArrivePing sends back crew assignments,
        reschedules and status changes.
      </p>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : error || !s ? (
        <p className="mt-3 text-sm text-destructive">
          Could not load ArrivePing status: {errText(error)}
        </p>
      ) : (
        <>
          {test && !test.ok && (
            <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{test.error}</span>
            </p>
          )}
          {test?.ok && test.tools.length > 0 && (
            <ul
              className="mt-3 flex flex-wrap gap-1.5"
              aria-label="ArrivePing tools this key can use"
            >
              {test.tools.map((t) => (
                <li
                  key={t}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}

          {s.canManage && !s.configured && (
            <p className="mt-3 flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                Add a server secret named{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">ArrivePing_Api</code> with the key
                from ArrivePing → Settings → API &amp; MCP, then publish.
              </span>
            </p>
          )}

          {s.canManage ? (
            <>
              <ArrivePingLiveUpdates busy={busy} setBusy={setBusy} />

              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
                <div className="grid gap-1 sm:contents">
                  <dt className="text-muted-foreground">API key</dt>
                  <dd>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                      ArrivePing_Api
                    </code>{" "}
                    <span className="text-muted-foreground">
                      {s.configured ? "· set" : "· not set"}
                    </span>
                  </dd>
                </div>

                <div className="grid gap-1 sm:contents">
                  <dt className="text-muted-foreground">Office alerts address</dt>
                  <dd className="flex min-w-0 flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5 text-foreground">
                      {s.webhookUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => void copyWebhook(s.webhookUrl)}
                      aria-label="Copy webhook address"
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy
                    </Button>
                  </dd>
                </div>

                <div className="grid gap-1 sm:contents">
                  <dt className="text-muted-foreground">Office alerts secret</dt>
                  <dd>
                    {s.webhookSecretSet ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Secret set
                      </span>
                    ) : (
                      <span className="inline-flex items-start gap-1.5">
                        <TriangleAlert
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                          aria-hidden
                        />
                        <span>
                          Add server secret{" "}
                          <code className="rounded bg-muted px-1.5 py-0.5">
                            ARRIVEPING_WEBHOOK_SECRET
                          </code>
                        </span>
                      </span>
                    )}
                  </dd>
                </div>

                <div className="grid gap-1 sm:contents">
                  <dt className="text-muted-foreground">Last push</dt>
                  <dd>
                    {s.lastOutAt ? (
                      <time dateTime={s.lastOutAt}>{when(s.lastOutAt)}</time>
                    ) : (
                      "Never"
                    )}
                  </dd>
                </div>

                <div className="grid gap-1 sm:contents">
                  <dt className="text-muted-foreground">Last webhook</dt>
                  <dd>
                    {s.lastInAt ? <time dateTime={s.lastInAt}>{when(s.lastInAt)}</time> : "Never"}
                  </dd>
                </div>

                <div className="grid gap-1 sm:contents">
                  <dt className="text-muted-foreground">Queue</dt>
                  <dd className="flex flex-wrap gap-2">
                    <Count
                      n={s.failedCount}
                      label="failed"
                      tone={
                        s.failedCount > 0
                          ? "bg-rose-100 text-rose-900"
                          : "bg-muted text-muted-foreground"
                      }
                    />
                    <Count
                      n={s.pendingCount}
                      label="pending"
                      tone={
                        s.pendingCount > 0
                          ? "bg-amber-100 text-amber-900"
                          : "bg-muted text-muted-foreground"
                      }
                    />
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  className="h-11"
                  variant="outline"
                  disabled={!!busy || !s.configured}
                  onClick={() => void runTest()}
                >
                  {busy === "test" ? "Testing…" : "Test connection"}
                </Button>
                <Button
                  className="h-11"
                  variant="outline"
                  disabled={!!busy || s.failedCount === 0}
                  onClick={() => void retryAll()}
                >
                  <RotateCw
                    className={cn("mr-1.5 h-4 w-4", busy === "retry" && "animate-spin")}
                    aria-hidden
                  />
                  {busy === "retry" ? "Retrying…" : "Retry all failed"}
                </Button>
              </div>

              <SyncQueue busy={busy} setBusy={setBusy} />
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Ask a BMD admin to manage the ArrivePing connection.
            </p>
          )}
        </>
      )}
    </SettingsBox>
  );
}

const toolCount = (n: number) => `${n} ${n === 1 ? "tool" : "tools"}`;

function Pill({
  configured,
  canTest,
  test,
}: {
  configured: boolean;
  canTest: boolean;
  test: TestResult | null;
}) {
  const [label, cls] = !configured
    ? ["Not configured", "bg-amber-100 text-amber-900"]
    : !test
      ? [canTest ? "Configured — not tested" : "Configured", "bg-slate-100 text-slate-800"]
      : test.ok
        ? [`Connected · ${toolCount(test.tools.length)}`, "bg-emerald-100 text-emerald-900"]
        : ["Connection failed", "bg-rose-100 text-rose-900"];
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}
    >
      {label}
    </span>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        tone,
      )}
    >
      {n} {label}
    </span>
  );
}
