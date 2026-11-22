import { cloneElement, useId, type ReactElement } from "react";
import { Label } from "@/components/ui/label";
import type { CostCode } from "@/lib/catalogue/data";
import { UOMS } from "@/lib/catalogue/logic";
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
