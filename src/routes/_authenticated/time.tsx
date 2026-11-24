import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Check, MapPin, MapPinOff, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { shiftWeek, thisMonday, weekDays } from "@/lib/scheduling/logic";
import { readLocation, useClockJobs, useMayClock, useMyTime, useRefreshTime, useTimeSettings, type EntryWithJob } from "@/lib/time/data";
import { adjustedLine, clockJobs, dayText, entryDay, hoursText, jobLabel, runningText, summariseWeek, timeText } from "@/lib/time/logic";
import { timeClockIn, timeClockOut } from "@/lib/time/time.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/time")({
  head: () => ({ meta: [{ title: "Time clock · BMD Materials" }] }),
  component: TimePage,
});

function TimePage() {
  const { canAny, user } = useAuth();
  const office = canAny("manage_projects");
  const access = useMayClock(!office);
  if (!office && access.isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!office && !access.data)
    return (
      <>
        <PageHeader title="Time clock" />
        <p className="p-6 text-sm text-muted-foreground">The time clock is not turned on for you. Ask the office to mark you as "Goes to site".</p>
      </>
    );
  return <TimeClock userId={user?.id} />;
}

function TimeClock({ userId }: { userId: string | undefined }) {
  const mine = useMyTime(userId);
  const settings = useTimeSettings();
  const entries = mine.data ?? [];
  const open = entries.find((e) => e.clock_out_at == null) ?? null;
  return (
    <>
      <PageHeader title="Time clock" subtitle="Clock in when you start on a job and out when you leave." />
      <div className="mx-auto w-full max-w-xl space-y-6 p-4 md:p-6">
        {mine.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mine.error ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">The time clock could not be loaded: {errText(mine.error)}</p>
        ) : open ? (
          <ClockedIn entry={open} />
        ) : (
          <ClockIn />
        )}
        <p className="text-xs text-muted-foreground">
          Your location is saved once when you clock in and once when you clock out. It is not followed in between. Paid time is rounded to the nearest {settings.data?.rounding_minutes ?? 15} minutes.
        </p>
        {!mine.isLoading && !mine.error && <MyWeeks entries={entries} />}
      </div>
    </>
  );
}

function ClockIn() {
  const { currentJob } = useAuth();
  const jobs = useClockJobs();
  const clockIn = useServerFn(timeClockIn);
  const refresh = useRefreshTime();
  const [choosing, setChoosing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "location" | "saving">(null);
  const list = useMemo(() => clockJobs(jobs.data ?? []), [jobs.data]);
  const shown = q.trim() ? list.filter((j) => jobLabel(j).toLowerCase().includes(q.trim().toLowerCase())) : list;
  useEffect(() => {
    if (choosing && !jobId && currentJob && list.some((j) => j.id === currentJob.id)) setJobId(currentJob.id);
  }, [choosing, jobId, currentJob, list]);

  const go = async () => {
    if (!jobId) return void toast.error("Choose the job first.");
    setBusy("location");
    const location = await readLocation();
    setBusy("saving");
    try {
      const r = await clockIn({ data: { projectId: jobId, note, location } });
      if (!r.ok) toast.error(r.reason);
      else toast.success(location ? "Clocked in. Location saved." : "Clocked in. No location was saved.");
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!choosing)
    return (
      <Button className="h-24 w-full rounded-2xl text-2xl font-semibold" onClick={() => setChoosing(true)}>
        Clock in
      </Button>
    );
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Which job are you on?</h2>
      {list.length > 8 && (
        <div className="relative">
          <Search className="absolute top-3.5 left-3 h-4 w-4 text-muted-foreground" />
          <Input className="h-11 pl-9" placeholder="Find a job" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {jobs.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading jobs…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no jobs to clock in on yet. Ask the office to add you to the job.</p>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {shown.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onClick={() => setJobId(j.id)}
                aria-pressed={jobId === j.id}
                className={cn("flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left text-sm", jobId === j.id ? "border-primary bg-primary/10 font-semibold" : "border-border bg-background")}
              >
                <span>
                  {jobLabel(j)}
                  {j.group === "internal" && <span className="ml-2 text-xs font-normal text-muted-foreground">Internal</span>}
                  {j.group === "other" && <span className="ml-2 text-xs font-normal text-muted-foreground">Not started</span>}
                </span>
                {jobId === j.id && <Check className="h-4 w-4 shrink-0" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="text-sm text-muted-foreground">No job matches "{q}".</li>}
        </ul>
      )}
      <div className="space-y-1.5">
        <label htmlFor="clock-in-note" className="text-sm font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id="clock-in-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you are working on" />
      </div>
      <Button className="h-16 w-full rounded-xl text-xl font-semibold" disabled={!jobId || busy != null} onClick={() => void go()}>
        {busy === "location" ? "Getting your location…" : busy === "saving" ? "Clocking in…" : "Clock in now"}
      </Button>
      <Button variant="ghost" className="h-11 w-full" disabled={busy != null} onClick={() => setChoosing(false)}>
        Cancel
      </Button>
    </section>
  );
}

function ClockedIn({ entry }: { entry: EntryWithJob }) {
  const clockOut = useServerFn(timeClockOut);
  const refresh = useRefreshTime();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "location" | "saving">(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const go = async () => {
    setBusy("location");
    const location = await readLocation();
    setBusy("saving");
    try {
      const r = await clockOut({ data: { note, location } });
      if (!r.ok) toast.error(r.reason);
      else toast.success(`Clocked out. Paid time: ${hoursText(r.roundedMinutes)} h.${location ? "" : " No location was saved."}`);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-primary/40 bg-card p-4">
      <div>
        <p className="text-sm text-muted-foreground">Clocked in on</p>
        <p className="text-lg font-semibold">{jobLabel(entry.project)}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{runningText(entry.clock_in_at, now)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span>Since {timeText(entry.clock_in_at)}</span>
          <LocationMark has={entry.in_lat != null} />
        </p>
        {entry.note_in && <p className="mt-2 text-sm">{entry.note_in}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="clock-out-note" className="text-sm font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id="clock-out-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the office should know" />
      </div>
      <Button variant="destructive" className="h-24 w-full rounded-2xl text-2xl font-semibold" disabled={busy != null} onClick={() => void go()}>
        {busy === "location" ? "Getting your location…" : busy === "saving" ? "Clocking out…" : "Clock out"}
      </Button>
      <p className="text-xs text-muted-foreground">To start on another job, clock out of this one first.</p>
    </section>
  );
}

const LocationMark = ({ has }: { has: boolean }) =>
  has ? (
    <span className="inline-flex items-center gap-1">
      <MapPin className="h-3.5 w-3.5" /> Location saved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <MapPinOff className="h-3.5 w-3.5" /> No location
    </span>
  );

function MyWeeks({ entries }: { entries: EntryWithJob[] }) {
  const monday = thisMonday();
  return (
    <div className="space-y-6">
      <Week title="This week" monday={monday} entries={entries} />
      <Week title="Last week" monday={shiftWeek(monday, -1)} entries={entries} />
    </div>
  );
}

function Week({ title, monday, entries }: { title: string; monday: string; entries: EntryWithJob[] }) {
  const days = weekDays(monday);
  const mine = entries.filter((e) => days.includes(entryDay(e)));
  // Limits do not matter here: a person's own page shows hours only.
  const totals = summariseWeek(mine, monday, { dailyMinutes: Infinity, weeklyMinutes: Infinity }).people[0];
  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-border pb-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm font-semibold tabular-nums">{hoursText(totals?.weekMinutes ?? 0)} h</p>
      </div>
      {mine.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No time {title === "This week" ? "yet this week" : "last week"}.</p>
      ) : (
        <ul className="divide-y divide-border">
          {days
            .filter((d) => mine.some((e) => entryDay(e) === d))
            .map((d) => (
              <li key={d} className="py-2">
                <div className="flex items-baseline justify-between text-sm font-medium">
                  <span>{dayText(d)}</span>
                  <span className="tabular-nums">{hoursText(totals?.days[d] ?? 0)} h</span>
                </div>
                <ul className="mt-1 space-y-1">
                  {mine
                    .filter((e) => entryDay(e) === d)
                    .sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at))
                    .map((e) => (
                      <li key={e.id} className="text-sm text-muted-foreground">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate">
                            {jobLabel(e.project)} · {timeText(e.clock_in_at)}–{e.clock_out_at ? timeText(e.clock_out_at) : "now"}
                          </span>
                          <span className="shrink-0 tabular-nums">{e.clock_out_at ? `${hoursText(e.rounded_minutes)} h` : "Clocked in"}</span>
                        </div>
                        {(e.approved_at || e.original || e.source === "office") && (
                          <p className="text-xs">
                            {[e.approved_at ? "Approved" : null, adjustedLine(e, null)].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
