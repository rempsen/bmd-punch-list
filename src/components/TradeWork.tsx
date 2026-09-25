import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, Camera } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { itemNo, type Status } from "@/lib/bmd";
import { useInvalidateDeficiencies, type DefRow } from "@/lib/data";
import { uploadDeficiencyPhoto } from "@/lib/photos";

export const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function dueInfo(due: string | null) {
  if (!due) return { text: "No due date", tone: "text-muted-foreground" };
  const t = today();
  if (due < t) return { text: `Overdue · ${fmtDate(due)}`, tone: "text-destructive font-semibold" };
  if (due === t) return { text: "Due today", tone: "text-primary font-semibold" };
  return { text: `Due ${fmtDate(due)}`, tone: "text-foreground" };
}


export function WorkCard({ item, beforeUrl, hasAfter }: { item: DefRow; beforeUrl?: string | undefined; hasAfter: boolean }) {
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
    if (!next && !note.trim() && files.length === 0) {
      toast.error("Choose a status, add a note or add a photo.");
      return;
    }
    if (needsPhoto) {
      toast.error("Add an after photo before marking fixed.");
      return;
    }
    setBusy(true);
    try {
      for (const f of files) await uploadDeficiencyPhoto(item.id, f, "after", user?.id);
      if (next && next !== item.status) {
        const r = await supabase.from("deficiencies").update({ status: next }).eq("id", item.id);
        if (r.error) throw new Error(r.error.message);
      }
      if (note.trim()) {
        const r = await supabase
          .from("deficiency_events")
          .insert({ deficiency_id: item.id, user_id: user?.id ?? null, event_type: "comment", note: note.trim() });
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
