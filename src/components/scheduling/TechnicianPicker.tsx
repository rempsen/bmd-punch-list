import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { errText } from "@/lib/platform/db";
import { addSubcontractor } from "@/lib/scheduling/data";
import { searchTechnicians, type Technician } from "@/lib/scheduling/logic";
import { cn } from "@/lib/utils";

/**
 * Who a visit is assigned to: BMD staff, or any active Labour or Both vendor from Catalogue → Suppliers & subcontractors.
 * A crew that is not listed is added to the catalogue as Labour and picked in the same step.
 */
export function TechnicianPicker({ value, onChange, techs, disabled, canAdd, suggested = [] }: { value: string; onChange: (id: string) => void; techs: Technician[]; disabled?: boolean; canAdd: boolean; /** Crews linked to the labour on this job's estimate, offered first. */ suggested?: (Technician & { work: string })[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const current = techs.find((t) => t.id === value);
  const found = useMemo(() => searchTechnicians(techs, q), [techs, q]);
  const staff = found.filter((t) => t.source === "bmd");
  const subs = found.filter((t) => t.source === "supplier");
  const seen = found.filter((t) => t.source === "arriveping");
  const typed = q.trim().replace(/\s+/g, " ");
  const exact = techs.some((t) => t.source !== "arriveping" && t.name.trim().toLowerCase() === typed.toLowerCase());

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  const add = async (name: string) => {
    setAdding(true);
    try {
      const id = await addSubcontractor(name);
      await qc.refetchQueries({ queryKey: ["technicians"] });
      void qc.invalidateQueries({ queryKey: ["catalogue"] });
      toast.success(`${name} is now under Suppliers & subcontractors as Labour.`);
      pick(id);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setAdding(false);
    }
  };
  const row = (t: Technician, keyPrefix = "") => (
    <li key={keyPrefix + t.id} role="option" aria-selected={t.id === value}>
      <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => pick(t.id)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.name}</span>
          {t.detail && <span className="block truncate text-xs text-muted-foreground">{t.detail}</span>}
        </span>
        {t.both && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Both</span>}
        {t.id === value && <Check className="h-4 w-4 shrink-0" aria-hidden />}
      </button>
    </li>
  );
  const heading = (text: string) => <li role="presentation" className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{text}</li>;

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Crew"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm disabled:opacity-60"
      >
        <span className="min-w-0 truncate">
          {current ? current.name : "Unassigned"}
          {current?.source === "supplier" && <span className="ml-2 text-xs text-muted-foreground">Subcontractor</span>}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-1 rounded-md border border-border bg-background p-2 shadow-sm">
          <Input autoFocus aria-label="Find a crew" placeholder="Search staff and subcontractors…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
          <ul role="listbox" aria-label="Crews" className="mt-1 max-h-64 overflow-y-auto">
            {!typed && (
              <li role="option" aria-selected={!value}>
                <button type="button" className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted" onClick={() => pick("")}>
                  <span className="flex-1">Unassigned</span>
                  {!value && <Check className="h-4 w-4" aria-hidden />}
                </button>
              </li>
            )}
            {!typed && suggested.length > 0 && heading("Suggested for this job")}
            {!typed && suggested.map((t) => row({ ...t, id: t.id, detail: `Does ${t.work}` }, "s-"))}
            {staff.length > 0 && heading("Staff")}
            {staff.map((t) => row(t))}
            {subs.length > 0 && heading("Subcontractors")}
            {subs.map((t) => row(t))}
            {canAdd && seen.length > 0 && heading("Seen in ArrivePing, not in the catalogue yet")}
            {canAdd &&
              seen.map((t) => (
                <li key={t.id} role="option" aria-selected={false}>
                  <button type="button" disabled={adding} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted" onClick={() => void add(t.name)}>
                    <Plus className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">Add {t.name} as a subcontractor</span>
                  </button>
                </li>
              ))}
            {canAdd && typed.length >= 2 && !exact && (
              <li role="option" aria-selected={false}>
                <button type="button" disabled={adding} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md border border-dashed border-border px-2 text-left text-sm hover:bg-muted" onClick={() => void add(typed)}>
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Add “{typed}” to Suppliers &amp; subcontractors as Labour
                  </span>
                </button>
              </li>
            )}
            {staff.length + subs.length === 0 && typed && <li className="px-2 py-2 text-sm text-muted-foreground">Nobody by that name.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
