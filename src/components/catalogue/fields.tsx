import { cloneElement, useEffect, useId, useState, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { centsToInput, deleteCatalogueItem, setUnitCost, type CostCode } from "@/lib/catalogue/data";
import { costEdit, UOMS } from "@/lib/catalogue/logic";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

export const selectCls = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";

/** A labelled field. The label is tied to the control by id, so its name is the label text alone. */
export function F({ label, hint, children, className }: { label: string; hint?: string; children: ReactElement<{ id?: string }>; className?: string }) {
  const id = useId();
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function UomSelect({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  return (
    <select id={id} className={selectCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {UOMS.map((u) => (
        <option key={u}>{u}</option>
      ))}
    </select>
  );
}

export function CostCodeSelect({ value, onChange, codes, disabled, id }: { value: string | null; onChange: (v: string | null) => void; codes: CostCode[]; disabled?: boolean; id?: string }) {
  return (
    <select id={id} className={selectCls} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Not set</option>
      {codes.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} – {c.name}
        </option>
      ))}
    </select>
  );
}

/** A dollar amount. Blank means the price is not known yet, which is different from zero. */
export function MoneyInput({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
      <input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Unknown"
        className="h-11 w-full rounded-md border border-input bg-background pl-6 pr-3 text-sm tabular-nums disabled:opacity-50"
      />
    </div>
  );
}

export function Unknown() {
  return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">Price unknown</span>;
}

/** A cost typed straight into the catalogue table. Enter or leaving the box saves it; blank means the price is unknown. */
export function CostCell({ kind, id, name, cents, uom, onSaved }: { kind: "material" | "labour"; id: string; name: string; cents: number | null; uom: string; onSaved: () => void }) {
  const [text, setText] = useState(centsToInput(cents));
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(centsToInput(cents)), [cents]);
  const commit = async () => {
    const edit = costEdit(text, cents);
    if (edit.kind === "same") return setText(centsToInput(cents));
    if (edit.kind === "invalid") {
      toast.error("Enter the cost as a dollar amount, or leave it blank if unknown");
      return setText(centsToInput(cents));
    }
    setBusy(true);
    try {
      await setUnitCost(kind, id, edit.cents);
      toast.success(edit.cents == null ? `${name}: cost cleared` : `${name}: cost saved`);
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
      setText(centsToInput(cents));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <input
          inputMode="decimal"
          aria-label={`Cost of ${name} per ${uom}`}
          placeholder="Add cost"
          disabled={busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setText(centsToInput(cents));
          }}
          className={cn("h-10 w-28 rounded-md border bg-background pl-6 pr-2 text-right text-sm tabular-nums", cents == null && text === "" ? "border-amber-400 bg-amber-50 placeholder:text-amber-800" : "border-input")}
        />
      </span>
      <span className="text-xs text-muted-foreground">/ {uom}</span>
    </span>
  );
}

/** Delete, for an item's editing window. Asks first; an item still in use is refused with the reason. */
export function DeleteButton({ kind, id, name, onDeleted }: { kind: "material" | "labour" | "assembly" | "supplier"; id: string; name: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!window.confirm(`Delete ${name} from the catalogue? This cannot be undone. Estimates already priced keep their own costs.`)) return;
    setBusy(true);
    try {
      await deleteCatalogueItem(kind, id);
      toast.success(`${name} deleted`);
      onDeleted();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={busy} onClick={() => void run()}>
      <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Delete
    </Button>
  );
}
