import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BillList, type Bill } from "@/components/billing/BillList";
import { OpenBookBilling } from "@/components/billing/OpenBookBilling";
import { useAuth } from "@/lib/auth";
import { billTotals, billingPosition, checkNewBill, releaseTotals, type BillKind } from "@/lib/billing/calc";
import { useContractType } from "@/lib/billing/data";
import { renderBillPdf } from "@/lib/billing/pdf";
import { useTaxSettings } from "@/lib/catalogue/data";
import { dollars } from "@/lib/estimating/data";
import { db, errText } from "@/lib/platform/db";
import { useQuotes } from "@/lib/quotes/data";
import { contractValue } from "@/lib/quotes/logic";

const toCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);

/** A job is billed against its contract (fixed price) or from its hours and supplier invoices (open book). */
export function BillingTab({ projectId }: { projectId: string }) {
  const { data: contractType } = useContractType(projectId);
  if (!contractType) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return contractType === "open_book" ? <OpenBookBilling projectId={projectId} /> : <FixedPriceBilling projectId={projectId} />;
}

/** Bills against the contract: materials and progress with holdback kept back, then the holdback on its own invoice. */
function FixedPriceBilling({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const canSee = canAny("view_pricing");
  const canBill = canAny("send_quotes");
  const qc = useQueryClient();
  const { data: quotes = [] } = useQuotes(projectId, canSee);
  const { data: tax } = useTaxSettings(canSee);
  const { data: bills = [], isLoading, error } = useQuery({
    queryKey: ["bills", projectId],
    enabled: canSee,
    queryFn: async () => {
      const { data, error: e } = await db.from("progress_bills").select("id,number,kind,period_note,lines,gross_cents,holdback_pct,holdback_cents,net_cents,gst_cents,total_cents,status,issued_at,created_at").eq("project_id", projectId).order("seq");
      if (e) throw e;
      return ((data ?? []) as Bill[]).map((b) => ({ ...b, holdback_pct: Number(b.holdback_pct) }));
    },
  });
  const { data: project } = useQuery({
    queryKey: ["bill-project", projectId],
    enabled: canSee,
    queryFn: async () => {
      const { data } = await db.from("projects").select("name,project_number,address,holdback_pct,client:clients(name,billing_address)").eq("id", projectId).maybeSingle();
      return data as { name: string; project_number: string | null; address: string | null; holdback_pct: number; client: { name: string; billing_address: string | null } | null } | null;
    },
  });
  const [kind, setKind] = useState<BillKind | null>(null);
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canSee) return <p className="text-sm text-muted-foreground">You don't have access to billing on this project.</p>;
  if (isLoading || !tax || !project) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Could not load bills: {errText(error)}</p>;

  const holdbackPct = Number(project.holdback_pct);
  const pos = billingPosition(contractValue(quotes).currentCents, bills);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["bills", projectId] });
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setBusy(true);
    try {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
      toast.success(done);
      refresh();
      return true;
    } catch (e) {
      toast.error(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const start = (k: BillKind) => {
    setKind(k);
    setNote("");
    setLines(k === "holdback_release" ? [{ description: "Release of holdback", amount: (pos.holdbackOwingCents / 100).toFixed(2) }] : [{ description: bills.some((b) => b.status !== "void") ? "Progress to date" : "Materials", amount: "" }]);
  };
  const gross = lines.reduce((s, l) => s + (Number.isFinite(toCents(l.amount)) ? Math.max(0, toCents(l.amount)) : 0), 0);
  const preview = kind === "holdback_release" ? releaseTotals(gross, tax.gst_pct) : billTotals(gross, holdbackPct, tax.gst_pct);
  const problem = kind ? (lines.some((l) => !l.description.trim() || !(toCents(l.amount) > 0)) ? "Give each line a description and an amount." : checkNewBill(pos, kind, gross)) : null;
  const pdf = (b: Bill) => {
    // Billed to date as it stood when this bill was made.
    const upTo = bills.filter((x) => x.kind === "progress" && x.status !== "void" && x.created_at <= b.created_at).reduce((s, x) => s + x.gross_cents, 0);
    renderBillPdf(b, { project: { name: project.name, number: project.project_number, address: project.address }, client: { name: project.client?.name ?? "", address: project.client?.billing_address ?? null }, gstPct: tax.gst_pct, position: { contractCents: pos.contractCents, billedCents: upTo } }).save(`${b.number} - ${project.name.replace(/[\\/:*?"<>|]+/g, " ")}.pdf`);
  };

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Current contract", pos.contractCents],
          ["Billed to date", pos.billedCents],
          ["Left to bill", pos.remainingCents],
          [`Held back (${holdbackPct}%)`, pos.heldCents],
          ["Holdback released", pos.releasedCents],
          ["Holdback still held", pos.holdbackOwingCents],
        ].map(([label, cents]) => (
          <div key={label as string}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{dollars(cents as number)}</dd>
          </div>
        ))}
        <p className="col-span-full text-xs text-muted-foreground">
          Before GST. The contract is the accepted quote plus accepted change orders.
          {canBill && (
            <label className="ml-2 inline-flex items-center gap-1">
              Holdback on this job
              <input
                key={holdbackPct}
                type="number"
                min={0}
                max={50}
                step={0.5}
                defaultValue={holdbackPct}
                aria-label="Holdback percent for this job"
                className="h-8 w-16 rounded-md border border-input bg-background px-1 text-right text-sm text-foreground"
                onBlur={(e) => {
                  const pct = Number(e.target.value);
                  if (pct !== holdbackPct && pct >= 0 && pct <= 50) void run(() => db.rpc("set_project_holdback", { _project: projectId, _pct: pct }), `Holdback set to ${pct}% for new bills.`).then(() => void qc.invalidateQueries({ queryKey: ["bill-project", projectId] }));
                }}
              />
              %
            </label>
          )}
        </p>
      </dl>

      {canBill && !kind && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pos.remainingCents <= 0} title={pos.contractCents <= 0 ? "Accept a quote first" : undefined} onClick={() => start("progress")}>
            New bill
          </Button>
          <Button variant="outline" disabled={pos.holdbackOwingCents <= 0} onClick={() => start("holdback_release")}>
            Release holdback
          </Button>
        </div>
      )}

      {kind && (
        <form
          className="space-y-3 rounded-lg border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return;
            void run(() => db.rpc("create_progress_bill", { _project: projectId, _kind: kind, _lines: lines.map((l) => ({ description: l.description.trim(), amountCents: toCents(l.amount) })), _period_note: note }), "Draft bill created. Check it, then issue it.").then((ok) => ok && setKind(null));
          }}
        >
          <h3 className="font-semibold">{kind === "progress" ? "New bill" : "Holdback release"}</h3>
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="min-w-48 flex-1 text-xs font-medium">
                {i === 0 ? "What this bill is for" : <span className="sr-only">Line {i + 1}</span>}
                <Input className="mt-1" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              </label>
              <label className="w-36 text-xs font-medium">
                {i === 0 ? "Amount before GST" : <span className="sr-only">Amount for line {i + 1}</span>}
                <Input className="mt-1 text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              </label>
              {lines.length > 1 && (
                <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              )}
            </div>
          ))}
          {kind === "progress" && (
            <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { description: "", amount: "" }])}>
              Add a line
            </Button>
          )}
          <label className="block text-xs font-medium">
            Note on the invoice (optional)
            <Input className="mt-1" placeholder="e.g. Work to November 30" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <dl className="ml-auto max-w-xs text-sm">
            {kind === "progress" && (
              <>
                <div className="flex justify-between"><dt>This bill</dt><dd className="tabular-nums">{dollars(preview.grossCents)}</dd></div>
                <div className="flex justify-between"><dt>Less {holdbackPct}% holdback</dt><dd className="tabular-nums">({dollars(preview.holdbackCents)})</dd></div>
              </>
            )}
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{dollars(preview.netCents)}</dd></div>
            <div className="flex justify-between"><dt>GST {tax.gst_pct}%</dt><dd className="tabular-nums">{dollars(preview.gstCents)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>Amount due</dt><dd className="tabular-nums">{dollars(preview.totalCents)}</dd></div>
          </dl>
          {problem && gross > 0 && <p role="alert" className="text-sm text-amber-800">{problem}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !!problem}>
              Create draft
            </Button>
            <Button type="button" variant="ghost" onClick={() => setKind(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {bills.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{pos.contractCents > 0 ? "Nothing has been billed yet." : "Billing starts once a quote has been accepted."}</p>
      ) : (
        <BillList
          bills={bills}
          canBill={canBill}
          busy={busy}
          onPdf={pdf}
          onStatus={(b, to) => void run(() => db.rpc("set_progress_bill_status", { _id: b.id, _to: to }), to === "issued" ? `${b.number} issued.` : to === "void" ? `${b.number} voided.` : "Draft deleted.")}
        />
      )}
      <p className="text-xs text-muted-foreground">Bills are entered in QuickBooks by hand for now: the invoice PDF carries every figure needed.</p>
    </div>
  );
}
