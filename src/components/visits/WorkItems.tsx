import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useLabourRates } from "@/lib/catalogue/data";
import { dollars } from "@/lib/estimating/data";
import { useProjectVisitLines, useWorkOrderItems, useWorkOrderValues } from "@/lib/visits/data";
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
import { installerPay, lineValueCents, SOURCE_LABEL, uncostedText, valuationFor, type LineValuation } from "@/lib/visits/valuation";
import { errText } from "@/lib/platform/db";

/** A rate typed in dollars ("1.15") as whole cents; null when blank or not a number. */
const centsOf = (text: string): number | null => {
  const t = text.trim().replace(/^\$/, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** A rate in dollars, typed freely; shows the line's current rate until the person edits it. */
function RateInput({ label, cents, onChange }: { label: string; cents: number | null; onChange: (text: string) => void }) {
  const shown = cents == null ? "" : (cents / 100).toFixed(2);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      inputMode="decimal"
      aria-label={label}
      className="h-7 w-20 text-right text-xs"
      placeholder="—"
      value={text}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/**
 * The work a work order covers: the items of the job's approved estimate to pick from (each with what is on other work
 * orders and what is left), and the lines picked so far with their quantities. Over-remaining is allowed and flagged.
 * With view_pricing, each line also shows the rate it is valued at and what it comes to, and the installer pay in total.
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
  const { canAny } = useAuth();
  const canPrice = canAny("view_pricing");
  const items = useWorkOrderItems(projectId ?? "", !!projectId);
  const all = useProjectVisitLines(projectId ?? "");
  const values = useWorkOrderValues(projectId ?? "", canPrice);
  const rates = useLabourRates(canPrice);
  const otherLines = (all.data ?? []).filter((l) => l.visit_id !== visitId);
  const work = estimateWorkItems(items.data ?? []);
  const picked = new Set(lines.map((l) => l.estimate_line_id).filter(Boolean));
  const add = (item: WorkOrderItem) => onChange([...lines, lineFromItem(item, otherLines)]);
  const setQty = (i: number, quantity: string) => onChange(lines.map((l, j) => (j === i ? { ...l, quantity } : l)));
  const setRate = (i: number, text: string) => {
    const cents = centsOf(text);
    onChange(lines.map((l, j) => (j === i ? { ...l, unit_labour_cost_cents: cents, labour_rate_source: cents === null ? null : "manual", clear_manual: cents === null ? !!l.clear_manual : false } : l)));
  };
  // "Use estimate rate": drop the entered rate; the line is valued again from the estimate (then the catalogue) when saved.
  const revertToEstimateRate = (i: number) => onChange(lines.map((l, j) => (j === i ? { ...l, unit_labour_cost_cents: null, labour_rate_source: null, clear_manual: true } : l)));
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));
  const itemOf = (l: VisitLine) => work.find((w) => w.estimate_line_id === l.estimate_line_id);

  // The rate each line is valued at: as saved (a snapshot the estimate no longer changes), as typed, or as the estimate
  // or catalogue would value a new line now. Only with view_pricing; the server values the lines when they are saved.
  const valuationOf = (l: VisitLine): LineValuation | null => {
    if (!canPrice) return null;
    if (l.labour_rate_source === "manual" && l.unit_labour_cost_cents != null) return { unit_labour_cost_cents: l.unit_labour_cost_cents, labour_rate_source: "manual", labour_rate_id: null };
    const saved = l.id && !l.clear_manual ? values.data?.lines.get(l.id) : undefined;
    if (saved && saved.unit_labour_cost_cents !== null) return { unit_labour_cost_cents: saved.unit_labour_cost_cents, labour_rate_source: saved.labour_rate_source, labour_rate_id: saved.labour_rate_id };
    return valuationFor(l, items.data ?? [], rates.data ?? []);
  };
  const valued = lines.map((l) => ({ ...l, unit_labour_cost_cents: valuationOf(l)?.unit_labour_cost_cents ?? null }));
  const pay = installerPay(valued);
  const uncosted = uncostedText(pay.uncosted);

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
            const v = valuationOf(l);
            const value = v ? lineValueCents({ quantity: l.quantity, unit_labour_cost_cents: v.unit_labour_cost_cents }) : null;
            return (
              <li key={l.id ?? `${l.estimate_line_id}-${i}`} className="space-y-0.5 text-sm">
                <div className="flex items-center gap-2">
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
                </div>
                {canPrice && (
                  <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    {canEdit ? (
                      <label className="flex items-center gap-1">
                        <span>Rate $</span>
                        <RateInput label={`Rate per ${l.uom} for ${l.description}`} cents={v?.unit_labour_cost_cents ?? null} onChange={(text) => setRate(i, text)} />
                        <span>/{l.uom}</span>
                      </label>
                    ) : (
                      <span>{v?.unit_labour_cost_cents == null ? "no rate" : `${dollars(v.unit_labour_cost_cents)}/${l.uom}`}</span>
                    )}
                    {v?.labour_rate_source && <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{SOURCE_LABEL[v.labour_rate_source]}</span>}
                    {canEdit && v?.labour_rate_source === "manual" && (
                      <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => revertToEstimateRate(i)}>
                        Use estimate rate
                      </Button>
                    )}
                    <span className="w-24 text-right tabular-nums text-foreground">{value === null ? "no rate" : dollars(value)}</span>
                  </div>
                )}
              </li>
            );
          })}
          {canPrice && (
            <li className="flex items-center justify-end gap-2 border-t border-border pt-1 text-xs">
              {uncosted && <span className="text-amber-700">{uncosted}</span>}
              <span className="font-medium">Installer pay: {dollars(pay.total_cents)}</span>
            </li>
          )}
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
