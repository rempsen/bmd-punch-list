import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CalendarDays, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appOrigin } from "@/lib/app-url";
import { useAuth } from "@/lib/auth";
import { calendarOutlookConnect, calendarOutlookStatus, calendarOutlookStop, calendarSyncNow } from "@/lib/calendar/calendar.functions";
import { calendarKey, saveCalendarChoice, setCalendarLink, useCalendar } from "@/lib/calendar/data";
import { feedUrl, type FeedScope } from "@/lib/calendar/feed";
import { SCHEDULE_TZ } from "@/lib/visits/logic";

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: SCHEDULE_TZ }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: SCHEDULE_TZ }).format(new Date(iso));
const selectCls = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
const said = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

/**
 * The account page's "Your calendar" card: a private link that Outlook, Google Calendar and Apple Calendar can subscribe
 * to, and (for Outlook) visits written straight into the person's own calendar. A person only ever manages their own.
 */
export function YourCalendarCard({ result, message }: { result?: string | undefined; message?: string | undefined }) {
  const { user, canAny, jobs } = useAuth();
  const qc = useQueryClient();
  const { data: cal, isLoading, error } = useCalendar(user?.id);
  const statusFn = useServerFn(calendarOutlookStatus);
  const connectFn = useServerFn(calendarOutlookConnect);
  const stopFn = useServerFn(calendarOutlookStop);
  const syncFn = useServerFn(calendarSyncNow);
  const { data: outlook } = useQuery({ queryKey: ["calendar-outlook-status"], queryFn: () => statusFn(), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  /** The link's address, known only straight after it is made. */
  const [link, setLink] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: calendarKey(user?.id) });
  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name);
    try {
      await work();
    } catch (e) {
      toast.error(said(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (result === "connected") toast.success("Outlook calendar connected. Press Sync my calendar now to add your visits.");
    if (result === "error") toast.error(message || "Could not connect your Outlook calendar.");
  }, [result, message]);

  const seesAll = canAny("view_pipeline");
  const scope: FeedScope = cal?.scope === "all" && seesAll ? "all" : "mine";
  const jobId = cal?.project_id ?? "";
  const choose = (next: { scope?: FeedScope; job?: string }) =>
    run("choice", async () => {
      await saveCalendarChoice(next.scope ?? scope, (next.job ?? jobId) || null);
      await refresh();
      toast.success(cal?.outlook_enabled || cal?.link_created_at ? "Saved. Your calendar picks up the change the next time it refreshes." : "Saved");
    });

  const makeLink = (replace: boolean) =>
    run("link", async () => {
      if (replace && !window.confirm("Make a new link? The old one stops working straight away, in every calendar that uses it.")) return;
      const token = await setCalendarLink(true);
      if (token) setLink(feedUrl(appOrigin(window.location.href), token));
      await refresh();
    });
  const turnOff = () =>
    run("off", async () => {
      if (!window.confirm("Turn off your calendar link? Calendars that use it will stop updating.")) return;
      await setCalendarLink(false);
      setLink(null);
      await refresh();
      toast.success("Calendar link turned off");
    });
  const copy = () =>
    run("copy", async () => {
      await navigator.clipboard.writeText(link ?? "");
      toast.success("Link copied");
    });

  const connect = () =>
    run("connect", async () => {
      const res = await connectFn();
      if (res.url) return void window.location.assign(res.url);
      await refresh();
      toast.success("Outlook calendar connected");
    });
  const sync = () =>
    run("sync", async () => {
      const res = await syncFn({ data: { force: true } });
      await refresh();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  const stop = () =>
    run("stop", async () => {
      if (!window.confirm("Stop adding visits to your Outlook calendar? Visits already there stay until you delete the BMD Projects calendar in Outlook.")) return;
      await stopFn();
      await refresh();
      toast.success("Stopped");
    });

  const linkOn = !!cal?.link_created_at;
  const sortedJobs = jobs.filter((j) => !j.archived_at || j.id === jobId).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <CalendarDays className="h-5 w-5 text-primary" /> Your calendar
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">See install visits in the calendar you already use: Outlook, Google Calendar or your phone.</p>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-destructive">Your calendar settings could not be loaded. {said(error)}</p>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {seesAll && (
              <div className="grid gap-1.5">
                <Label htmlFor="cal-scope">Show</Label>
                <select id="cal-scope" className={selectCls} value={scope} disabled={busy !== null} onChange={(e) => void choose({ scope: e.target.value as FeedScope })}>
                  <option value="mine">My visits</option>
                  <option value="all">All visits</option>
                </select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="cal-job">Job</Label>
              <select id="cal-job" className={selectCls} value={jobId} disabled={busy !== null} onChange={(e) => void choose({ job: e.target.value })}>
                <option value="">All jobs</option>
                {sortedJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!seesAll && <p className="-mt-2 text-xs text-muted-foreground">Your calendar shows the visits you are assigned to.</p>}

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Calendar link</h3>
            {!linkOn ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Turn on a private link, then add it to your calendar once. It keeps itself up to date.</p>
                <Button className="mt-3 h-11" disabled={busy !== null} onClick={() => void makeLink(false)}>
                  Turn on calendar link
                </Button>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  On since {day(cal!.link_created_at!)}. {cal!.link_last_used_at ? `Last read by a calendar on ${when(cal!.link_last_used_at)}` : "No calendar has read it yet."}
                </p>
                {link ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <Input readOnly aria-label="Your calendar link" className="h-11 min-w-0 flex-1 font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} />
                      <Button className="h-11 shrink-0" disabled={busy !== null} onClick={() => void copy()}>
                        <Copy className="mr-2 h-4 w-4" /> Copy
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Copy it now. To keep it private the link is shown only once; if you lose it, make a new one. Anyone with the link can see these visits, so do not share it.</p>
                    <ul className="space-y-1 text-sm">
                      <li>
                        <span className="font-medium">In Outlook:</span> Add calendar → Subscribe from web → paste
                      </li>
                      <li>
                        <span className="font-medium">In Google Calendar:</span> Other calendars → From URL → paste
                      </li>
                      <li>
                        <span className="font-medium">On iPhone:</span> Settings → Calendar → Accounts → Add Subscribed Calendar
                      </li>
                    </ul>
                    <p className="text-xs text-muted-foreground">Calendar apps check the link on their own schedule, so a change can take a few hours to show.</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">The link itself is shown only when it is made. Lost it, or want to add another calendar? Make a new link.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" className="h-11" disabled={busy !== null} onClick={() => void makeLink(true)}>
                    New link
                  </Button>
                  <Button variant="outline" className="h-11" disabled={busy !== null} onClick={() => void turnOff()}>
                    Turn off
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Outlook</h3>
            {outlook && !outlook.configured ? (
              <p className="mt-1 text-sm text-muted-foreground">Microsoft 365 is not set up here yet. The calendar link above works in Outlook in the meantime.</p>
            ) : cal?.outlook_enabled ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  Visits are added to a calendar named BMD Projects in your Outlook{outlook?.account_email ? ` (${outlook.account_email})` : ""}. {cal.outlook_synced_at ? `Last synced ${when(cal.outlook_synced_at)}` : "Not synced yet."}
                </p>
                {cal.outlook_error && <p className="mt-2 text-sm text-destructive">{cal.outlook_error}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {outlook && !outlook.consented ? (
                    <Button className="h-11" disabled={busy !== null} onClick={() => void connect()}>
                      Connect my Outlook calendar
                    </Button>
                  ) : (
                    <Button className="h-11" disabled={busy !== null} onClick={() => void sync()}>
                      {busy === "sync" ? "Syncing…" : "Sync my calendar now"}
                    </Button>
                  )}
                  <Button variant="outline" className="h-11" disabled={busy !== null} onClick={() => void stop()}>
                    Stop
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">It also syncs when you open Scheduling, at most every 15 minutes.</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">Or have visits put straight into your Outlook calendar. Microsoft will ask you to allow it.</p>
                <Button variant="outline" className="mt-3 h-11" disabled={busy !== null} onClick={() => void connect()}>
                  Connect my Outlook calendar
                </Button>
              </>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Visits go from BMD Projects to Outlook only. Changing an event in Outlook does not change the visit.</p>
          </div>

          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Google Calendar</span> uses the calendar link above.
          </p>
        </div>
      )}
    </section>
  );
}
