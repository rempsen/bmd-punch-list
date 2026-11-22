import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CostCodeSelect, F, MoneyInput, UomSelect, selectCls } from "@/components/catalogue/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { centsToInput, saveTemplate, type CostCode, type LabourRate, type Material, type Template, type TemplateComponent } from "@/lib/catalogue/data";
import { CATEGORIES, parseMoneyCents, type Category } from "@/lib/catalogue/logic";
import type { Uom } from "@/lib/estimating/calc";
import { errText } from "@/lib/platform/db";

type Row = Omit<TemplateComponent, "unit_cost_cents" | "qty_per_driver" | "waste_pct"> & { price: string; qty: string; waste: string };

const SOURCES: { value: TemplateComponent["source"]; label: string }[] = [
  { value: "finish_material", label: "The finish's material" },
  { value: "catalogue", label: "A catalogue item" },
  { value: "labour_rate", label: "A labour rate" },
  { value: "fixed", label: "A set amount" },
];

const toRow = (c: TemplateComponent): Row => ({
  ...c,
  price: centsToInput(c.unit_cost_cents),
  qty: String(c.qty_per_driver),
  waste: c.waste_pct == null ? "" : String(c.waste_pct),
});

/** Edit a supply-and-install assembly: what goes into one unit of the finished work. */
export function AssemblyDialog({
  template,
  materials,
  labour,
  costCodes,
  canEdit,
  onClose,
  onSaved,
}: {
  template: Template | null;
  materials: Material[];
  labour: LabourRate[];
  costCodes: CostCode[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [category, setCategory] = useState<Category>(template?.category ?? "other");
  const [driver, setDriver] = useState<Uom>(template?.driver_uom ?? "SF");
  const [costCode, setCostCode] = useState<string | null>(template?.cost_code ?? null);
  const [waste, setWaste] = useState(String(template?.default_waste_pct ?? 0));
  const [active, setActive] = useState(template?.active ?? true);
  const [rows, setRows] = useState<Row[]>((template?.components ?? []).map(toRow));
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const add = () =>
    setRows((rs) => [
      ...rs,
      { kind: "fixed", label: "", source: "fixed", catalogue_material_id: null, labour_rate_id: null, cost_uom: driver, round_up: false, pst_applies: false, on_gross: false, sort_order: rs.length + 1, price: "", qty: "1", waste: "" },
    ]);

  const save = async () => {
    const components: TemplateComponent[] = [];
    for (const [i, r] of rows.entries()) {
      const at = r.label.trim() || `Row ${i + 1}`;
      const qty = Number(r.qty);
      if (!(qty >= 0)) return void toast.error(`${at}: enter a quantity per ${driver}`);
      const w = r.waste.trim() === "" ? null : Number(r.waste);
      if (w != null && !(w >= 0 && w <= 100)) return void toast.error(`${at}: waste must be between 0 and 100%`);
      const price = r.source === "fixed" && r.price.trim() !== "" ? parseMoneyCents(r.price) : null;
      if (r.source === "fixed" && r.price.trim() !== "" && price == null) return void toast.error(`${at}: enter the amount in dollars, or leave it blank if unknown`);
      if (!r.label.trim()) return void toast.error(`Row ${i + 1} needs a name`);
      components.push({
        kind: r.source === "labour_rate" ? "labour" : r.source === "fixed" ? "fixed" : "material",
        label: r.label.trim(),
        source: r.source,
        catalogue_material_id: r.source === "catalogue" ? r.catalogue_material_id : null,
        labour_rate_id: r.source === "labour_rate" ? r.labour_rate_id : null,
        unit_cost_cents: price,
        cost_uom: r.source === "fixed" ? (r.cost_uom ?? driver) : null,
        qty_per_driver: qty,
        waste_pct: w,
        round_up: r.round_up,
        pst_applies: r.source === "fixed" ? r.pst_applies : false,
        on_gross: r.source === "labour_rate" ? r.on_gross : false,
        sort_order: i + 1,
      });
    }
    const dw = Number(waste || 0);
    if (!(dw >= 0 && dw <= 100)) return void toast.error("Default waste must be between 0 and 100%");
    setBusy(true);
    try {
      await saveTemplate(template?.id ?? null, { name: name.trim(), category, driver_uom: driver, cost_code: costCode, default_waste_pct: dw, sort_order: template?.sort_order ?? 99, active }, components);
      toast.success("Assembly saved");
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? template.name : "New assembly"}</DialogTitle>
          <DialogDescription>What one {driver} of this work is made of. An estimate line copies these rows when it is added; later changes here do not alter saved estimates.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <F label="Name" className="sm:col-span-2">
              <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
            </F>
            <F label="Category">
              <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </F>
            <F label="Measured in">
              <UomSelect value={driver} onChange={(v) => setDriver(v as Uom)} />
            </F>
            <F label="Cost code" className="sm:col-span-2">
              <CostCodeSelect value={costCode} onChange={setCostCode} codes={costCodes} />
            </F>
            <F label="Default waste %">
              <Input className="h-11" inputMode="decimal" value={waste} onChange={(e) => setWaste(e.target.value)} />
            </F>
            <label className="flex items-end gap-2 pb-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
          </div>

          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <F label="Row name" className="sm:col-span-3">
                    <Input className="h-11" value={r.label} onChange={(e) => patch(i, { label: e.target.value })} />
                  </F>
                  <F label="Comes from" className="sm:col-span-3">
                    <select className={selectCls} value={r.source} onChange={(e) => patch(i, { source: e.target.value as Row["source"] })}>
                      {SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </F>
                  <div className="sm:col-span-4">
                    {r.source === "catalogue" && (
                      <F label="Catalogue item">
                        <select className={selectCls} value={r.catalogue_material_id ?? ""} onChange={(e) => patch(i, { catalogue_material_id: e.target.value || null })}>
                          <option value="">Choose on each estimate</option>
                          {materials.filter((m) => m.active || m.id === r.catalogue_material_id).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </F>
                    )}
                    {r.source === "labour_rate" && (
                      <F label="Labour rate">
                        <select className={selectCls} value={r.labour_rate_id ?? ""} onChange={(e) => patch(i, { labour_rate_id: e.target.value || null })}>
                          <option value="">Choose on each estimate</option>
                          {labour.filter((l) => l.active || l.id === r.labour_rate_id).map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name} (per {l.uom})
                            </option>
                          ))}
                        </select>
                      </F>
                    )}
                    {r.source === "fixed" && (
                      <div className="grid grid-cols-2 gap-3">
                        <F label="Amount">
                          <MoneyInput value={r.price} onChange={(v) => patch(i, { price: v })} />
                        </F>
                        <F label="Per">
                          <UomSelect value={r.cost_uom ?? driver} onChange={(v) => patch(i, { cost_uom: v as Uom })} />
                        </F>
                      </div>
                    )}
                    {r.source === "finish_material" && <p className="pt-7 text-sm text-muted-foreground">Uses the material picked for the finish tag.</p>}
                  </div>
                  <div className="flex items-end justify-end sm:col-span-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                    </Button>
                  </div>
                  <F label={`Quantity per ${driver}`} hint="Usually 1. Coverage per carton or pail comes from the material itself." className="sm:col-span-3">
                    <Input className="h-11" inputMode="decimal" value={r.qty} onChange={(e) => patch(i, { qty: e.target.value })} />
                  </F>
                  <F label="Waste %" hint="Blank uses the default." className="sm:col-span-2">
                    <Input className="h-11" inputMode="decimal" value={r.waste} onChange={(e) => patch(i, { waste: e.target.value })} />
                  </F>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-6 text-sm sm:col-span-7">
                    {r.source !== "labour_rate" && (
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={r.round_up} onChange={(e) => patch(i, { round_up: e.target.checked })} /> Round up to whole units
                      </label>
                    )}
                    {r.source === "fixed" && (
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={r.pst_applies} onChange={(e) => patch(i, { pst_applies: e.target.checked })} /> Add PST
                      </label>
                    )}
                    {r.source === "labour_rate" && (
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={r.on_gross} onChange={(e) => patch(i, { on_gross: e.target.checked })} /> Pay labour on the quantity including waste
                      </label>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" className="h-11" onClick={add}>
              <Plus className="mr-2 h-4 w-4" /> Add a row
            </Button>
          </div>
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button disabled={busy || !name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
