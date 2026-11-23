import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listSyncEvents,
  retrySyncEvent,
  type RetryOutcome,
} from "@/lib/arriveping/arriveping.functions";
import type { SyncEventRow, SyncStatus } from "@/lib/arriveping/outbox.server";
import { apWorkOrderUrl, retryable } from "@/lib/arriveping/core";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

type Filter = "all" | "failed" | "pending";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

const STATUS: Record<SyncStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-900" },
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-900" },
  acked: { label: "Applied", cls: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Failed", cls: "bg-rose-100 text-rose-900" },
  ignored: { label: "Set aside", cls: "bg-zinc-200 text-zinc-800" },
};

const ENTITY: Record<string, string> = { visit: "Install visit" };
const EVENT: Record<string, string> = { create: "Create work order", cancel: "Cancel work order" };

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const entityLabel = (t: string) => ENTITY[t] ?? capitalise(t.replace(/_/g, " "));
const eventLabel = (t: string) => EVENT[t] ?? capitalise(t.replace(/_/g, " "));
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

const SKIPPED: Record<string, string> = {
  "already linked": "Already linked to a work order — nothing was sent",
  "not linked": "The visit was never sent to ArrivePing — nothing to cancel",
  "already requested": "The cancel was already sent — nothing was sent again",
};

/** Tells the person what a retry did, in the same words the rest of the card uses. */
function retryToast(r: RetryOutcome, eventType: string) {
  if (r.outcome === "sent")
    toast.success(
      eventType === "cancel"
        ? `Cancel sent to ArrivePing for work order ${r.jobId}`
        : `Sent to ArrivePing as work order ${r.jobId}`,
    );
  else if (r.outcome === "failed") toast.error(r.error || "ArrivePing did not accept it");
  else if (r.outcome === "skipped") toast.info(SKIPPED[r.reason] ?? "Nothing was sent");
  else if (r.outcome === "ignored") toast.info(`Set aside: ${r.reason}`);
  else toast.error("That event is no longer in the log");
}

/** The ArrivePing sync log: every push to ArrivePing and every webhook from it, newest first. Failed rows can be retried. */
export function SyncQueue({
  busy,
  setBusy,
}: {
  /** The action running anywhere on the ArrivePing card, so a row retry and "Retry all failed" never overlap. */
  busy: string | null;
  setBusy: (busy: string | null) => void;
}) {
  const listFn = useServerFn(listSyncEvents);
  const retryFn = useServerFn(retrySyncEvent);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["sync-events", filter],
    queryFn: () => listFn({ data: { status: filter, limit: 50 } }),
    placeholderData: keepPreviousData,
  });

  const retry = async (row: SyncEventRow) => {
    setBusy(row.id);
    try {
      retryToast(await retryFn({ data: { id: row.id } }), row.event_type);
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

  const loadError = error ? errText(error) : data && !data.ok ? data.error : null;
  const rows = data?.ok ? data.rows : [];

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 id="sync-queue-heading" className="font-semibold">
            Sync queue
          </h4>
          <p className="text-sm text-muted-foreground">
            The last 50 pushes to ArrivePing and webhooks from it, newest first.
          </p>
        </div>
        <div className="flex rounded-md border border-border" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "h-11 px-4 text-sm first:rounded-l-md last:rounded-r-md",
                filter === f.value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn("mt-3 transition-opacity", isFetching && !isLoading && "opacity-60")}
        aria-live="polite"
        aria-busy={isFetching}
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">Could not load the sync queue: {loadError}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {filter === "all"
              ? "Nothing to show — every push and webhook will be listed here."
              : filter === "failed"
                ? "Nothing has failed."
                : "Nothing is waiting to be sent."}
          </p>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table" aria-labelledby="sync-queue-heading">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Time
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Direction
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Entity
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Event
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Attempts
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Error
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    <span className="sr-only">Retry</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <Time iso={r.created_at} />
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-3">
                      <Direction row={r} />
                    </td>
                    <td className="py-2.5 pr-3">
                      {entityLabel(r.entity_type)}
                      <WorkOrderLink row={r} />
                    </td>
                    <td className="py-2.5 pr-3">{eventLabel(r.event_type)}</td>
                    <td className="py-2.5 pr-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{r.attempts}</td>
                    <td className="max-w-[22rem] py-2.5 pr-3">
                      {r.last_error ? (
                        <span
                          className="line-clamp-2 break-words text-muted-foreground"
                          title={r.last_error}
                        >
                          {r.last_error}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          <span aria-hidden>—</span>
                          <span className="sr-only">No error</span>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {retryable(r) && (
                        <RetryButton row={r} busy={busy} onRetry={retry} className="h-9" />
                      )}
                      {r.status === "failed" && r.direction === "in" && <Redelivered />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="space-y-2 md:hidden" aria-labelledby="sync-queue-heading">
              {rows.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{eventLabel(r.event_type)}</p>
                      <p className="text-muted-foreground">
                        {entityLabel(r.entity_type)} · <Time iso={r.created_at} />
                      </p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                    <Direction row={r} />
                    <span>
                      {r.attempts} {r.attempts === 1 ? "attempt" : "attempts"}
                    </span>
                    <WorkOrderLink row={r} />
                  </p>
                  {r.last_error && (
                    <p className="mt-2 break-words text-muted-foreground">{r.last_error}</p>
                  )}
                  {retryable(r) && (
                    <RetryButton row={r} busy={busy} onRetry={retry} className="mt-3 h-11 w-full" />
                  )}
                  {r.status === "failed" && r.direction === "in" && (
                    <Redelivered className="mt-3" />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Time({ iso }: { iso: string }) {
  return <time dateTime={iso}>{when(iso)}</time>;
}

function Direction({ row }: { row: SyncEventRow }) {
  return row.direction === "out" ? (
    <span className="inline-flex items-center gap-1">
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> To ArrivePing
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <ArrowDownLeft className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> From ArrivePing
    </span>
  );
}

function StatusPill({ status }: { status: SyncStatus }) {
  const s = STATUS[status] ?? { label: capitalise(status), cls: "bg-zinc-200 text-zinc-800" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}

function WorkOrderLink({ row }: { row: SyncEventRow }) {
  if (row.direction !== "out" || !row.external_id) return null;
  return (
    <a
      href={apWorkOrderUrl(row.external_id)}
      target="_blank"
      rel="noreferrer"
      className="mt-0.5 flex w-fit items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
      aria-label={`Open work order ${row.external_id} in ArrivePing (opens in a new tab)`}
    >
      Open in ArrivePing <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

/** A failed webhook is not retried from BMD: ArrivePing sends it again, and a retry here would make that look like a duplicate. */
function Redelivered({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>Redelivered by ArrivePing</p>
  );
}

/** Retry for a failed push to ArrivePing. Incoming events get none; see `Redelivered`. */
function RetryButton({
  row,
  busy,
  onRetry,
  className,
}: {
  row: SyncEventRow;
  busy: string | null;
  onRetry: (row: SyncEventRow) => void;
  className?: string;
}) {
  if (row.direction === "in") return null;
  const mine = busy === row.id;
  return (
    <Button
      variant="outline"
      className={className}
      disabled={busy !== null}
      onClick={() => onRetry(row)}
      aria-label={`Retry ${eventLabel(row.event_type).toLowerCase()} from ${when(row.created_at)}`}
    >
      <RotateCw className={cn("mr-1.5 h-4 w-4", mine && "animate-spin")} aria-hidden />
      {mine ? "Retrying…" : "Retry"}
    </Button>
  );
}
