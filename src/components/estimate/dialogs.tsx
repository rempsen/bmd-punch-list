import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CostCodeSelect, F, MoneyInput, UomSelect, selectCls } from "@/components/catalogue/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CostCode, Template } from "@/lib/catalogue/data";
import { parseMoneyCents } from "@/lib/catalogue/logic";
import { applyRefresh, priceEstimateLine, refreshDiff, type CatalogueView } from "@/lib/estimating/assemble";
import type { Uom } from "@/lib/estimating/calc";
import { LINE_KINDS, dollars, type EstVersion, type Finish, type LineKind, type SaveItem } from "@/lib/estimating/data";
import { lineFromFinish, simpleLine, windowLine } from "@/lib/estimating/lines";
import { parsePastedQuantities, type Rates } from "@/lib/estimating/worksheet";

type AddFn = (items: SaveItem[], note?: string) => Promise<unknown>;

function SectionInput({ value, onChange, sections, id }: { value: string; onChange: (v: string) => void; sections: string[]; id?: string }) {
  return (
    <>
      <Input id={id} className="h-11" list="estimate-sections" value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Level 2 guest rooms" />
      <datalist id="estimate-sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

export function AddLineDialog({
  version,
  finishes,
  templates,
  catalogue,
  costCodes,
  sections,
  onClose,
  onAdd,
}: {
  version: EstVersion;
  finishes: Finish[];
  templates: Template[];
  catalogue: CatalogueView;
  costCodes: CostCode[];
  sections: string[];
  onClose: () => void;
  onAdd: AddFn;
}) {
  const [mode, setMode] = useState<"finish" | "other">(finishes.length ? "finish" : "other");
  const [section, setSection] = useState(sections[sections.length - 1] ?? "");
  const [finishId, setFinishId] = useState(finishes[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [markup, setMarkup] = useState(String(version.default_markup_pct));
  const [kind, setKind] = useState<Exclude<LineKind, "assembly">>("prep");
  const [description, setDescription] = useState("");
  const [uom, setUom] = useState<Uom>("LS");
  const [cost, setCost] = useState("");
  const [pst, setPst] = useState(false);
  const [costCode, setCostCode] = useState<string | null>(LINE_KINDS[0]!.costCode);
  const [busy, setBusy] = useState(false);

  const finish = finishes.find((f) => f.id === finishId);
  const template = templates.find((t) => t.id === finish?.assembly_template_id);

  const submit = async () => {
    const q = Number(qty.replace(/,/g, ""));
    const m = Number(markup);
    if (!(q >= 0) || qty.trim() === "") return void toast.error("Enter a quantity");
    if (!(m >= 0 && m <= 1000)) return void toast.error("Enter a markup between 0 and 1000%");
    let item: SaveItem;
    let note = "Line added";
    if (mode === "finish") {
      if (!finish || !template) return void toast.error("Choose a finish. Add finishes in the panel above first.");
      const built = lineFromFinish({ versionId: version.id, finish, template, catalogue, qty: q, section, markupPct: m });
      item = built.item;
      if (built.issues.length) note = `Line added. To finish it: ${built.issues.join(" ")}`;
    } else {
      const cents = cost.trim() === "" ? null : parseMoneyCents(cost);
      if (cost.trim() !== "" && cents == null) return void toast.error("Enter the cost in dollars, or leave it blank if unknown");
      if (!description.trim()) return void toast.error("Describe the line");
      item = simpleLine({ versionId: version.id, kind, section, description: description.trim(), qty: q, uom, unitCostCents: cents, pst, markupPct: m, costCode });
    }
    setBusy(true);
    await onAdd([item], note);
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a line to {version.name}</DialogTitle>
          <DialogDescription>A finish line brings its material, sundries and install labour. Other lines are a single cost times a quantity.</DialogDescription>
        </DialogHeader>
        <div className="flex rounded-md border border-border" role="group" aria-label="Kind of line">
          {(["finish", "other"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`h-11 flex-1 text-sm first:rounded-l-md last:rounded-r-md ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {m === "finish" ? "A finish (supply and install)" : "Prep, delivery, lump sum…"}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Section" className="sm:col-span-2">
            <SectionInput value={section} onChange={setSection} sections={sections} />
          </F>
          {mode === "finish" ? (
            <>
              <F label="Finish" className="sm:col-span-2">
                <select className={selectCls} value={finishId} onChange={(e) => setFinishId(e.target.value)}>
                  {finishes.length === 0 && <option value="">No finishes yet</option>}
                  {finishes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.tag} {f.description ? `– ${f.description}` : ""}
                    </option>
                  ))}
                </select>
              </F>
              <F label={`Quantity (${template?.driver_uom ?? "SF"})`}>
                <Input className="h-11" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </F>
            </>
          ) : (
            <>
              <F label="Kind">
                <select
                  className={selectCls}
                  value={kind}
                  onChange={(e) => {
                    const k = e.target.value as typeof kind;
                    setKind(k);
                    setCostCode(LINE_KINDS.find((x) => x.value === k)?.costCode ?? null);
                  }}
                >
                  {LINE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Cost code">
                <CostCodeSelect value={costCode} onChange={setCostCode} codes={costCodes} />
              </F>
              <F label="Description" className="sm:col-span-2">
                <Input className="h-11" value={description} onChange={(e) => setDescription(e.target.value)} />
              </F>
              <F label="Quantity">
                <Input className="h-11" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </F>
              <F label="Unit">
                <UomSelect value={uom} onChange={(v) => setUom(v as Uom)} />
              </F>
              <F label={`Cost per ${uom}`}>
                <MoneyInput value={cost} onChange={setCost} />
              </F>
              <label className="flex items-end gap-2 pb-3 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={pst} onChange={(e) => setPst(e.target.checked)} /> Add PST to this cost
              </label>
            </>
          )}
          <F label="Markup %">
            <Input className="h-11" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
          </F>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type WinRow = { type: string; product: string; qty: string; vendor: string; install: string; misc: string };
const blankWin = (n: number): WinRow => ({ type: `W${n}`, product: "", qty: "", vendor: "", install: "", misc: "" });

/** Several window types at once: one line per type, priced per piece, with a quantity multiplier. */
export function WindowScheduleDialog({ version, sections, onClose, onAdd }: { version: EstVersion; sections: string[]; onClose: () => void; onAdd: AddFn }) {
  const [section, setSection] = useState("Window coverings");
  const [markup, setMarkup] = useState(String(version.default_markup_pct));
  const [rows, setRows] = useState<WinRow[]>([blankWin(1), blankWin(2), blankWin(3)]);
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<WinRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const filled = rows.filter((r) => r.qty.trim() !== "");

  const submit = async () => {
    const m = Number(markup);
    if (!(m >= 0 && m <= 1000)) return void toast.error("Enter a markup between 0 and 1000%");
    const items: SaveItem[] = [];
    for (const r of filled) {
      const qty = Number(r.qty);
      if (!(qty > 0)) return void toast.error(`${r.type}: enter how many`);
      const money = (v: string, what: string) => {
        if (v.trim() === "") return null;
        const c = parseMoneyCents(v);
        if (c == null) throw new Error(`${r.type}: ${what} must be a dollar amount or blank`);
        return c;
      };
      try {
        items.push(windowLine({ versionId: version.id, section, type: r.type, product: r.product, qty, vendorCents: money(r.vendor, "vendor price"), installCents: money(r.install, "install"), miscCents: money(r.misc, "delivery and staging"), markupPct: m }));
      } catch (e) {
        return void toast.error((e as Error).message);
      }
    }
    if (items.length === 0) return void toast.error("Enter a quantity on at least one row");
    setBusy(true);
    await onAdd(items);
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Window schedule</DialogTitle>
          <DialogDescription>One row per window type. Prices are per piece; PST is added to the vendor price only. Leave an amount blank if you don't have it yet.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="Section" className="sm:col-span-2">
            <SectionInput value={section} onChange={setSection} sections={sections} />
          </F>
          <F label="Markup %">
            <Input className="h-11" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
          </F>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Type</th>
                <th className="py-1 pr-2 font-medium">Product, size, location</th>
                <th className="py-1 pr-2 font-medium">How many</th>
                <th className="py-1 pr-2 font-medium">Vendor $ each</th>
                <th className="py-1 pr-2 font-medium">Install $ each</th>
                <th className="py-1 pr-2 font-medium">Delivery $ each</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {(["type", "product", "qty", "vendor", "install", "misc"] as const).map((k) => (
                    <td key={k} className="py-1 pr-2">
                      <Input aria-label={`${k} for row ${i + 1}`} className={k === "product" ? "h-11 min-w-48" : "h-11 w-24"} inputMode={k === "type" || k === "product" ? "text" : "decimal"} value={r[k]} onChange={(e) => patch(i, { [k]: e.target.value })} />
                    </td>
                  ))}
                  <td>
                    <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-muted">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="outline" className="h-11 w-fit" onClick={() => setRows((rs) => [...rs, blankWin(rs.length + 1)])}>
          <Plus className="mr-2 h-4 w-4" /> Add a type
        </Button>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || filled.length === 0} onClick={() => void submit()}>
            {busy ? "Adding…" : `Add ${filled.length} ${filled.length === 1 ? "type" : "types"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quantities pasted from Excel: tag, quantity, then optionally unit and section. */
export function PasteDialog({ version, finishes, templates, catalogue, onClose, onAdd }: { version: EstVersion; finishes: Finish[]; templates: Template[]; catalogue: CatalogueView; onClose: () => void; onAdd: AddFn }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parsePastedQuantities(text), [text]);
  const plan = useMemo(() => {
    const items: SaveItem[] = [];
    const notes: string[] = [...parsed.problems];
    for (const r of parsed.rows) {
      const finish = finishes.find((f) => f.tag.toLowerCase() === r.tag.toLowerCase());
      const template = templates.find((t) => t.id === finish?.assembly_template_id);
      if (!finish || !template) {
        notes.push(`${r.tag} is not one of this job's finishes; it was skipped.`);
        continue;
      }
      let qty = r.qty;
      if (r.uom && r.uom !== template.driver_uom) {
        if (r.uom === "SY" && template.driver_uom === "SF") qty = r.qty * 9;
        else if (r.uom === "SF" && template.driver_uom === "SY") qty = r.qty / 9;
        else {
          notes.push(`${r.tag}: ${r.uom} does not fit a finish measured in ${template.driver_uom}; it was skipped.`);
          continue;
        }
      }
      items.push(lineFromFinish({ versionId: version.id, finish, template, catalogue, qty: Math.round(qty * 100) / 100, section: r.section ?? "General", markupPct: version.default_markup_pct, source: "import" }).item);
    }
    return { items, notes };
  }, [parsed, finishes, templates, catalogue, version]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Paste quantities</DialogTitle>
          <DialogDescription>Copy rows from Excel with the tag in the first column and the quantity in the second. A unit and a section can follow in the third and fourth.</DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Pasted rows" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"CPT-1\t4500\tSF\tLevel 2\nLVP-1\t1200\tSF\tLevel 2"} className="font-mono text-sm" />
        {text.trim() !== "" && (
          <div className="space-y-2 text-sm">
            <p>
              <strong>{plan.items.length}</strong> {plan.items.length === 1 ? "line" : "lines"} ready to add at {version.default_markup_pct}% markup.
            </p>
            {plan.notes.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-3 pl-7 text-amber-950">
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || plan.items.length === 0}
            onClick={async () => {
              setBusy(true);
              await onAdd(plan.items);
              setBusy(false);
            }}
          >
            {busy ? "Adding…" : `Add ${plan.items.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shows what current catalogue prices would change on this estimate before anything is applied. */
export function RefreshDialog({ version, catalogue, rates, onClose, onApply }: { version: EstVersion; catalogue: CatalogueView; rates: Rates; onClose: () => void; onApply: AddFn }) {
  const [busy, setBusy] = useState(false);
  const rows = useMemo(
    () =>
      version.lines
        .map((line) => {
          const changes = refreshDiff(line.components, catalogue);
          if (changes.length === 0) return null;
          const next = applyRefresh(line.components, changes);
          return { line, changes, next, before: priceEstimateLine(line, line.components, rates).sellCents, after: priceEstimateLine(line, next, rates).sellCents };
        })
        .filter((r) => r !== null),
    [version, catalogue, rates],
  );
  const applicable = rows.filter((r) => r.changes.some((c) => !c.overrideKept));
  const delta = applicable.reduce((s, r) => s + (r.after - r.before), 0);
  const cents = (c: number | null) => (c == null ? "unknown" : `$${(c / 100).toFixed(2)}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Refresh prices on {version.name}</DialogTitle>
          <DialogDescription>Saved lines keep the prices they were built with. This shows what today's catalogue prices would change. Nothing changes until you apply.</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every line already matches the catalogue.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {rows.map((r) => (
              <li key={r.line.id} className="px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{r.line.description}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {dollars(r.before)} → <strong className="text-foreground">{dollars(r.after)}</strong>
                  </span>
                </div>
                <ul className="mt-0.5 text-xs text-muted-foreground">
                  {r.changes.map((c) => (
                    <li key={c.index}>
                      {c.label}: {cents(c.fromCents)} → {cents(c.toCents)}
                      {c.overrideKept ? " (override kept: the cost typed on this estimate stays)" : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {applicable.length > 0 && (
          <p className="text-sm">
            Selling price changes by <strong className="tabular-nums">{dollars(delta)}</strong> before tax.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {applicable.length ? "Cancel" : "Close"}
          </Button>
          {applicable.length > 0 && (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onApply(applicable.map((r) => ({ id: r.line.id, row_version: r.line.row_version, line: {}, components: r.next })));
                setBusy(false);
              }}
            >
              {busy ? "Applying…" : `Apply to ${applicable.length} ${applicable.length === 1 ? "line" : "lines"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
