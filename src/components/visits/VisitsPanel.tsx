import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, errText } from "@/lib/platform/db";
import { applyVisitEvent, visitNote, visitsCsv, type Visit, type VisitStatus } from "@/lib/visits/logic";

const LABEL: Record<VisitStatus, string> = { scheduled: "Scheduled", en_route: "On the way", arrived: "On site", completed: "Completed", cancelled: "Cancelled" };
const when = (v: Visit) => `${new Date(v.starts_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}${v.ends_at ? ` to ${new Date(v.ends_at).toLocaleTimeString("en-CA", { timeStyle: "short" })}` : ""}`;

/** Install visits for a project: schedule them here, export them for ArrivePing, and see what ArrivePing reports back. */
export function VisitsPanel({ projectId, canEdit, project }: { projectId: string; canEdit: boolean; project: { name: string; number: string | null; address: string | null; client: string | null } }) {
  const qc = useQueryClient();
  const { data: visits = [] } = useQuery({
    queryKey: ["visits", projectId],
    queryFn: async () => {
      const { data, error } = await db.from("install_visits").select("id,starts_at,ends_at,crew,notes,site_contact,arriveping_job_id,status").eq("project_id", projectId).order("starts_at");
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
  });
  const [form, setForm] = useState<{ date: string; start: string; end: string; crew: string; contact: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["visits", projectId] });
    void qc.invalidateQueries({ queryKey: ["visit-events", projectId] });
  };
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const must = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  const add = () =>
    run(async () => {
      const starts = new Date(`${form!.date}T${form!.start}`);
      const ends = form!.end ? new Date(`${form!.date}T${form!.end}`) : null;
      if (Number.isNaN(starts.getTime())) throw new Error("Choose a date and start time.");
      if (ends && ends < starts) throw new Error("The end time is before the start.");
      const { data, error } = await db.from("install_visits").insert({ project_id: projectId, starts_at: starts.toISOString(), ends_at: ends?.toISOString() ?? null, crew: form!.crew.trim() || null, site_contact: form!.contact.trim() || null, notes: form!.notes.trim() || null }).select("id").single();
      if (error) throw new Error(error.message);
      must(await db.from("install_visit_events").insert({ visit_id: (data as { id: string }).id, project_id: projectId, status: "scheduled", note: `${visitNote("scheduled", form!.crew.trim() || null)} for ${starts.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}` }));
      setForm(null);
    }, "Visit scheduled.");
  const move = (v: Visit, to: VisitStatus) =>
    run(async () => {
      const next = applyVisitEvent(v, to);
      if (!next) return;
      must(await db.from("install_visits").update({ status: next.status }).eq("id", v.id));
      must(await db.from("install_visit_events").insert({ visit_id: v.id, project_id: projectId, status: next.status, note: next.note }));
    }, `Marked ${LABEL[to].toLowerCase()}.`);
  const exportCsv = () => {
    const open = visits.filter((v) => v.status === "scheduled");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([visitsCsv(open, project)], { type: "text/csv" }));
    a.setAttribute("download", `install-visits-${project.number ?? "project"}.csv`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Install visits</h2>
        {visits.some((v) => v.status === "scheduled") && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            Export for ArrivePing
          </Button>
        )}
        {canEdit && !form && (
          <Button size="sm" onClick={() => setForm({ date: "", start: "08:00", end: "16:00", crew: "", contact: "", notes: "" })}>
            Schedule install
          </Button>
        )}
      </div>
      {form && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="text-xs font-medium">Date<Input className="mt-1" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label className="text-xs font-medium">Start<Input className="mt-1" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label className="text-xs font-medium">End<Input className="mt-1" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          <label className="text-xs font-medium">Crew<Input className="mt-1" placeholder="e.g. Brodie + 2" value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} /></label>
          <label className="text-xs font-medium sm:col-span-2">Site contact<Input className="mt-1" placeholder="Name and phone" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></label>
          <label className="text-xs font-medium sm:col-span-3">Notes for the crew<Input className="mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={busy}>Schedule</Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      )}
      {visits.length === 0 ? (
        !form && <p className="mt-2 text-sm text-muted-foreground">No install visits scheduled.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visits.map((v) => (
            <li key={v.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm ${v.status === "cancelled" ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {when(v)} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{LABEL[v.status]}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{[v.crew, v.site_contact, v.notes].filter(Boolean).join(" · ")}</p>
              </div>
              {canEdit && (v.status === "scheduled" || v.status === "en_route" || v.status === "arrived") && (
                <div className="flex flex-wrap gap-2">
                  {v.status !== "arrived" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void move(v, "arrived")}>On site</Button>}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void move(v, "completed")}>Completed</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm("Cancel this visit?") && void move(v, "cancelled")}>Cancel visit</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
