import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { errText } from "@/lib/platform/db";
import { useRefreshTime } from "@/lib/time/data";
import { dayText } from "@/lib/time/logic";
import { timeQboLink, timeQboPeople, timeQboPreview, timeQboSend } from "@/lib/time/time.functions";

type Preview = Awaited<ReturnType<typeof timeQboPreview>>;
type People = Awaited<ReturnType<typeof timeQboPeople>>;
const select = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

/** Approved hours on their way to QuickBooks: a preview first, untick anything, and nothing goes until Send is pressed. */
export function SendToQuickBooks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preview = useServerFn(timeQboPreview);
  const send = useServerFn(timeQboSend);
  const refresh = useRefreshTime();
  const [view, setView] = useState<"send" | "people">("send");
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setData(null);
    setError(null);
    try {
      setData(await preview());
      setOff(new Set());
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    if (open) {
      setView("send");
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ticked = (data?.sends ?? []).filter((s) => !off.has(s.entryId));
  const go = async () => {
    setBusy(true);
    try {
      const r = await send({ data: { ids: ticked.map((s) => s.entryId) } });
      if (r.message) toast.error(r.message);
      else if (r.failed > 0) toast.error(`${r.sent} sent, ${r.failed} refused by QuickBooks. The reason is on each entry; fix it and send again.`);
      else toast.success(`${r.sent} sent to QuickBooks${r.skipped ? `, ${r.skipped} skipped (already sent or no longer approved)` : ""}`);
      await refresh();
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const needsLink = (data?.held ?? []).some((h) => h.reason.includes("not linked"));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{view === "send" ? "Send to QuickBooks" : "Link people to QuickBooks"}</SheetTitle>
          <SheetDescription>
            {view === "send" ? "Approved hours that are not in QuickBooks yet. Each becomes one time activity. Nothing is sent until you press Send." : "Each person is linked once to their QuickBooks employee record, or vendor record for a subcontractor."}
          </SheetDescription>
        </SheetHeader>
        {view === "people" ? (
          <LinkPeople onDone={() => { setView("send"); void load(); }} />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Checking what is ready…</p>
        ) : !data.ok ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{data.message}</p>
        ) : (
          <>
            {data.sends.length === 0 && data.held.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting. Approve entries on the timesheet first.</p>}
            {data.sends.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.sends.map((s) => (
                  <li key={s.entryId}>
                    <label className="flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2 text-sm">
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={!off.has(s.entryId)} onChange={(e) => setOff((prev) => { const next = new Set(prev); if (e.target.checked) next.delete(s.entryId); else next.add(s.entryId); return next; })} />
                      <span className="min-w-0">
                        <span className="font-medium">{s.personName}</span> · {dayText(s.day)} · {s.projectName}
                        <span className="block text-xs text-muted-foreground">{s.summary.join(" · ")}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {data.held.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-medium">Held back ({data.held.length})</p>
                <ul className="space-y-1 text-xs">
                  {data.held.map((h) => (
                    <li key={h.entryId}>
                      {h.label}: {h.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button className="h-11" disabled={busy || ticked.length === 0} onClick={() => void go()}>
                {busy ? "Sending…" : `Send ${ticked.length} to QuickBooks`}
              </Button>
              <Button variant={needsLink ? "default" : "outline"} className="h-11" disabled={busy} onClick={() => setView("people")}>
                Link people
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LinkPeople({ onDone }: { onDone: () => void }) {
  const read = useServerFn(timeQboPeople);
  const link = useServerFn(timeQboLink);
  const [data, setData] = useState<People | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    try {
      const d = await read();
      setData(d);
      // A suggestion is only pre-chosen in the box; it is saved when a person presses Link.
      setPick(Object.fromEntries(d.people.map((p) => [p.id, p.link ? `${p.link.type}:${p.link.id}` : p.suggestion ? `${p.suggestion.type}:${p.suggestion.id}` : ""])));
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => void load(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Reading employees from QuickBooks…</p>;
  if (!data.ok) return <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{data.message}</p>;
  const save = async (userId: string) => {
    const key = pick[userId] ?? "";
    const opt = data.options.find((o) => `${o.type}:${o.id}` === key) ?? null;
    setBusy(userId);
    try {
      const r = await link({ data: { userId, link: opt } });
      if (!r.ok) toast.error(r.message);
      else toast.success(opt ? `Linked to ${opt.name}` : "Link removed");
      await load();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      {data.people.length === 0 && <p className="text-sm text-muted-foreground">Nobody uses the time clock yet. Mark people as "Goes to site" under Company settings → Users.</p>}
      <ul className="space-y-3">
        {data.people.map((p) => {
          const current = p.link ? `${p.link.type}:${p.link.id}` : "";
          const chosen = pick[p.id] ?? "";
          return (
            <li key={p.id} className="space-y-1.5 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                {p.name} <span className="font-normal text-muted-foreground">{p.link ? `· linked to ${p.link.name}` : p.suggestion ? "· suggested match by name" : "· not linked"}</span>
              </p>
              <div className="flex gap-2">
                <select aria-label={`QuickBooks record for ${p.name}`} className={select} value={chosen} onChange={(e) => setPick((x) => ({ ...x, [p.id]: e.target.value }))}>
                  <option value="">Not linked</option>
                  <optgroup label="Employees">
                    {data.options.filter((o) => o.type === "Employee").map((o) => (
                      <option key={`e${o.id}`} value={`Employee:${o.id}`}>{o.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Vendors (subcontractors)">
                    {data.options.filter((o) => o.type === "Vendor").map((o) => (
                      <option key={`v${o.id}`} value={`Vendor:${o.id}`}>{o.name}</option>
                    ))}
                  </optgroup>
                </select>
                <Button className="h-11 shrink-0" variant={chosen !== current ? "default" : "outline"} disabled={busy != null || chosen === current} onClick={() => void save(p.id)}>
                  {chosen === "" && current !== "" ? "Unlink" : "Link"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button variant="outline" className="h-11" onClick={onDone}>
        Back to sending
      </Button>
    </div>
  );
}
