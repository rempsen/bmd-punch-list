import { useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { History, Lock, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { EstChange } from "@/lib/estimating/data";
import { describeValue } from "@/lib/estimating/overrides";
import { staffName, type Staff } from "@/lib/projects/data";

/** Enter commits (by blurring), Esc puts the value back and leaves the field without saving. */
export function keyCommit(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
  else if (e.key === "Escape") {
    e.currentTarget.value = e.currentTarget.defaultValue;
    e.currentTarget.blur();
  }
}

/** The small "typed" mark with a × to clear it, beside an overridden figure. */
export function TypedBadge({ label = "typed", onClear, title }: { label?: string; onClear?: (() => void) | undefined; title?: string | undefined }) {
  return (
    <span title={title} className="inline-flex items-center gap-0.5 rounded bg-accent/60 px-1 text-[10px] font-medium text-foreground/80">
      {label}
      {onClear && (
        <button type="button" aria-label={`Clear ${label}`} onClick={onClear} className="grid h-4 w-4 place-items-center rounded hover:bg-background">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function UnlockDialog({ onClose, onUnlock }: { onClose: () => void; onUnlock: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unlock to fix an error</DialogTitle>
          <DialogDescription>The price stays accepted. Every change is recorded with your name and this reason, and you can re-lock it when the correction is done.</DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Reason</span>
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. LVT carton price was entered per SY instead of per SF" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || reason.trim() === ""}
            onClick={async () => {
              setBusy(true);
              try {
                await onUnlock(reason.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnlockedBar({ by, reason, canRelock, onRelock, quoteMismatch, projectId }: { by: string; reason: string; canRelock: boolean; onRelock: () => void; quoteMismatch: string | null; projectId: string }) {
  return (
    <div role="status" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Unlocked for corrections by {by}</span> — {reason}
        </p>
        {canRelock && (
          <Button size="sm" variant="outline" className="h-9 bg-background" onClick={onRelock}>
            <Lock className="mr-1.5 h-4 w-4" /> Re-lock
          </Button>
        )}
      </div>
      {quoteMismatch && (
        <p className="pl-6">
          {quoteMismatch}{" "}
          <Link to="/projects/$id" params={{ id: projectId }} search={{ tab: "quotes" } as never} className="font-medium underline">
            Open Quotes
          </Link>
        </p>
      )}
    </div>
  );
}

export function ChangesSheet({ changes, staff, canRevert, onRevert, onClose }: { changes: EstChange[]; staff: Staff[]; canRevert: boolean; onRevert: (c: EstChange) => void; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Changes
          </SheetTitle>
          <SheetDescription>Every figure typed on this price, newest first.</SheetDescription>
        </SheetHeader>
        {changes.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border text-sm">
            {changes.map((c) => (
              <li key={c.id} className={c.reverted_at ? "py-2.5 opacity-60" : "py-2.5"}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {c.line_label || "This price"} · {c.field_label || c.field}
                    </p>
                    {c.field !== "relock" && (
                      <p className="tabular-nums">
                        {c.field === "unlock" ? describeValue(c.to_value) : `${describeValue(c.from_value)} → ${describeValue(c.to_value)}`}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {staffName(staff, c.changed_by ?? undefined) ?? "Someone"} · {new Date(c.changed_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                      {c.reverted_at ? " · reverted" : ""}
                    </p>
                  </div>
                  {canRevert && !c.reverted_at && c.line_id && c.from_value != null && (
                    <Button size="sm" variant="ghost" className="h-9" onClick={() => onRevert(c)}>
                      <RotateCcw className="mr-1 h-4 w-4" /> Revert
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
