/** Company settings → Scheduling: which days the company works, its holidays, and who is copied on assignment emails. */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errText } from "@/lib/platform/db";
import { parseEmails } from "@/lib/scheduling/assignments";
import { saveScheduleSettings, useScheduleSettings } from "@/lib/scheduling/data";
import { isIsoDay } from "@/lib/scheduling/logic";
import { WEEKDAY_NAMES, type Holiday } from "@/lib/scheduling/workdays";

// Monday first, the way the schedule reads.
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function SchedulingSettingsPanel() {
  const settings = useScheduleSettings();
  const qc = useQueryClient();
  const [workdays, setWorkdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [cc, setCc] = useState("");
  const [newDay, setNewDay] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!settings.data) return;
    setWorkdays(settings.data.calendar.workdays);
    setHolidays(settings.data.calendar.holidays);
    setCc(settings.data.assignmentCc.join("\n"));
  }, [settings.data]);

  const emails = parseEmails(cc);
  const addHoliday = () => {
    if (!isIsoDay(newDay)) return void toast.error("Choose the holiday's date.");
    if (!newName.trim()) return void toast.error("Give the holiday a name.");
    setHolidays((h) => [...h.filter((x) => x.day !== newDay), { day: newDay, name: newName.trim().slice(0, 80) }].sort((a, b) => a.day.localeCompare(b.day)));
    setNewDay("");
    setNewName("");
  };
  const save = async () => {
    if (!workdays.length) return void toast.error("Tick at least one workday.");
    if (emails.invalid.length) return void toast.error(`Not an email address: ${emails.invalid.join(", ")}`);
    setBusy(true);
    try {
      await saveScheduleSettings({ calendar: { workdays: [...workdays].sort((a, b) => a - b), holidays }, assignmentCc: emails.emails });
      await qc.invalidateQueries({ queryKey: ["schedule-settings"] });
      toast.success("Scheduling settings saved.");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (settings.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-2 rounded-md border border-border bg-card p-4">
        <h2 className="font-semibold">Workdays</h2>
        <p className="text-sm text-muted-foreground">Multi-day work is laid out on these days and skips the rest. A single visit can still be scheduled on any day.</p>
        <div className="flex flex-wrap gap-2">
          {ORDER.map((n) => (
            <label key={n} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${workdays.includes(n) ? "border-primary bg-primary/10 font-medium" : "border-border"}`}>
              <input type="checkbox" className="h-4 w-4" checked={workdays.includes(n)} onChange={(e) => setWorkdays((w) => (e.target.checked ? [...w, n] : w.filter((x) => x !== n)))} />
              {WEEKDAY_NAMES[n]}
            </label>
          ))}
        </div>
        <h3 className="pt-3 text-sm font-semibold">Holidays</h3>
        {holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holidays yet. Add the days the company is closed, such as Christmas Day.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {holidays.map((h) => (
              <li key={h.day} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="w-40 shrink-0 text-muted-foreground">{dayText(h.day)}</span>
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                <Button type="button" size="icon" variant="ghost" className="h-10 w-10" aria-label={`Remove ${h.name}`} onClick={() => setHolidays((list) => list.filter((x) => x.day !== h.day))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addHoliday();
          }}
        >
          <label className="space-y-1 text-xs font-medium">
            Date
            <Input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
          </label>
          <label className="min-w-40 flex-1 space-y-1 text-xs font-medium">
            Name
            <Input value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Christmas Day" />
          </label>
          <Button type="submit" variant="outline" className="h-10">
            Add holiday
          </Button>
        </form>
      </section>

      <section className="space-y-2 rounded-md border border-border bg-card p-4">
        <h2 className="font-semibold">Copy assignments to</h2>
        <p className="text-sm text-muted-foreground">These addresses are copied on every assignment email sent to a crew. One per line. Leave empty for none.</p>
        <Textarea rows={3} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="manager@yourcompany.com" aria-label="Copy assignments to" />
        {emails.invalid.length > 0 && <p className="text-sm text-destructive">Not an email address: {emails.invalid.join(", ")}</p>}
      </section>

      <Button className="min-h-11" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
