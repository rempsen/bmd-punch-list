import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { itemNo } from "@/lib/bmd";
import { useUpdateDeficiency, type DefRow } from "@/lib/data";

export type Outcome = "accepted_as_is" | "fix_required";

export function ConfirmDialog({ pending, onClose }: { pending: { item: DefRow; outcome: Outcome } | null; onClose: () => void }) {
  const update = useUpdateDeficiency();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const reject = pending?.outcome === "fix_required";

  const submit = () => {
    if (!pending) return;
    if (reject && !note.trim()) {
      setErr("Please say why it needs fixing.");
      return;
    }
    update.mutate(
      { id: pending.item.id, patch: { status: pending.outcome, client_decision_note: note.trim() || null } },
      {
        onSuccess: () => {
          toast.success(reject ? "Rejected — sent back for fixing" : "Confirmed — accepted as-is");
          setNote("");
          setErr(null);
          onClose();
        },
        onError: (e) => toast.error(`Could not record the decision: ${e.message}`),
      },
    );
  };

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reject ? "Reject" : "Confirm"} {pending ? itemNo(pending.item.item_number) : ""}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {reject
            ? "The item goes back to BMD as fix required."
            : "The item is accepted as it is and closed."}{" "}
          Your name, the time and your note are recorded.
        </p>
        <Textarea
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setErr(null);
          }}
          placeholder={reject ? "Why does it need fixing? (required)" : "Note for BMD (optional)"}
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={reject ? "destructive" : "default"} disabled={update.isPending} onClick={submit}>
            {update.isPending ? "Saving…" : reject ? "Reject item" : "Confirm item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
