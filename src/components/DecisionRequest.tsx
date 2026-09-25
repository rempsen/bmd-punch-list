import { useEffect, useState } from "react";
import { MessageSquareQuote, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { useUpdateDeficiency, type DefRow } from "@/lib/data";

export type Recommendation = "accepted_as_is" | "fix_required";
export const RECOMMENDATIONS: { value: Recommendation; label: string; short: string }[] = [
  { value: "accepted_as_is", label: "Recommend accept as-is", short: "Accept as-is" },
  { value: "fix_required", label: "Recommend fix", short: "Fix" },
];
export const recLabel = (v: string | null | undefined) => RECOMMENDATIONS.find((r) => r.value === v)?.short ?? null;

/** Sends an item to the client for a decision with a recommended outcome and a reason. */
export function SendToClientButton({ item, size }: { item: DefRow; size?: "sm" }) {
  const { user, can } = useAuth();
  const update = useUpdateDeficiency();
  const [open, setOpen] = useState(false);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRec((item.decision_recommendation as Recommendation | null) ?? null);
      setReason(item.decision_reason ?? "");
      setErr(null);
    }
  }, [open, item.decision_recommendation, item.decision_reason]);

  const allowed = can("change_assessment") || can("edit_any_item");
  if (!allowed) return null;
  const resend = item.status === "awaiting_client";

  const submit = () => {
    if (!rec) return setErr("Choose a recommendation.");
    if (!reason.trim()) return setErr("Give the client a reason.");
    update.mutate(
      {
        id: item.id,
        patch: {
          ...(resend ? {} : { status: "awaiting_client" }),
          decision_recommendation: rec,
          decision_reason: reason.trim(),
          decision_requested_at: new Date().toISOString(),
          decision_requested_by: user?.id ?? null,
        },
      },
      {
        onSuccess: () => {
          toast.success(resend ? "Decision request updated" : "Sent to the client for a decision");
          setOpen(false);
        },
        onError: (e) => toast.error(`Could not send: ${e.message}`),
      },
    );
  };

  return (
    <>
      <Button size={size} variant="outline" className={size ? "" : "h-11"} onClick={() => setOpen(true)}>
        <Send className="mr-2 h-4 w-4" /> {resend ? "Edit client request" : "Send to client for decision"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask the client to decide</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">BMD recommendation</p>
              <div className="grid grid-cols-2 gap-2">
                {RECOMMENDATIONS.map((r) => (
                  <Button
                    key={r.value}
                    type="button"
                    className="h-12"
                    variant={rec === r.value ? "default" : "outline"}
                    onClick={() => {
                      setRec(r.value);
                      setErr(null);
                    }}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Reason for the client</p>
              <Textarea
                rows={4}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErr(null);
                }}
                placeholder="e.g. Minor lippage within tolerance; replacing the tile risks damaging adjacent units."
              />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={update.isPending} onClick={submit}>
              {update.isPending ? "Sending…" : resend ? "Update request" : "Send to client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Shows BMD's recommendation and reason. */
export function DecisionRequestNote({ item }: { item: DefRow }) {
  if (!item.decision_reason && !item.decision_recommendation) return null;
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <MessageSquareQuote className="h-4 w-4" />
        BMD recommends: {recLabel(item.decision_recommendation) ?? "—"}
      </p>
      {item.decision_reason && <p className="mt-1 whitespace-pre-wrap">{item.decision_reason}</p>}
      {item.decision_requested_at && (
        <p className="mt-1 text-xs text-muted-foreground">
          Sent {new Date(item.decision_requested_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
