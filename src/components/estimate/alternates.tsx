import { useMemo, useState } from "react";
import { toast } from "sonner";
import { F, selectCls } from "@/components/catalogue/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Template } from "@/lib/catalogue/data";
import { compareVersions, planSwap } from "@/lib/estimating/alternates";
import { priceEstimateLine, type CatalogueView } from "@/lib/estimating/assemble";
import { dollars, type EstVersion, type Finish, type SaveItem } from "@/lib/estimating/data";
import type { Rates } from "@/lib/estimating/worksheet";
import { cn } from "@/lib/utils";

/** Replace the finish behind a tag, everywhere in this price or only in chosen sections. */
export function SwapFinishDialog({
  version,
  finishes,
  templates,
  catalogue,
  rates,
  onClose,
  onApply,
}: {
  version: EstVersion;
  finishes: Finish[];
  templates: Template[];
  catalogue: CatalogueView;
  rates: Rates;
  onClose: () => void;
  onApply: (items: SaveItem[], note: string) => Promise<unknown>;
}) {
  const used = finishes.filter((f) => version.lines.some((l) => l.finish_id === f.id));
  const [from, setFrom] = useState(used[0]?.id ?? "");
  const [to, setTo] = useState("");
  const fromSections = useMemo(() => [...new Set(version.lines.filter((l) => l.finish_id === from).map((l) => l.section))], [version, from]);
  const [everywhere, setEverywhere] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const target = finishes.find((f) => f.id === to);
  const template = templates.find((t) => t.id === target?.assembly_template_id);
  const plan = useMemo(
    () => (target && template && from ? planSwap({ lines: version.lines, fromFinishId: from, to: target, template, catalogue, sections: everywhere ? undefined : [...picked] }) : null),
    [version, from, target, template, catalogue, everywhere, picked],
  );
  const delta = useMemo(() => {
    if (!plan) return 0;
    return plan.items.reduce((s, item) => {
      const line = version.lines.find((l) => l.id === item.id)!;
      return s + priceEstimateLine({ ...line, ...item.line }, item.components!, rates).sellCents - priceEstimateLine(line, line.components, rates).sellCents;
    }, 0);
  }, [plan, version, rates]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Swap a finish in {version.name}</DialogTitle>
          <DialogDescription>Quantities, markup and sections stay as they are. The new finish comes in at today's catalogue prices. Other prices (Base and other alternates) are not touched.</DialogDescription>
        </DialogHeader>
        {used.length === 0 ? (
          <p className="text-sm text-muted-foreground">This price has no lines tied to a finish yet.</p>
        ) : (
          <div className="grid gap-4">
            <F label="Replace">
              <select
                className={selectCls}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPicked(new Set());
                }}
              >
                {used.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.tag} {f.description ? `– ${f.description}` : ""}
                  </option>
                ))}
              </select>
            </F>
            <F label="With">
              <select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a finish…</option>
                {finishes.filter((f) => f.id !== from).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.tag} {f.description ? `– ${f.description}` : ""}
                  </option>
                ))}
              </select>
            </F>
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 font-medium">Where</legend>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="where" className="h-4 w-4" checked={everywhere} onChange={() => setEverywhere(true)} /> Everywhere in this price
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="where" className="h-4 w-4" checked={!everywhere} onChange={() => setEverywhere(false)} /> Only in these sections
              </label>
              {!everywhere && (
                <div className="ml-6 grid gap-1">
                  {fromSections.map((s) => (
                    <label key={s} className="flex min-h-10 items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={picked.has(s)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(s);
                          else next.delete(s);
                          setPicked(next);
                        }}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            {plan && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p>
                  <strong>{plan.items.length}</strong> {plan.items.length === 1 ? "line changes" : "lines change"}
                  {plan.untouched ? `, ${plan.untouched} in other sections stay as they are` : ""}. Selling price moves by <strong className="tabular-nums">{dollars(delta)}</strong> before tax.
                </p>
                {plan.overrideKept.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-amber-900">
                    {plan.overrideKept.map((k) => (
                      <li key={k.id}>
                        Override kept: {k.description} in {k.section} has a cost or price typed by hand and will not be changed.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !plan || plan.items.length === 0}
            onClick={async () => {
              if (!plan) return;
              setBusy(true);
              await onApply(plan.items, `${plan.items.length} ${plan.items.length === 1 ? "line" : "lines"} swapped${plan.overrideKept.length ? `, ${plan.overrideKept.length} kept` : ""}`);
              setBusy(false);
              if (plan.overrideKept.length) toast.message(`${plan.overrideKept.length} lines with hand-typed figures were left as they were.`);
            }}
          >
            {busy ? "Swapping…" : "Swap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Base and alternates side by side by section, differences from Base highlighted. */
export function CompareView({ versions, rates }: { versions: EstVersion[]; rates: Rates }) {
  const cmp = useMemo(() => compareVersions(versions, rates), [versions, rates]);
  const delta = (d: number) => (d === 0 ? null : <span className={cn("block text-xs tabular-nums", d > 0 ? "text-rose-700" : "text-emerald-700")}>{`${d > 0 ? "+" : "−"}${dollars(Math.abs(d))}`}</span>);
  return (
    <section className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="border-b border-border px-4 py-2.5 text-left text-sm font-semibold">Compare prices</caption>
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Section
            </th>
            {cmp.versions.map((v) => (
              <th key={v.id} scope="col" className="px-4 py-2 text-right font-medium normal-case">
                {v.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cmp.rows.map((r) => (
            <tr key={r.section}>
              <th scope="row" className="px-4 py-2 text-left font-normal">
                {r.section}
              </th>
              {r.sellCents.map((c, i) => (
                <td key={i} className={cn("px-4 py-2 text-right tabular-nums", r.changed[i] && "bg-amber-50 font-medium")}>
                  {dollars(c)}
                  {delta(r.deltaCents[i]!)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border">
          <tr>
            <th scope="row" className="px-4 py-1.5 text-left font-medium">
              Subtotal
            </th>
            {cmp.totals.map((t) => (
              <td key={t.id} className="px-4 py-1.5 text-right tabular-nums">
                {dollars(t.subtotalCents)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="px-4 py-1.5 text-left font-normal text-muted-foreground">
              Tax
            </th>
            {cmp.totals.map((t) => (
              <td key={t.id} className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                {dollars(t.taxCents)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="px-4 py-2 text-left font-semibold">
              Total
            </th>
            {cmp.totals.map((t) => (
              <td key={t.id} className="px-4 py-2 text-right text-base font-semibold tabular-nums">
                {dollars(t.totalCents)}
                {delta(t.deltaCents)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
