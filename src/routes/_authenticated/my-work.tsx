import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarClock, Camera, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { itemNo, STATUS_LABEL, type Status } from "@/lib/bmd";
import {
  floorLabel,
  useAllEvents,
  useDeficiencies,
  useInvalidateDeficiencies,
  usePhotos,
  useProject,
  type DefRow,
  type EventRow,
} from "@/lib/data";
import { peopleMap, personName, tradeOf, useProjectPeople, type Person } from "@/lib/assign";
import { uploadDeficiencyPhoto, useSignedUrls } from "@/lib/photos";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/my-work")({
  head: () => ({
    meta: [
      { title: "My work — BMD Deficiency Tracker" },
      { name: "description", content: "Trade dashboard: assigned items, due dates and work log." },
      { property: "og:title", content: "My work — BMD Deficiency Tracker" },
      { property: "og:description", content: "Trade dashboard: assigned items, due dates and work log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyWorkPage,
});

const WORK = ["fix_required", "in_progress", "fixed"];
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

function dueInfo(due: string | null) {
  if (!due) return { text: "No due date", tone: "text-muted-foreground" };
  const t = today();
  if (due < t) return { text: `Overdue · ${fmtDate(due)}`, tone: "text-destructive font-semibold" };
  if (due === t) return { text: "Due today", tone: "text-primary font-semibold" };
  return { text: `Due ${fmtDate(due)}`, tone: "text-foreground" };
}

function MyWorkPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { user, projectId } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const pmap = useMemo(() => peopleMap(people), [people]);

  const work = useMemo(() => items.filter((i) => WORK.includes(i.status)), [items]);
  const { mine, others } = useMemo(() => {
    const myCompany = (user ? pmap.get(user.id)?.company : null)?.trim().toLowerCase();
    const isMine = (i: DefRow) =>
      (!!user && i.assigned_to === user.id) || (!!myCompany && tradeOf(i, pmap).toLowerCase() === myCompany);
    const byDue = (a: DefRow, b: DefRow) =>
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.item_number - b.item_number;
    return {
      mine: work.filter(isMine).sort(byDue),
      others: work.filter((i) => !isMine(i)).sort(byDue),
    };
  }, [work, pmap, user]);

  const ids = useMemo(() => work.map((i) => i.id), [work]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));
  const { data: events = [] } = useAllEvents(project?.id);

  const mineIds = useMemo(() => new Set(mine.map((i) => i.id)), [mine]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const log = useMemo(
    () => events.filter((e) => mineIds.has(e.deficiency_id)).slice(-30).reverse(),
    [events, mineIds],
  );

  const t = today();
  const stats = [
    { label: "Assigned to you", value: mine.length },
    { label: "To start", value: mine.filter((i) => i.status === "fix_required").length },
    { label: "In progress", value: mine.filter((i) => i.status === "in_progress").length },
    { label: "Overdue", value: mine.filter((i) => i.status !== "fixed" && i.due_date && i.due_date < t).length },
  ];

  const floorGroups = useMemo(() => {
    const m = new Map<number, { label: string; items: DefRow[] }>();
    for (const i of others) {
      const f = i.locations?.floors;
      const n = f?.number ?? -1;
      if (!m.has(n)) m.set(n, { label: floorLabel(f), items: [] });
      m.get(n)!.items.push(i);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }, [others]);

  const card = (d: DefRow) => {
    const before = photos.find((p) => p.deficiency_id === d.id && p.kind === "before");
    return (
      <WorkCard
        key={d.id}
        item={d}
        beforeUrl={before ? urls[before.storage_path] : undefined}
        hasAfter={photos.some((p) => p.deficiency_id === d.id && p.kind === "after")}
      />
    );
  };

  return (
    <div>
      <PageHeader title="My work" subtitle={`${mine.length} assigned to you · ${work.length} open must-fix items on this job`} />
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase">{s.label}</p>
              <p className={`text-2xl font-semibold ${s.label === "Overdue" && s.value ? "text-destructive" : ""}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Assigned to you</h2>
              {mine.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Nothing assigned to you right now.
                </p>
              ) : (
                <ul className="space-y-3">{mine.map(card)}</ul>
              )}
            </section>
            {floorGroups.map((g) => (
              <section key={g.label}>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Other open work · {g.label}</h2>
                <ul className="space-y-3">{g.items.map(card)}</ul>
              </section>
            ))}
          </div>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase">
              <ClipboardList className="h-4 w-4" /> Work log
            </h2>
            <div className="rounded-lg border border-border bg-card">
              {log.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No activity on your items yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {log.map((e) => (
                    <LogRow key={e.id} e={e} item={byId.get(e.deficiency_id)} pmap={pmap} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function describe(e: EventRow) {
  const s = (v: string | null) => (v && v in STATUS_LABEL ? STATUS_LABEL[v as Status] : v ?? "—");
  switch (e.event_type) {
    case "status_change":
      return `Status: ${s(e.from_value)} → ${s(e.to_value)}`;
    case "comment":
      return e.note ?? "Comment";
    case "photo_added":
      return `Added ${e.to_value ?? ""} photo`.replace("  ", " ");
    case "created":
      return "Item created";
    default:
      return e.to_value ? `${e.event_type.replace(/_/g, " ")}: ${e.to_value}` : e.event_type.replace(/_/g, " ");
  }
}

function LogRow({ e, item, pmap }: { e: EventRow; item?: DefRow; pmap: Map<string, Person> }) {
  return (
    <li className="p-3 text-sm">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {item ? (
          <Link to="/item/$id" params={{ id: item.id }} className="font-semibold text-foreground hover:underline">
            {itemNo(item.item_number)} · {item.locations?.name}
          </Link>
        ) : (
          <span />
        )}
        <span>{new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <p className="mt-1 first-letter:uppercase">{describe(e)}</p>
      {e.event_type === "status_change" && e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
      <p className="text-xs text-muted-foreground">{e.user_id ? personName(pmap.get(e.user_id)) : "System"}</p>
    </li>
  );
}

function WorkCard({ item, beforeUrl, hasAfter }: { item: DefRow; beforeUrl?: string | undefined; hasAfter: boolean }) {
  const [open, setOpen] = useState(false);
  const due = dueInfo(item.due_date);
  return (
    <li className="rounded-lg border border-border bg-card p-3 transition has-[.card-link:hover]:-translate-y-0.5 has-[.card-link:hover]:border-primary has-[.card-link:hover]:shadow-md has-[.card-link:focus-visible]:border-primary has-[.card-link:focus-visible]:ring-2 has-[.card-link:focus-visible]:ring-ring">
      <Link to="/item/$id" params={{ id: item.id }} className="card-link group flex cursor-pointer gap-3 rounded-md outline-none">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
          {beforeUrl ? (
            <img src={beforeUrl} alt="Before" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">No photo</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold underline-offset-2 group-hover:underline group-focus-visible:underline">
              {itemNo(item.item_number)} · {item.locations?.name}
            </span>
            <StatusBadge value={item.status} />
          </div>
          <p className="truncate text-sm">{item.material} — {item.issue_type}</p>
          <p className="truncate text-xs text-muted-foreground">{item.area}</p>
          <p className={`mt-1 flex items-center gap-1 text-xs ${due.tone}`}>
            <CalendarClock className="h-3.5 w-3.5" /> {due.text}
          </p>
        </div>
      </Link>
      <div className="mt-3">
        {item.status === "fixed" ? (
          <p className="text-center text-sm text-muted-foreground">Fixed — waiting for verification</p>
        ) : (
          <Button className="h-12 w-full" onClick={() => setOpen(true)}>
            Update progress
          </Button>
        )}
      </div>
      <ProgressDialog open={open} onOpenChange={setOpen} item={item} hasAfter={hasAfter} />
    </li>
  );
}

function ProgressDialog({
  open,
  onOpenChange,
  item,
  hasAfter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: DefRow;
  hasAfter: boolean;
}) {
  const { user, can } = useAuth();
  const invalidate = useInvalidateDeficiencies();
  const qc = useQueryClient();
  const [next, setNext] = useState<Status | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const options: { value: Status; label: string }[] = [
    ...(item.status === "fix_required" ? [{ value: "in_progress" as Status, label: "Start work" }] : []),
    { value: "fixed", label: "Mark fixed" },
  ];
  const needsPhoto = next === "fixed" && !hasAfter && files.length === 0;

  const save = async () => {
    if (!next && !note.trim() && files.length === 0) return toast.error("Choose a status, add a note or add a photo.");
    if (needsPhoto) return toast.error("Add an after photo before marking fixed.");
    setBusy(true);
    try {
      for (const f of files) await uploadDeficiencyPhoto(item.id, f, "after", user?.id);
      if (next && next !== item.status) {
        if (next === "fixed" && item.status === "fix_required") {
          const r = await supabase.from("deficiencies").update({ status: "in_progress" }).eq("id", item.id);
          if (r.error) throw new Error(r.error.message);
        }
        const r = await supabase.from("deficiencies").update({ status: next }).eq("id", item.id);
        if (r.error) throw new Error(r.error.message);
      }
      if (note.trim()) {
        const r = await supabase
          .from("deficiency_events")
          .insert({ deficiency_id: item.id, user_id: user?.id, event_type: "comment", note: note.trim() });
        if (r.error) throw new Error(r.error.message);
      }
      toast.success("Progress updated");
      setNext(null);
      setNote("");
      setFiles([]);
      onOpenChange(false);
    } catch (e) {
      toast.error(`Could not update: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      invalidate();
      void qc.invalidateQueries({ queryKey: ["all-events"] });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Update {itemNo(item.item_number)} · {item.locations?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Status</p>
            <div className="grid grid-cols-2 gap-2">
              {options.map((o) => (
                <Button
                  key={o.value}
                  type="button"
                  className="h-12"
                  variant={next === o.value ? "default" : "outline"}
                  onClick={() => setNext(next === o.value ? null : o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
          {can("add_photos") && (
            <label className="flex h-12 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-sm">
              <Camera className="mr-2 h-4 w-4" />
              {files.length ? `${files.length} after photo(s) selected` : "Add after photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </label>
          )}
          {needsPhoto && <p className="text-sm text-destructive">An after photo is needed to mark this fixed.</p>}
          <div>
            <p className="mb-2 text-sm font-medium">Work note (optional)</p>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, what's left…" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save progress"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
