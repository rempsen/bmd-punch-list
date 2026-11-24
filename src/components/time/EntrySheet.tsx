import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { errText } from "@/lib/platform/db";
import { siteDay, weekDays } from "@/lib/scheduling/logic";
import { useRefreshTime, type EntryWithJob, type TimePerson } from "@/lib/time/data";
import { entryDay, hoursText, jobLabel, roundMinutes, timeText, wallTime, zonedInstant, type ClockJob } from "@/lib/time/logic";
import { timeAddMissed, timeAdjust } from "@/lib/time/time.functions";

const addDay = (day: string) => weekDays(day)[1]!;
const select = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

/** The office changes an entry (in, out or job), or adds one for someone who did not clock in. A short reason is always asked for. */
export function EntrySheet({ entry, adding, defaultDay, onClose, people, jobs, increment }: { entry: EntryWithJob | null; adding: boolean; defaultDay: string; onClose: () => void; people: TimePerson[]; jobs: ClockJob[]; increment: number }) {
  const adjust = useServerFn(timeAdjust);
  const addMissed = useServerFn(timeAddMissed);
  const refresh = useRefreshTime();
  const open = adding || !!entry;
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [day, setDay] = useState(defaultDay);
  const [inAt, setInAt] = useState("");
  const [outAt, setOutAt] = useState("");
  const [nextDay, setNextDay] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setReason("");
    if (entry) {
      setUserId(entry.user_id);
      setProjectId(entry.project_id);
      setDay(entryDay(entry));
      setInAt(wallTime(entry.clock_in_at));
      setOutAt(entry.clock_out_at ? wallTime(entry.clock_out_at) : "");
      setNextDay(!!entry.clock_out_at && siteDay(entry.clock_out_at) !== entryDay(entry));
    } else {
      setUserId("");
      setProjectId("");
      setDay(defaultDay);
      setInAt("");
      setOutAt("");
      setNextDay(false);
    }
  }, [open, entry, defaultDay]);

  const clockIn = zonedInstant(day, inAt);
  const clockOut = outAt ? zonedInstant(nextDay ? addDay(day) : day, outAt) : null;
  const paid = clockIn && clockOut && clockOut >= clockIn ? roundMinutes(clockIn.toISOString(), clockOut.toISOString(), increment) : null;
  const options = entry?.project && !jobs.some((j) => j.id === entry.project_id) ? [...jobs, { id: entry.project_id, name: entry.project.name, project_number: entry.project.project_number }] : jobs;

  const save = async () => {
    if (adding && !userId) return void toast.error("Choose the person.");
    if (!projectId) return void toast.error("Choose the job.");
    if (!clockIn) return void toast.error("Enter the date and the clock-in time.");
    if (outAt && !clockOut) return void toast.error("Enter the clock-out time.");
    if (adding && !clockOut) return void toast.error("A missed entry needs both a clock-in and a clock-out.");
    if (!reason.trim()) return void toast.error("Say briefly why this is being changed.");
    const change = { clockInAt: clockIn.toISOString(), clockOutAt: clockOut ? clockOut.toISOString() : null, projectId, reason };
    setBusy(true);
    try {
      const r = entry ? await adjust({ data: { id: entry.id, ...change } }) : await addMissed({ data: { userId, ...change } });
      if (!r.ok) return void toast.error(r.reason);
      toast.success(entry ? "Entry adjusted. The original times are kept." : "Entry added");
      await refresh();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{entry ? "Adjust entry" : "Add a missed entry"}</SheetTitle>
          <SheetDescription>
            {entry
              ? `Clocked ${timeText(entry.clock_in_at)}–${entry.clock_out_at ? timeText(entry.clock_out_at) : "still clocked in"} on ${jobLabel(entry.project)}. What it says now is kept and shown beside the change.`
              : "For someone who did not clock in. It is marked as added by the office."}
          </SheetDescription>
        </SheetHeader>
        {adding && (
          <div className="space-y-1.5">
            <Label htmlFor="es-person">Person</Label>
            <select id="es-person" className={select} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose…</option>
              {people.filter((p) => p.clocks).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="es-job">Job</Label>
          <select id="es-job" className={select} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((j) => (
              <option key={j.id} value={j.id}>
                {jobLabel(j)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="es-day">Date</Label>
          <Input id="es-day" type="date" className="h-11" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="es-in">Clock in</Label>
            <Input id="es-in" type="time" className="h-11" value={inAt} onChange={(e) => setInAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="es-out">Clock out</Label>
            <Input id="es-out" type="time" className="h-11" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
          </div>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
          Clocked out the next day (worked past midnight)
        </label>
        <p className="text-sm text-muted-foreground">
          {paid != null ? `Paid time: ${hoursText(paid)} h (rounded to ${increment} minutes)` : clockIn && clockOut ? "The clock-out is before the clock-in." : outAt || adding ? "Enter both times to see the paid time." : "No clock-out: the person stays clocked in."}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="es-reason">Reason</Label>
          <Textarea id="es-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: forgot to clock out" />
        </div>
        <Button className="h-11" disabled={busy} onClick={() => void save()}>
          {entry ? "Save adjustment" : "Add entry"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
