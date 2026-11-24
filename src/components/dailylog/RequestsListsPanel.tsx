import { useMemo, useRef, useState } from "react";
import { Camera, ClipboardCopy, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  addRequest,
  addTool,
  copyStandardTools,
  deleteRequest,
  moveRequest,
  removeTool,
  setMaterialLoaded,
  toggleTool,
  useJobRequests,
  useJobTools,
  useMaterialList,
  useRefreshSite,
  type JobRequest,
} from "@/lib/dailylog/data";
import { REQUEST_STATUS_LABEL, isOpenRequest, nextRequestMoves, sortRequests, type RequestStatus } from "@/lib/dailylog/logic";
import { useSignedUrls } from "@/lib/photos";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

const shortDay = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
const TONE: Record<RequestStatus, string> = {
  open: "bg-amber-100 text-amber-900",
  ordered: "bg-sky-100 text-sky-900",
  on_its_way: "bg-indigo-100 text-indigo-900",
  done: "bg-emerald-100 text-emerald-900",
  cant_do: "bg-muted text-muted-foreground",
};

function Section({ title, note, children, actions }: { title: string; note?: string | undefined; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{children}</p>;
const myName = (user: { email?: string | undefined; user_metadata?: Record<string, unknown> } | null) => (typeof user?.user_metadata?.["full_name"] === "string" && user.user_metadata["full_name"] ? (user.user_metadata["full_name"] as string) : (user?.email ?? null));

/** Requests, the material list from the estimate (no prices) and the tool list, for one job. */
export function RequestsListsPanel({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-4">
      <Requests projectId={projectId} />
      <Materials projectId={projectId} />
      <Tools projectId={projectId} />
    </div>
  );
}

function Requests({ projectId }: { projectId: string }) {
  const { user, canAny } = useAuth();
  const office = canAny("manage_projects");
  const { data: rows = [], isLoading, error } = useJobRequests(projectId);
  const refresh = useRefreshSite(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [what, setWhat] = useState("");
  const [qty, setQty] = useState("");
  const [by, setBy] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [cant, setCant] = useState<{ row: JobRequest; reason: string } | null>(null);
  const [view, setView] = useState<string | null>(null);

  const sorted = useMemo(() => sortRequests(rows), [rows]);
  const open = sorted.filter((r) => isOpenRequest(r.status));
  const finished = sorted.filter((r) => !isOpenRequest(r.status));
  const { data: urls = {} } = useSignedUrls(useMemo(() => rows.flatMap((r) => (r.photo_path ? [r.photo_path] : [])), [rows]));

  const add = async () => {
    if (!what.trim()) return;
    setBusy(true);
    try {
      await addRequest({ projectId, what, quantity: qty, neededBy: by, file });
      setWhat("");
      setQty("");
      setBy("");
      setFile(null);
      toast.success("Request added");
      refresh();
    } catch (e) {
      toast.error(`Could not add the request: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const move = async (row: JobRequest, to: RequestStatus, reason?: string) => {
    try {
      await moveRequest(row, to, reason);
      setCant(null);
      refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (row: JobRequest) => {
    if (!window.confirm(`Delete the request "${row.what}"?`)) return;
    try {
      await deleteRequest(row);
      refresh();
    } catch (e) {
      toast.error(`Could not delete: ${errText(e)}`);
    }
  };

  const card = (r: JobRequest) => (
    <li key={r.id} className="rounded-md border border-border p-3">
      <div className="flex items-start gap-3">
        {r.photo_path && (
          <button type="button" className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted" aria-label="Enlarge photo" onClick={() => setView(urls[r.photo_path!] ?? null)}>
            {urls[r.photo_path] && <img src={urls[r.photo_path]} alt="Request photo" className="h-full w-full object-cover" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.what}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TONE[r.status])}>{REQUEST_STATUS_LABEL[r.status]}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {[r.quantity ? `Qty ${r.quantity}` : null, r.needed_by ? `Needed by ${shortDay(r.needed_by)}` : null, `${r.requested_by_name}, ${shortDay(r.created_at)}`].filter(Boolean).join(" · ")}
          </p>
          {r.status === "cant_do" && r.status_reason && <p className="mt-1 text-sm">Reason: {r.status_reason}</p>}
          {r.status !== "open" && r.status_by_name && r.status_at && (
            <p className="text-xs text-muted-foreground">
              {REQUEST_STATUS_LABEL[r.status]} by {r.status_by_name}, {shortDay(r.status_at)}
            </p>
          )}
        </div>
        {(office || (r.requested_by === user?.id && r.status === "open")) && (
          <Button variant="ghost" className="h-11 w-11 shrink-0 p-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.what}`} onClick={() => void remove(r)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {office && (
        <div className="mt-2 flex flex-wrap gap-2">
          {nextRequestMoves(r.status).map((to) => (
            <Button key={to} variant={to === "done" ? "default" : "outline"} className="h-11" onClick={() => (to === "cant_do" ? setCant({ row: r, reason: "" }) : void move(r, to))}>
              {to === "open" ? "Reopen" : REQUEST_STATUS_LABEL[to]}
            </Button>
          ))}
        </div>
      )}
    </li>
  );

  return (
    <Section title="Requests" note="Ask for what the job needs. The office sets the status; you'll see it change here.">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input className="h-12 flex-1 text-base" placeholder="What do you need?" value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} aria-label="What do you need?" />
          <Button className="h-12 px-5" disabled={busy || !what.trim()} onClick={() => void add()}>
            <Plus className="mr-1 h-5 w-5" /> {busy ? "Adding…" : "Add"}
          </Button>
        </div>
        {what.trim() !== "" && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-28 text-xs text-muted-foreground">
              How many (optional)
              <Input className="mt-1 h-11" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 2 pails" />
            </label>
            <label className="text-xs text-muted-foreground">
              Needed by (optional)
              <Input className="mt-1 h-11" type="date" value={by} onChange={(e) => setBy(e.target.value)} />
            </label>
            <Button type="button" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
              <Camera className="mr-1.5 h-4 w-4" /> {file ? "Photo added" : "Add a photo"}
            </Button>
            {file && (
              <Button type="button" variant="ghost" className="h-11 w-11 p-0" aria-label="Remove photo" onClick={() => setFile(null)}>
                <X className="h-4 w-4" />
              </Button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (setFile(e.target.files?.[0] ?? null), (e.target.value = ""))} />
          </div>
        )}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load requests: {errText(error)}</p>
        ) : rows.length === 0 ? (
          <Empty>No requests yet. Type what you need above and press Add.</Empty>
        ) : (
          <>
            {open.length === 0 ? <Empty>Nothing waiting. Every request has been dealt with.</Empty> : <ul className="space-y-2">{open.map(card)}</ul>}
            {finished.length > 0 && (
              <div className="mt-3">
                <Button variant="ghost" className="h-11 px-2 text-sm" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? "Hide" : "Show"} finished ({finished.length})
                </Button>
                {showDone && <ul className="mt-2 space-y-2">{finished.map(card)}</ul>}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!cant} onOpenChange={(o) => !o && setCant(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Can't do: {cant?.row.what}</DialogTitle>
          </DialogHeader>
          <label className="block text-sm font-medium">
            Why not? The person who asked will see this.
            <Input className="mt-1.5 h-11" autoFocus value={cant?.reason ?? ""} onChange={(e) => setCant((c) => (c ? { ...c, reason: e.target.value } : c))} placeholder="e.g. Discontinued, using the grey instead" />
          </label>
          <Button className="h-12" disabled={!cant?.reason.trim()} onClick={() => cant && void move(cant.row, "cant_do", cant.reason)}>
            Save
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Request photo</DialogTitle>
          </DialogHeader>
          {view && <img src={view} alt="Request photo" className="max-h-[75vh] w-full rounded-md object-contain" />}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function CheckRow({ checked, onChange, children, trailing }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1">
      <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-muted/50">
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn("min-w-0 flex-1 text-sm", checked && "text-muted-foreground line-through")}>{children}</span>
      </label>
      {trailing}
    </li>
  );
}

function Materials({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: groups = [], isLoading, error } = useMaterialList(projectId);
  const refresh = useRefreshSite(projectId);
  const all = groups.flatMap((g) => g.items);
  const tick = async (key: string, on: boolean) => {
    try {
      await setMaterialLoaded(projectId, key, on, myName(user));
      refresh();
    } catch (e) {
      toast.error(`Could not save the tick: ${errText(e)}`);
    }
  };
  return (
    <Section title="Materials for this job" note={all.length ? `From the estimate. Tick each one when it is loaded or on site · ${all.filter((i) => i.loaded).length} of ${all.length} ticked` : "From the estimate."}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Could not load the material list: {errText(error)}</p>
      ) : all.length === 0 ? (
        <Empty>No materials yet. They show here once the job's estimate has materials on it.</Empty>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.section}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.section}</h3>
              <ul className="divide-y divide-border">
                {g.items.map((i) => (
                  <CheckRow key={i.key} checked={i.loaded} onChange={(v) => void tick(i.key, v)}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0">
                        {i.description}
                        {i.where && i.where !== i.description && <span className="block text-xs text-muted-foreground no-underline">{i.where}</span>}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums">{i.quantity == null ? "Ask the office" : `${i.quantity.toLocaleString("en-CA")} ${i.unit}`}</span>
                    </span>
                  </CheckRow>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Tools({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: tools = [], isLoading, error } = useJobTools(projectId);
  const refresh = useRefreshSite(projectId);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      toast.error(errText(e) || fallback);
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    name.trim() &&
    void run(async () => {
      await addTool(projectId, name, tools);
      setName("");
    }, "Could not add it");
  const copy = () =>
    void run(async () => {
      const n = await copyStandardTools(projectId, tools);
      toast.success(n === 0 ? "Nothing to add: the standard list is already here, or it is empty." : `Added ${n} from the standard list`);
    }, "Could not copy the list");
  return (
    <Section
      title="Tool list"
      note={tools.length ? `${tools.filter((t) => t.checked).length} of ${tools.length} ticked` : undefined}
      actions={
        <Button variant="outline" className="h-11" disabled={busy} onClick={copy}>
          <ClipboardCopy className="mr-1.5 h-4 w-4" /> Copy the standard list
        </Button>
      }
    >
      <div className="flex gap-2">
        <Input className="h-12 flex-1 text-base" placeholder="Add a tool or item" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Add a tool or item" />
        <Button className="h-12 px-5" disabled={busy || !name.trim()} onClick={add}>
          <Plus className="mr-1 h-5 w-5" /> Add
        </Button>
      </div>
      <div className="mt-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load the tool list: {errText(error)}</p>
        ) : tools.length === 0 ? (
          <Empty>No tools listed. Add one above, or press Copy the standard list.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {tools.map((t) => (
              <CheckRow
                key={t.id}
                checked={t.checked}
                onChange={(v) => void run(() => toggleTool(t.id, v, myName(user)), "Could not save the tick")}
                trailing={
                  <Button variant="ghost" className="h-11 w-11 shrink-0 p-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${t.name}`} onClick={() => void run(() => removeTool(t.id), "Could not remove it")}>
                    <X className="h-4 w-4" />
                  </Button>
                }
              >
                {t.name}
              </CheckRow>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
