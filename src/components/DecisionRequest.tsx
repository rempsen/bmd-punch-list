import { useEffect, useState } from "react";
import { MessageSquareQuote, RefreshCw, Send } from "lucide-react";
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
const what = (i: DefRow) =>
  [i.material, i.issue_type].filter(Boolean).join(" – ").toLowerCase() || "this item";

const FIX_TEXT = (i: DefRow) =>
  `We recommend correcting the ${what(i)}. It falls outside acceptable installation tolerances and would be noticeable in the finished space. BMD will repair or replace the affected area and confirm it with an after photo.`;

const ACCEPT_TEXTS: ((i: DefRow) => string)[] = [
  (i) => `The ${what(i)} is minor and within normal installation tolerances. Correcting it would risk damaging the surrounding finish, so we recommend accepting it as-is.`,
  (i) => `This ${what(i)} is cosmetic only and does not affect performance or durability. It is barely visible under normal lighting, so we recommend leaving it as installed.`,
  (i) => `We reviewed the ${what(i)} on site. It meets industry standards, and a repair would likely leave a more visible result than the current condition. We recommend accepting it.`,
  (i) => `The ${what(i)} is within manufacturer and TCNA tolerances. Replacing it would disturb adjacent material that is in good condition, so we recommend accepting it as-is.`,
  (i) => `This is a minor, isolated ${what(i)} that will not worsen over time. Given its low visibility, we recommend accepting it rather than disturbing the finished installation.`,
  (i) => `The ${what(i)} is typical of this material and consistent with the rest of the installation. It poses no functional or safety concern, and we recommend accepting it as-is.`,
];

const allTemplates = (i: DefRow) => [FIX_TEXT(i), ...ACCEPT_TEXTS.map((f) => f(i))];

function suggestReason(rec: Recommendation, i: DefRow, current = ""): string {
  if (rec === "fix_required") return FIX_TEXT(i);
  const opts = ACCEPT_TEXTS.map((f) => f(i)).filter((t) => t !== current);
  return opts[Math.floor(Math.random() * opts.length)];
}

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
                      if (!reason.trim() || allTemplates(item).includes(reason.trim()))
                        setReason(suggestReason(r.value, item));
                    }}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Reason for the client</p>
                {rec === "accepted_as_is" && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setReason(suggestReason(rec, item, reason.trim()))}>
                    <RefreshCw className="mr-1 h-3.5 w-3.5" /> Another wording
                  </Button>
                )}
              </div>
              <Textarea
                rows={4}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErr(null);
                }}
                placeholder="Choose a recommendation above to fill in a standard reason, then edit if needed."
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
