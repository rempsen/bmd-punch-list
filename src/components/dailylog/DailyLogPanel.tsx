import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Check, CloudSun, Images, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { addRequest, deleteDailyLog, removeLogPhoto, saveDailyLog, setLogShared, useDailyLogs, useJobRequests, useRefreshSite, type DailyLog, type LogPhoto } from "@/lib/dailylog/data";
import { addLogWeather } from "@/lib/dailylog/dailylog.functions";
import { canChangeLog, filterLogs, isOpenRequest, requestOffers, saveTarget, weatherLine, winnipegDate } from "@/lib/dailylog/logic";
import { useSignedUrls } from "@/lib/photos";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const field = "h-11 rounded-md border border-input bg-background px-3 text-sm";

/** A job's daily logs: one big button to add today's, then the logs newest first. */
export function DailyLogPanel({ projectId }: { projectId: string }) {
  const { user, canAny } = useAuth();
  const office = canAny("manage_projects");
  const { data: logs = [], isLoading, error } = useDailyLogs(projectId);
  const { data: requests = [] } = useJobRequests(projectId);
  const refresh = useRefreshSite(projectId);
  const today = winnipegDate();
  const [form, setForm] = useState<{ log: DailyLog | null } | null>(null);
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<string | null>(null);

  const mine = user ? saveTarget(logs, user.id, today) : { mode: "create" as const };
  const myToday = mine.mode === "update" ? (logs.find((l) => l.id === mine.id) ?? null) : null;
  const people = useMemo(() => [...new Map(logs.map((l) => [l.author_id, l.author_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [logs]);
  const shown = filterLogs(logs, { authorId: person || null, from: from || null, to: to || null });
  const paths = useMemo(() => shown.flatMap((l) => l.photos.map((p) => p.storage_path)), [shown]);
  const { data: urls = {} } = useSignedUrls(paths);
  const filtered = !!(person || from || to);

  const makeRequest = async (log: DailyLog, line: string) => {
    try {
      await addRequest({ projectId, what: line, dailyLogId: log.id });
      toast.success("Request added");
      refresh();
    } catch (e) {
      toast.error(`Could not add the request: ${errText(e)}`);
    }
  };
  const remove = async (log: DailyLog) => {
    if (!window.confirm(`Delete the log for ${dayLabel(log.log_date)}? Its photos are deleted too.`)) return;
    try {
      await deleteDailyLog(log);
      toast.success("Log deleted");
      refresh();
    } catch (e) {
      toast.error(`Could not delete: ${errText(e)}`);
    }
  };
  const share = async (log: DailyLog, on: boolean) => {
    try {
      await setLogShared(log.id, on);
      refresh();
    } catch (e) {
      toast.error(`Could not change sharing: ${errText(e)}`);
    }
  };

  return (
    <div className="space-y-4">
      <Button className="h-14 w-full text-base font-semibold sm:w-auto sm:px-8" onClick={() => setForm({ log: myToday })}>
        {myToday ? <Pencil className="mr-2 h-5 w-5" /> : <Plus className="mr-2 h-5 w-5" />}
        {myToday ? "Edit today's log" : "Add today's log"}
      </Button>

      {logs.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
          <label className="min-w-[9rem] flex-1 text-xs text-muted-foreground">
            Person
            <select className={cn(field, "mt-1 block w-full text-foreground")} value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {people.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            From
            <input type="date" className={cn(field, "mt-1 block text-foreground")} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <input type="date" className={cn(field, "mt-1 block text-foreground")} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {filtered && (
            <Button variant="ghost" className="h-11" onClick={() => (setPerson(""), setFrom(""), setTo(""))}>
              Show all
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Could not load the logs: {errText(error)}</p>
      ) : logs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No logs yet. Press <span className="font-medium text-foreground">Add today's log</span>: a few photos and two short notes is all it takes.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No logs match. Press Show all.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((log) => {
            const editable = canChangeLog(log, { userId: user?.id, today, office });
            const offers = requestOffers(log.next_steps, requests.filter((r) => r.daily_log_id === log.id || isOpenRequest(r.status)));
            return (
              <li key={log.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {dayLabel(log.log_date)} <span className="font-normal text-muted-foreground">· {log.author_name}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CloudSun className="h-4 w-4 shrink-0" />
                      {weatherLine(log)}
                      {log.weather_status === "ok" && log.weather_place ? ` · ${log.weather_place}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {log.shared_with_client && !office && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Shared with the client</span>}
                    {editable && (
                      <>
                        <Button variant="outline" className="h-11" onClick={() => setForm({ log })}>
                          <Pencil className="mr-1.5 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" className="h-11 w-11 p-0 text-muted-foreground hover:text-destructive" aria-label="Delete this log" onClick={() => void remove(log)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {log.photos.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {log.photos.map((p) => (
                      <button key={p.id} type="button" disabled={!urls[p.storage_path]} onClick={() => setView(urls[p.storage_path] ?? null)} className="aspect-square overflow-hidden rounded-md bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Enlarge photo">
                        {urls[p.storage_path] && <img src={urls[p.storage_path]} alt="Site photo" loading="lazy" className="h-full w-full object-cover" />}
                      </button>
                    ))}
                  </div>
                )}

                {log.what_happened && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">What happened</p>
                    <p className="whitespace-pre-wrap text-sm">{log.what_happened}</p>
                  </div>
                )}
                {offers.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">Next steps / what's needed</p>
                    <ul className="mt-1 space-y-1.5">
                      {offers.map((o, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 flex-1">{o.line}</span>
                          {o.requested ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Check className="h-3.5 w-3.5" /> Requested
                            </span>
                          ) : (
                            <Button variant={o.suggested ? "default" : "outline"} className="h-11" onClick={() => void makeRequest(log, o.line)}>
                              Make this a request
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!log.what_happened && offers.length === 0 && log.photos.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nothing written.</p>}

                {office && (
                  <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 border-t border-border pt-3 text-sm">
                    <input type="checkbox" className="h-5 w-5 accent-primary" checked={log.shared_with_client} onChange={(e) => void share(log, e.target.checked)} />
                    Share with the client
                    <span className="text-xs text-muted-foreground">{log.shared_with_client ? "· marked as shareable" : "· internal only"}</span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form && <LogForm projectId={projectId} log={form.log} office={office} onClose={() => setForm(null)} onSaved={refresh} />}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Site photo</DialogTitle>
          </DialogHeader>
          {view && <img src={view} alt="Site photo" className="max-h-[75vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Photos first, then two short notes, then Save. After saving, lines that read like a need are offered as requests. */
function LogForm({ projectId, log, office, onClose, onSaved }: { projectId: string; log: DailyLog | null; office: boolean; onClose: () => void; onSaved: () => void }) {
  const weatherFn = useServerFn(addLogWeather);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [kept, setKept] = useState<LogPhoto[]>(log?.photos ?? []);
  const [what, setWhat] = useState(log?.what_happened ?? "");
  const [next, setNext] = useState(log?.next_steps ?? "");
  const [shared, setShared] = useState(log?.shared_with_client ?? false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const { data: requests = [] } = useJobRequests(projectId);
  const { data: keptUrls = {} } = useSignedUrls(useMemo(() => kept.map((p) => p.storage_path), [kept]));
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  const pick = (list: FileList | null) => {
    if (list?.length) setFiles((cur) => [...cur, ...Array.from(list)]);
  };
  const dropKept = async (p: LogPhoto) => {
    try {
      await removeLogPhoto(p);
      setKept((cur) => cur.filter((x) => x.id !== p.id));
      onSaved();
    } catch (e) {
      toast.error(`Could not remove the photo: ${errText(e)}`);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const out = await saveDailyLog({ projectId, existingId: log?.id ?? null, whatHappened: what, nextSteps: next, shared: office ? shared : undefined, files });
      if (out.photosFailed) toast.error(`Log saved, but ${out.photosFailed} photo${out.photosFailed === 1 ? "" : "s"} did not upload. Open the log and add ${out.photosFailed === 1 ? "it" : "them"} again.`);
      else toast.success("Log saved");
      onSaved();
      // Weather is added afterwards so it can never hold the save up.
      void weatherFn({ data: { logId: out.id } })
        .catch(() => null)
        .finally(onSaved);
      const offers = requestOffers(next, requests.filter((r) => r.daily_log_id === out.id || isOpenRequest(r.status))).filter((o) => o.suggested && !o.requested);
      if (offers.length) setSaved({ id: out.id });
      else onClose();
    } catch (e) {
      toast.error(`Could not save the log: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const ask = async (line: string) => {
    try {
      await addRequest({ projectId, what: line, dailyLogId: saved!.id });
      setAsked((cur) => [...cur, line]);
      onSaved();
    } catch (e) {
      toast.error(`Could not add the request: ${errText(e)}`);
    }
  };

  if (saved) {
    const offers = requestOffers(next, requests.filter((r) => r.daily_log_id === saved.id || isOpenRequest(r.status))).filter((o) => o.suggested);
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log saved</DialogTitle>
            <DialogDescription>These read like things you need. Make any of them a request so the office sees it.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {offers.map((o, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                <span className="min-w-0 flex-1">{o.line}</span>
                {o.requested || asked.includes(o.line) ? (
                  <span className="inline-flex h-11 items-center gap-1 text-sm text-muted-foreground">
                    <Check className="h-4 w-4" /> Requested
                  </span>
                ) : (
                  <Button className="h-11" onClick={() => void ask(o.line)}>
                    Make this a request
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button variant="outline" className="h-12 w-full" onClick={onClose}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{log ? `Log for ${dayLabel(log.log_date)}` : "Today's log"}</DialogTitle>
          <DialogDescription>Photos, what happened, and what's next. Weather is added for you.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-14 text-base" onClick={() => cameraRef.current?.click()}>
            <Camera className="mr-2 h-5 w-5" /> Take photo
          </Button>
          <Button type="button" variant="outline" className="h-14 text-base" onClick={() => libraryRef.current?.click()}>
            <Images className="mr-2 h-5 w-5" /> Choose photos
          </Button>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
          <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
        </div>
        {kept.length + files.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {kept.map((p) => (
              <Thumb key={p.id} src={keptUrls[p.storage_path]} onRemove={() => void dropKept(p)} />
            ))}
            {files.map((f, i) => (
              <Thumb key={`${f.name}-${i}`} src={previews[i]} onRemove={() => setFiles((cur) => cur.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}

        <label className="block text-sm font-medium">
          What happened today
          <Textarea className="mt-1.5 text-base" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Finished the level 2 corridor, started the lobby" />
        </label>
        <label className="block text-sm font-medium">
          Next steps / what's needed
          <Textarea className="mt-1.5 text-base" rows={3} value={next} onChange={(e) => setNext(e.target.value)} placeholder={"One per line, e.g.\nNeed 2 pails of adhesive"} />
        </label>
        {office && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with the client
          </label>
        )}
        <Button className="h-14 w-full text-base font-semibold" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ src, onRemove }: { src: string | undefined; onRemove: () => void }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
      {src && <img src={src} alt="Photo to add" className="h-full w-full object-cover" />}
      <button type="button" onClick={onRemove} aria-label="Remove photo" className="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-bl-md bg-background/85 text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
