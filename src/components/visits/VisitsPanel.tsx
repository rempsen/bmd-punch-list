import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VisitDrawer, type DrawerTarget } from "@/components/scheduling/VisitDrawer";
import { cancelVisitPush, pushVisit } from "@/lib/arriveping/arriveping.functions";
import { db, errText } from "@/lib/platform/db";
import { useProjectVisits } from "@/lib/visits/data";
import { ArrivePingPill, OpenInArrivePing, StatusPill } from "./visit-bits";
import {
  applyVisitEvent,
  arrivepingPill,
  visitNote,
  visitRange,
  visitsCsv,
  visitTimes,
  VISIT_LABEL,
  type Visit,
  type VisitStatus,
} from "@/lib/visits/logic";
import { useArrivePingCheck } from "@/components/visits/useArrivePingCheck";

const SEE_SETTINGS = "see Company settings → Integrations.";

/** What a push came to, with ArrivePing's reason when it failed. A thrown call (no permission, network) counts as failed. */
type PushResult = { outcome: "sent" | "skipped" } | { outcome: "failed"; error: string };

/** Install visits for a project: schedule them here, send them to ArrivePing, and see what ArrivePing reports back. */
export function VisitsPanel({
  projectId,
  canEdit,
  project,
}: {
  projectId: string;
  canEdit: boolean;
  project: { name: string; number: string | null; address: string | null; client: string | null };
}) {
  const qc = useQueryClient();
  const pushFn = useServerFn(pushVisit);
  const cancelFn = useServerFn(cancelVisitPush);
  const { data: visits = [], isLoading, isError, error: loadError } = useProjectVisits(projectId);
  useArrivePingCheck(
    projectId,
    visits.some((v) => v.arriveping_job_id),
  );
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["visits", projectId] });
    void qc.invalidateQueries({ queryKey: ["visit-events", projectId] });
  };
  const must = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  // Sending to ArrivePing never throws here: the visit is already saved, so a failure is reported, not raised.
  const push = async (visitId: string): Promise<PushResult> => {
    try {
      const r = await pushFn({ data: { visitId } });
      return r.outcome === "failed"
        ? { outcome: "failed", error: r.error }
        : { outcome: r.outcome };
    } catch (e) {
      return { outcome: "failed", error: errText(e) };
    }
  };

  const send = async (v: Visit) => {
    setBusy(true);
    try {
      const sent = await push(v.id);
      if (sent.outcome === "sent") toast.success("Sent to ArrivePing.");
      else if (sent.outcome === "failed")
        toast.warning(`Couldn't send to ArrivePing — ${SEE_SETTINGS}`, { description: sent.error });
      else toast.info("Already in ArrivePing.");
    } finally {
      refresh();
      setBusy(false);
    }
  };

  const move = async (v: Visit, to: VisitStatus) => {
    const next = applyVisitEvent(v, to);
    if (!next) {
      toast.error("That visit is already past that point.");
      return;
    }
    setBusy(true);
    try {
      must(await db.from("install_visits").update({ status: next.status }).eq("id", v.id));
      must(
        await db
          .from("install_visit_events")
          .insert({ visit_id: v.id, project_id: projectId, status: next.status, note: next.note }),
      );
    } catch (e) {
      toast.error(errText(e));
      refresh();
      setBusy(false);
      return;
    }
    try {
      if (to !== "cancelled") {
        toast.success(`Marked ${VISIT_LABEL[to].toLowerCase()}.`);
        return;
      }
      // The cancel here already stands; ArrivePing is told afterwards and its answer never undoes it.
      let failure: string | null = null;
      let told = false;
      try {
        const r = await cancelFn({ data: { visitId: v.id } });
        if (r.outcome === "failed") failure = r.error;
        told = r.outcome === "sent";
      } catch (e) {
        // A visit that was never in ArrivePing has nothing to tell it, so a refused call only matters for a linked one.
        if (v.arriveping_job_id) failure = errText(e);
      }
      if (failure)
        toast.warning(`Cancelled here. ArrivePing wasn't told — ${SEE_SETTINGS}`, {
          description: failure,
        });
      else
        toast.success(
          told ? "Visit cancelled. ArrivePing asked to cancel too." : "Marked cancelled.",
        );
    } finally {
      refresh();
      setBusy(false);
    }
  };

  const unsent = visits.filter((v) => v.status === "scheduled" && !v.arriveping_job_id);
  const exportCsv = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([visitsCsv(unsent, project)], { type: "text/csv" }));
    a.setAttribute("download", `install-visits-${project.number ?? "project"}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Install visits</h2>
        {unsent.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            title="Export unsent visits as CSV"
          >
            Export for ArrivePing
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => setDrawer({ create: true, project: projectId })}
          >
            Schedule install
          </Button>
        )}
      </div>
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        // Never "No install visits" when the list could not be read (a missing migration, a lost connection).
        <p role="alert" className="mt-2 text-sm text-destructive">
          Couldn't load install visits: {errText(loadError)}
        </p>
      ) : visits.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No install visits scheduled.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visits.map((v) => {
            const ap = arrivepingPill(v);
            const range = visitRange(v.starts_at, v.ends_at);
            const forVisit = <span className="sr-only">, {range}</span>;
            const who = [v.crew, v.site_contact].filter(Boolean).join(" · ");
            return (
              <li
                key={v.id}
                className={`flex flex-wrap items-start gap-x-3 gap-y-2 py-3 text-sm ${v.status === "cancelled" ? "opacity-60" : ""}`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <button
                    type="button"
                    className="text-left font-medium underline-offset-2 hover:underline"
                    onClick={() => setDrawer({ visitId: v.id })}
                  >
                    {range}
                  </button>
                  {who && <p className="truncate text-xs text-muted-foreground">{who}</p>}
                  {v.notes && (
                    <p className="truncate text-xs text-muted-foreground" title={v.notes}>
                      {v.notes}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <StatusPill label={VISIT_LABEL[v.status]} />
                    {ap && <ArrivePingPill label={ap} />}
                    {v.arriveping_job_id && <OpenInArrivePing jobId={v.arriveping_job_id} />}
                  </div>
                </div>
                {canEdit &&
                  (v.status === "scheduled" ||
                    v.status === "en_route" ||
                    v.status === "arrived") && (
                    <div className="flex flex-wrap gap-2">
                      {v.status === "scheduled" && !v.arriveping_job_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void send(v)}
                        >
                          Send to ArrivePing
                          {forVisit}
                        </Button>
                      )}
                      {v.status !== "arrived" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void move(v, "arrived")}
                        >
                          On site
                          {forVisit}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void move(v, "completed")}
                      >
                        Completed
                        {forVisit}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          window.confirm("Cancel this visit?") && void move(v, "cancelled")
                        }
                      >
                        Cancel visit
                        {forVisit}
                      </Button>
                    </div>
                  )}
              </li>
            );
          })}
        </ul>
      )}
      <VisitDrawer
        target={drawer}
        lockProject
        onClose={() => {
          setDrawer(null);
          refresh();
        }}
      />
    </section>
  );
}
