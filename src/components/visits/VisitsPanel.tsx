import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelVisitPush, pushVisit } from "@/lib/arriveping/arriveping.functions";
import { db, errText } from "@/lib/platform/db";
import { useProjectVisits } from "@/lib/visits/data";
import { ArrivePingPill, OpenInArrivePing, StatusPill } from "./visit-bits";
import { applyVisitEvent, arrivepingPill, visitNote, visitRange, visitsCsv, visitTimes, VISIT_LABEL, type Visit, type VisitStatus } from "@/lib/visits/logic";

const SEE_SETTINGS = "see Company settings → Integrations.";

type VisitForm = { date: string; endDate: string; endDateEdited: boolean; start: string; end: string; crew: string; contact: string; notes: string };
const blankForm = (): VisitForm => ({ date: "", endDate: "", endDateEdited: false, start: "08:00", end: "16:00", crew: "", contact: "", notes: "" });
/** What a push came to, with ArrivePing's reason when it failed. A thrown call (no permission, network) counts as failed. */
type PushResult = { outcome: "sent" | "skipped" } | { outcome: "failed"; error: string };

/** Install visits for a project: schedule them here, send them to ArrivePing, and see what ArrivePing reports back. */
export function VisitsPanel({ projectId, canEdit, project }: { projectId: string; canEdit: boolean; project: { name: string; number: string | null; address: string | null; client: string | null } }) {
  const qc = useQueryClient();
  const pushFn = useServerFn(pushVisit);
  const cancelFn = useServerFn(cancelVisitPush);
  const { data: visits = [], isLoading, isError, error: loadError } = useProjectVisits(projectId);
  const [form, setForm] = useState<VisitForm | null>(null);
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
      return r.outcome === "failed" ? { outcome: "failed", error: r.error } : { outcome: r.outcome };
    } catch (e) {
      return { outcome: "failed", error: errText(e) };
    }
  };

  const add = async () => {
    if (!form) return;
    const times = visitTimes(form);
    if ("error" in times) {
      toast.error(times.error);
      return;
    }
    setBusy(true);
    try {
      const crew = form.crew.trim() || null;
      const { data, error } = await db
        .from("install_visits")
        .insert({ project_id: projectId, starts_at: times.startsAt.toISOString(), ends_at: times.endsAt?.toISOString() ?? null, crew, site_contact: form.contact.trim() || null, notes: form.notes.trim() || null })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const visitId = (data as { id: string }).id;
      // The visit is saved from here on: close the form so it cannot be scheduled twice, whatever happens next.
      setForm(null);
      refresh();
      const logged = await db.from("install_visit_events").insert({ visit_id: visitId, project_id: projectId, status: "scheduled", note: `${visitNote("scheduled", crew)} for ${visitRange(times.startsAt.toISOString(), times.endsAt?.toISOString() ?? null)}` });
      if (logged.error) console.error(`install_visit_events: could not log the new visit ${visitId}: ${logged.error.message}`);
      const sent = await push(visitId);
      if (sent.outcome === "sent") toast.success("Visit scheduled and sent to ArrivePing.");
      else if (sent.outcome === "failed") toast.warning(`Visit scheduled. ArrivePing push failed — ${SEE_SETTINGS}`, { description: sent.error });
      else toast.success("Visit scheduled.");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      refresh();
      setBusy(false);
    }
  };

  const send = async (v: Visit) => {
    setBusy(true);
    try {
      const sent = await push(v.id);
      if (sent.outcome === "sent") toast.success("Sent to ArrivePing.");
      else if (sent.outcome === "failed") toast.warning(`Couldn't send to ArrivePing — ${SEE_SETTINGS}`, { description: sent.error });
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
      must(await db.from("install_visit_events").insert({ visit_id: v.id, project_id: projectId, status: next.status, note: next.note }));
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
      if (failure) toast.warning(`Cancelled here. ArrivePing wasn't told — ${SEE_SETTINGS}`, { description: failure });
      else toast.success(told ? "Visit cancelled. ArrivePing asked to cancel too." : "Marked cancelled.");
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
          <Button size="sm" variant="outline" onClick={exportCsv} title="Export unsent visits as CSV">
            Export for ArrivePing
          </Button>
        )}
        {canEdit && !form && (
          <Button size="sm" disabled={busy} onClick={() => setForm(blankForm())}>
            Schedule install
          </Button>
        )}
      </div>
      {form && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="text-xs font-medium">
            Start date
            <Input className="mt-1" type="date" required value={form.date} onChange={(e) => {
                const date = e.target.value;
                // The end date follows the start until it is edited, and never stays behind a start moved past it.
                const endDate = !form.endDateEdited || (date && form.endDate < date) ? date : form.endDate;
                setForm({ ...form, date, endDate });
              }} />
          </label>
          <label className="text-xs font-medium">
            End date
            <Input className="mt-1" type="date" min={form.date || undefined} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value, endDateEdited: true })} />
          </label>
          <label className="text-xs font-medium">
            Start time
            <Input className="mt-1" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          </label>
          <label className="text-xs font-medium">
            End time
            <Input className="mt-1" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </label>
          <label className="text-xs font-medium sm:col-span-2">
            Crew
            <Input className="mt-1" placeholder="e.g. Brodie + 2" value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} />
          </label>
          <label className="text-xs font-medium sm:col-span-2">
            Site contact
            <Input className="mt-1" placeholder="Name and phone" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </label>
          <label className="text-xs font-medium sm:col-span-4">
            Notes for the crew
            <Input className="mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" disabled={busy}>
              {busy ? "Scheduling…" : "Schedule"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        // Never "No install visits" when the list could not be read (a missing migration, a lost connection).
        <p role="alert" className="mt-2 text-sm text-destructive">
          Couldn't load install visits: {errText(loadError)}
        </p>
      ) : visits.length === 0 ? (
        !form && <p className="mt-2 text-sm text-muted-foreground">No install visits scheduled.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visits.map((v) => {
            const ap = arrivepingPill(v);
            const range = visitRange(v.starts_at, v.ends_at);
            const forVisit = <span className="sr-only">, {range}</span>;
            const who = [v.crew, v.site_contact].filter(Boolean).join(" · ");
            return (
              <li key={v.id} className={`flex flex-wrap items-start gap-x-3 gap-y-2 py-3 text-sm ${v.status === "cancelled" ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium">{range}</p>
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
                {canEdit && (v.status === "scheduled" || v.status === "en_route" || v.status === "arrived") && (
                  <div className="flex flex-wrap gap-2">
                    {v.status === "scheduled" && !v.arriveping_job_id && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void send(v)}>
                        Send to ArrivePing
                        {forVisit}
                      </Button>
                    )}
                    {v.status !== "arrived" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void move(v, "arrived")}>
                        On site
                        {forVisit}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void move(v, "completed")}>
                      Completed
                      {forVisit}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm("Cancel this visit?") && void move(v, "cancelled")}>
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
    </section>
  );
}
