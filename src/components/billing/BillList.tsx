import { Button } from "@/components/ui/button";
import type { BillForPdf } from "@/lib/billing/pdf";
import { dollars } from "@/lib/estimating/data";

export type Bill = BillForPdf & { id: string; status: "draft" | "issued" | "void"; created_at: string };
// status travels with the bill so a draft or void invoice is marked as such on the PDF.
const STATUS = { draft: "Draft", issued: "Issued", void: "Void" } as const;

/** The job's bills, newest first: invoice PDF, issue or delete a draft, void an issued bill. Shared by fixed-price and open-book jobs. */
export function BillList({ bills, canBill, busy, onPdf, onStatus }: { bills: Bill[]; canBill: boolean; busy: boolean; onPdf: (b: Bill) => void; onStatus: (b: Bill, to: "issued" | "deleted" | "void") => void }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {[...bills].reverse().map((b) => (
        <li key={b.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 ${b.status === "void" ? "opacity-60" : ""}`}>
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {b.number} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{b.kind === "holdback_release" ? "Holdback release · " : ""}{STATUS[b.status]}</span>
            </p>
            {/* An open-book bill shows the three figures to type into QuickBooks; a fixed-price bill shows what it was for. */}
            <p className="truncate text-xs text-muted-foreground">{b.lines.map((l) => (b.open_book ? `${l.description} ${dollars(l.amountCents)}` : l.description)).join(b.open_book ? " · " : ", ")}{b.period_note ? ` · ${b.period_note}` : ""}</p>
          </div>
          <p className="text-right text-sm tabular-nums">
            {dollars(b.total_cents)}
            <span className="block text-xs text-muted-foreground">{b.kind === "progress" ? `${dollars(b.gross_cents)} less ${dollars(b.holdback_cents)} held, plus GST` : "with GST"}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onPdf(b)}>
              Invoice PDF
            </Button>
            {canBill && b.status === "draft" && (
              <>
                <Button size="sm" disabled={busy} onClick={() => onStatus(b, "issued")}>
                  Issue
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(b, "deleted")}>
                  Delete
                </Button>
              </>
            )}
            {canBill && b.status === "issued" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Void ${b.number}? It stays on record and its amount can be billed again.`) && onStatus(b, "void")}>
                Void
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
