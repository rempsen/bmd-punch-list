import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectVisitLines, useWorkOrderItems } from "@/lib/visits/data";
import {
  estimateWorkItems,
  fmtQty,
  groupWorkItems,
  lineFromItem,
  num,
  onOtherWorkOrders,
  overRemaining,
  remainingFor,
  type VisitLine,
  type WorkOrderItem,
} from "@/lib/visits/lines";
import { errText } from "@/lib/platform/db";

/**
 * The work a work order covers: the items of the job's approved estimate to pick from (each with what is on other work
 * orders and what is left), and the lines picked so far with their quantities. Over-remaining is allowed and flagged.
 */
export function WorkItems({
  projectId,
  visitId,
  lines,
  onChange,
  canEdit,
}: {
  projectId: string | null;
  visitId: string | null;
  lines: VisitLine[];
  onChange: (lines: VisitLine[]) => void;
  canEdit: boolean;
}) {
  const items = useWorkOrderItems(projectId ?? "", !!projectId);
  const all = useProjectVisitLines(projectId ?? "");
  const otherLines = (all.data ?? []).filter((l) => l.visit_id !== visitId);
  const work = estimateWorkItems(items.data ?? []);
  const picked = new Set(lines.map((l) => l.estimate_line_id).filter(Boolean));
  const add = (item: WorkOrderItem) => onChange([...lines, lineFromItem(item, otherLines)]);
  const setQty = (i: number, quantity: string) => onChange(lines.map((l, j) => (j === i ? { ...l, quantity } : l)));
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));
  const itemOf = (l: VisitLine) => work.find((w) => w.estimate_line_id === l.estimate_line_id);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">
        Work <span className="font-normal text-muted-foreground">({lines.length} {lines.length === 1 ? "item" : "items"})</span>
      </p>
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((l, i) => {
            const item = itemOf(l);
            const over = item ? overRemaining(item, l.quantity, otherLines) : false;
            return (
              <li key={l.id ?? `${l.estimate_line_id}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{l.description}</span>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  aria-label={`Quantity of ${l.description}`}
                  className={`h-9 w-24 text-right ${over ? "border-amber-500" : ""}`}
                  value={String(l.quantity)}
                  disabled={!canEdit}
                  onChange={(e) => setQty(i, e.target.value)}
                />
                <span className="w-8 text-xs text-muted-foreground">{l.uom}</span>
                {item && (
                  <span className={`w-28 text-right text-xs ${over ? "text-amber-700" : "text-muted-foreground"}`} title="Left on the estimate after other work orders">
                    {over ? "over · " : ""}
                    {fmtQty(remainingFor(item, otherLines))} left
                  </span>
                )}
                {canEdit && (
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove ${l.description}`} onClick={() => remove(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && projectId && (
        <div className="rounded-md border border-border p-2">
          <p className="mb-1 text-xs text-muted-foreground">
            {items.isLoading ? "Loading the estimate…" : items.error ? errText(items.error) : work.length ? "From the approved estimate — click an item to add it." : "No approved estimate on this job yet."}
          </p>
          {groupWorkItems(work).map((g) => (
            <div key={g.label} className="mb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
              <ul>
                {g.items.map((it) => {
                  const on = onOtherWorkOrders(it, otherLines);
                  const left = remainingFor(it, otherLines);
                  return (
                    <li key={it.estimate_line_id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-muted disabled:opacity-60"
                        disabled={picked.has(it.estimate_line_id)}
                        onClick={() => add(it)}
                      >
                        <span className="flex-1 truncate">{it.description || g.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {fmtQty(it.quantity)} {it.uom}
                          {on > 0 && ` · ${fmtQty(on)} on other work orders`}
                          {num(it.quantity) > 0 && ` · ${fmtQty(left)} left`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
