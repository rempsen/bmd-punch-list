/**
 * Scheduling → Assignments: one day's visits by crew, where and when each crew reports, and whether they have confirmed.
 * "Send assignments" shows exactly who will get what, then emails each crew from the signed-in person's own mailbox.
 * Nothing is sent without that press.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmationPill, VisitTags } from "@/components/scheduling/schedule-bits";
import { TechnicianPicker } from "@/components/scheduling/TechnicianPicker";
import { useVisitArrivePing, type DrawerTarget } from "@/components/scheduling/VisitDrawer";
import { db, errText } from "@/lib/platform/db";
import { confirmationCounts, confirmationOf, countsLine, crewNames, dayLong, groupByCrew, reportAt, reportPlace } from "@/lib/scheduling/assignments";
import { previewAssignments, sendAssignments, type AssignmentPreview, type SendAssignmentsResult } from "@/lib/scheduling/assignments.functions";
import { useRefreshSchedule, useVisitsBetween, useWorkCalendar, type SchedVisit } from "@/lib/scheduling/data";
import { assignmentFor, isIsoDay, type Technician } from "@/lib/scheduling/logic";
import { addWorkdays, nonWorkdayReason } from "@/lib/scheduling/workdays";

const jobName = (v: SchedVisit) => [v.project?.project_number, v.project?.name].filter(Boolean).join(" · ") || "Job";

function VisitRow({ v, open, declined }: { v: SchedVisit; open: (t: DrawerTarget) => void; declined?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => open({ visitId: v.id })}
      className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50 ${
        v.tentative ? "border-dashed border-border opacity-80" : declined ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40" : "border-border bg-card"
      }`}
    >
      <span className="min-w-0 flex-1 basis-56">
        <span className="block truncate font-medium">
          {jobName(v)} <VisitTags v={v} className="ml-1 align-middle" />
        </span>
        {v.scope && <span className="block truncate text-xs text-muted-foreground">{v.scope}</span>}
      </span>
      <span className="text-xs">
        <span className="text-muted-foreground">Report to </span>
        <span className="font-medium">{reportPlace(v)}</span>
        <span className="text-muted-foreground"> for </span>
        <span className="font-medium">{reportAt(v)}</span>
      </span>
      {v.tentative ? <span className="text-xs text-muted-foreground">Not sent while tentative</span> : <ConfirmationPill v={v} />}
    </button>
  );
}

export function Assignments({
  day,
  today,
  setDay,
  techs,
  open,
  canEdit,
}: {
  /** The site day shown (YYYY-MM-DD). */
  day: string;
  today: string;
  setDay: (d: string) => void;
  techs: Technician[];
  open: (t: DrawerTarget) => void;
  canEdit: boolean;
}) {
  const cal = useWorkCalendar();
  const visits = useVisitsBetween(day, day);
  const refresh = useRefreshSchedule();
  const ap = useVisitArrivePing();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const names = useMemo(() => crewNames(techs), [techs]);
  const groups = useMemo(() => groupByCrew(visits.data ?? [], day, names), [visits.data, day, names]);
  const all = useMemo(() => [...groups.unassigned, ...groups.crews.flatMap((c) => c.visits)], [groups]);
  const firm = all.filter((v) => !v.tentative);
  const declined = firm.filter((v) => confirmationOf(v).state === "declined");
  const off = nonWorkdayReason(day, cal);

  const assign = async (v: SchedVisit, techId: string) => {
    // A crew added in the picker a moment ago is in the refreshed list, not yet in this render's.
    const list = qc.getQueryData<Technician[]>(["technicians"]) ?? techs;
    const tech = list.find((t) => t.id === techId);
    if (!tech) return void toast.error("That crew is no longer in the list. Pick again.");
    const u = await db.from("install_visits").update({ ...assignmentFor(techId, list), crew: tech.name }).eq("id", v.id);
    if (u.error) return void toast.error(u.error.message);
    // The crew's name travels in the work order's notes; a visit not yet in ArrivePing has nothing to update.
    if (v.arriveping_job_id) await ap.reschedule(v, true);
    toast.success(`${tech.name} is on ${jobName(v)}.`);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-card">
          <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Previous workday" onClick={() => setDay(addWorkdays(day, -1, cal))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            aria-label="Day"
            className="h-11 w-auto border-0 shadow-none focus-visible:ring-0"
            value={day}
            onChange={(e) => isIsoDay(e.target.value) && setDay(e.target.value)}
          />
          <Button size="icon" variant="ghost" className="h-11 w-11" aria-label="Next workday" onClick={() => setDay(addWorkdays(day, 1, cal))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {dayLong(day)}
          {day === today ? " · today" : day === addWorkdays(today, 1, cal) ? " · next workday" : ""}
        </span>
        {canEdit && (
          <Button className="ml-auto min-h-11" disabled={!firm.length} onClick={() => setSending(true)}>
            <Send className="mr-2 h-4 w-4" />
            Send assignments
          </Button>
        )}
      </div>
      {off && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Heads-up: this is not a workday ({off}).
        </p>
      )}

      {visits.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visits.error ? (
        <p className="text-sm text-destructive">{errText(visits.error)}</p>
      ) : !all.length ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nothing is scheduled for {dayLong(day)}. {canEdit ? "Use Schedule a visit to add work, then come back to assign crews and send." : ""}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium" aria-live="polite">
            {countsLine(confirmationCounts(firm))}
          </p>

          {declined.length > 0 && (
            <section aria-label="Can't make it" className="space-y-2 rounded-md border border-amber-400 bg-amber-100 p-3 dark:bg-amber-950/50">
              <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                {declined.length === 1 ? "1 crew can't make it" : `${declined.length} visits where the crew can't make it`} — these need someone else
              </h2>
              {declined.map((v) => {
                const crew = groups.crews.find((c) => c.visits.includes(v))?.name ?? "Crew";
                return (
                  <button key={v.id} type="button" onClick={() => open({ visitId: v.id })} className="flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-md border border-amber-400 bg-background px-3 py-2 text-left text-sm">
                    <span className="font-medium">{crew}</span>
                    <span>can't make {jobName(v)}</span>
                    {v.decline_reason && <span className="text-muted-foreground">— “{v.decline_reason}”</span>}
                    <span className="ml-auto text-xs underline">Open</span>
                  </button>
                );
              })}
            </section>
          )}

          {groups.unassigned.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Needs a crew ({groups.unassigned.length})</h2>
              {groups.unassigned.map((v) => (
                <div key={v.id} className="grid gap-2 rounded-md border border-border bg-card p-2 md:grid-cols-[1fr_18rem] md:items-center">
                  <VisitRow v={v} open={open} />
                  {canEdit ? (
                    <TechnicianPicker value="" onChange={(id) => id && void assign(v, id)} techs={techs} canAdd={canEdit} />
                  ) : (
                    <span className="px-2 text-xs text-muted-foreground">No crew yet</span>
                  )}
                </div>
              ))}
            </section>
          )}

          {groups.crews.map((c) => (
            <section key={c.key} className="space-y-2">
              <h2 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold">
                {c.name}
                <span className="text-xs font-normal text-muted-foreground">
                  {c.kind === "user" ? "Staff" : c.kind === "sup" ? "Subcontractor" : "Name only — no email on file"} · {c.visits.length === 1 ? "1 visit" : `${c.visits.length} visits`}
                </span>
              </h2>
              {c.visits.map((v) => (
                <VisitRow key={v.id} v={v} open={open} declined={confirmationOf(v).state === "declined"} />
              ))}
            </section>
          ))}
        </>
      )}
      {sending && <SendDialog day={day} onClose={() => setSending(false)} onSent={refresh} />}
    </div>
  );
}

/** The preview of exactly who will get what, and the press that sends it. */
function SendDialog({ day, onClose, onSent }: { day: string; onClose: () => void; onSent: () => void }) {
  const previewFn = useServerFn(previewAssignments);
  const sendFn = useServerFn(sendAssignments);
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendAssignmentsResult | null>(null);
  useEffect(() => {
    let live = true;
    previewFn({ data: { day } })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        // Crews who already have that day's message are left unticked: tick them to send again.
        setPicked(new Set(p.send.filter((s) => !s.alreadySent).map((s) => s.key)));
      })
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await sendFn({ data: { day, crewKeys: [...picked] } });
      setResult(r);
      if (r.sent.length) toast.success(r.sent.length === 1 ? "1 assignment email sent." : `${r.sent.length} assignment emails sent.`);
      onSent();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const n = picked.size;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Send assignments for {dayLong(day)}</DialogTitle>
          <DialogDescription>One email per crew with all of their visits that day, and two links: Confirm and Can't make it.</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="rounded bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {result ? (
          <div className="space-y-3 text-sm">
            {result.sent.length > 0 && (
              <div>
                <p className="font-medium">Sent</p>
                <ul className="list-disc pl-5">
                  {result.sent.map((s) => (
                    <li key={s.key}>
                      {s.name} — {s.email}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.failed.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-2">
                <p className="font-medium text-destructive">Not sent</p>
                <ul className="list-disc pl-5">
                  {result.failed.map((s) => (
                    <li key={s.key}>
                      {s.name}: {s.error}
                    </li>
                  ))}
                </ul>
                {result.reconnect && (
                  <p className="mt-1">
                    Your Outlook mailbox needs connecting again:{" "}
                    <Link to="/settings" search={{ tab: "integrations" } as never} className="underline">
                      Company settings → Integrations
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button className="min-h-11" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : !preview ? (
          !error && <p className="text-sm text-muted-foreground">Working out who gets what…</p>
        ) : (
          <div className="space-y-3 text-sm">
            {preview.mailbox ? (
              <p>
                From your mailbox: <span className="font-medium">{preview.mailbox}</span>
                {preview.cc.length > 0 && (
                  <>
                    <br />
                    Copied on every email: <span className="font-medium">{preview.cc.join(", ")}</span>
                  </>
                )}
              </p>
            ) : (
              <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                Your Outlook mailbox is not connected, so nothing can be sent yet. Connect it under{" "}
                <Link to="/settings" search={{ tab: "integrations" } as never} className="underline">
                  Company settings → Integrations
                </Link>
                , then come back.
              </p>
            )}
            {preview.send.length === 0 && <p className="text-muted-foreground">No crew on this day has an email on file.</p>}
            {preview.send.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={picked.has(s.key)} onChange={() => toggle(s.key)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {s.name} <span className="font-normal text-muted-foreground">— {s.email}</span>
                  </span>
                  {s.alreadySent && <span className="block text-xs text-muted-foreground">Already sent. Tick to send again with fresh links.</span>}
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {s.visits.map((v) => (
                      <li key={v.id}>
                        <span className="font-medium">{v.job}</span>
                        {v.runLabel ? ` · ${v.runLabel}` : ""}
                        {v.scope ? ` · ${v.scope}` : ""} — report to {v.reportTo} for {v.reportAt}
                      </li>
                    ))}
                  </ul>
                </span>
              </label>
            ))}
            {preview.skipped.length > 0 && (
              <div className="rounded-md border border-dashed border-border p-3">
                <p className="font-medium">Not emailed</p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {preview.skipped.map((s) => (
                    <li key={s.key}>
                      <span className="font-medium">{s.name}</span> — {s.reason === "No email on file" ? "No email on file. Add one on their vendor record, or call them." : "Only tentative visits, which are never sent."}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.unassigned > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.unassigned === 1 ? "1 visit still needs a crew" : `${preview.unassigned} visits still need a crew`} and will not be in any email.
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onClose}>
                Not now
              </Button>
              <Button className="min-h-11" disabled={busy || !preview.mailbox || n === 0} onClick={() => void send()}>
                {busy ? "Sending…" : n === 1 ? "Send to 1 crew" : `Send to ${n} crews`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
