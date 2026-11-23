import { useState } from "react";
import { toast } from "sonner";
import { CostCodeSelect, F, MoneyInput, UomSelect, selectCls } from "@/components/catalogue/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/catalogue/fields";
import { Input } from "@/components/ui/input";
import { centsToInput, saveMaterial, type CostCode, type Material, type Supplier } from "@/lib/catalogue/data";
import { CATEGORIES, parseMoneyCents, type Category } from "@/lib/catalogue/logic";
import type { Uom } from "@/lib/estimating/calc";
import { errText } from "@/lib/platform/db";

const AREA: Uom[] = ["SF", "SY", "LF"];

/** Add or edit one catalogue material. Also used from an estimate to add a material in place. */
export function MaterialDialog({
  material,
  defaults,
  suppliers,
  costCodes,
  canEdit,
  onClose,
  onSaved,
}: {
  material: Material | null;
  defaults?: Partial<Material>;
  suppliers: Supplier[];
  costCodes: CostCode[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const m = material ?? defaults ?? {};
  const [f, setF] = useState({
    name: m.name ?? "",
    category: (m.category ?? "other") as Category,
    manufacturer: m.manufacturer ?? "",
    product_line: m.product_line ?? "",
    colour: m.colour ?? "",
    sku: m.sku ?? "",
    supplier_id: m.supplier_id ?? "",
    cost_uom: (m.cost_uom ?? "SF") as Uom,
    price: centsToInput(m.unit_cost_cents ?? null),
    purchase_uom: (m.purchase_uom ?? "SF") as Uom,
    coverage: m.coverage_per_purchase_unit == null ? "" : String(m.coverage_per_purchase_unit),
    coverage_uom: (m.coverage_uom ?? "SF") as Uom,
    pst_applies: m.pst_applies ?? true,
    waste: String(m.default_waste_pct ?? 0),
    cost_code: m.cost_code ?? null,
    price_source: m.price_source ?? "",
    notes: m.notes ?? "",
    active: m.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((cur) => ({ ...cur, ...p }));
  // Cartons, rolls and pails need to know how much floor one of them covers.
  const packed = f.purchase_uom !== f.cost_uom || ["carton", "roll", "pail"].includes(f.purchase_uom);

  const save = async () => {
    const price = f.price.trim() === "" ? null : parseMoneyCents(f.price);
    if (f.price.trim() !== "" && price == null) {
      toast.error("Enter the price as a dollar amount, or leave it blank if unknown");
      return;
    }
    const coverage = f.coverage.trim() === "" ? null : Number(f.coverage);
    if (packed && !(coverage && coverage > 0)) {
      toast.error(`Enter how much one ${f.purchase_uom} covers`);
      return;
    }
    const waste = Number(f.waste || 0);
    if (!(waste >= 0 && waste <= 100)) {
      toast.error("Waste must be between 0 and 100%");
      return;
    }
    setBusy(true);
    try {
      const priceChanged = price !== (material?.unit_cost_cents ?? null);
      const id = await saveMaterial(material?.id ?? null, {
        name: f.name.trim(),
        category: f.category,
        manufacturer: f.manufacturer.trim() || null,
        product_line: f.product_line.trim() || null,
        colour: f.colour.trim() || null,
        sku: f.sku.trim() || null,
        supplier_id: f.supplier_id || null,
        cost_uom: f.cost_uom,
        unit_cost_cents: price,
        purchase_uom: f.purchase_uom,
        coverage_per_purchase_unit: packed ? coverage : null,
        coverage_uom: packed ? f.coverage_uom : null,
        pst_applies: f.pst_applies,
        default_waste_pct: waste,
        cost_code: f.cost_code,
        active: f.active,
        price_date: priceChanged && price != null ? new Date().toISOString().slice(0, 10) : (material?.price_date ?? null),
        price_source: f.price_source.trim() || null,
        notes: f.notes.trim() || null,
      });
      toast.success(material ? "Material saved" : "Material added");
      onSaved(id);
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{material ? material.name : "New material"}</DialogTitle>
          <DialogDescription>Supplier pricing is visible to office staff only. Leave the price blank until you have it.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <F label="Name" className="sm:col-span-2">
            <Input className="h-11" value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </F>
          <F label="Category">
            <select className={selectCls} value={f.category} onChange={(e) => set({ category: e.target.value as Category })}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </F>
          <F label="Supplier">
            <select className={selectCls} value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })}>
              <option value="">Not set</option>
              {suppliers.filter((s) => s.active || s.id === f.supplier_id).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </F>
          <F label="Manufacturer">
            <Input className="h-11" value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />
          </F>
          <F label="Product line">
            <Input className="h-11" value={f.product_line} onChange={(e) => set({ product_line: e.target.value })} />
          </F>
          <F label="Colour">
            <Input className="h-11" value={f.colour} onChange={(e) => set({ colour: e.target.value })} />
          </F>
          <F label="SKU">
            <Input className="h-11" value={f.sku} onChange={(e) => set({ sku: e.target.value })} />
          </F>

          <F label="Price as quoted">
            <MoneyInput value={f.price} onChange={(v) => set({ price: v })} />
          </F>
          <F label="Priced per">
            <UomSelect
              value={f.cost_uom}
              onChange={(v) => set({ cost_uom: v as Uom, purchase_uom: AREA.includes(v as Uom) && f.purchase_uom !== f.cost_uom ? f.purchase_uom : (v as Uom) })}
            />
          </F>
          <F label="Bought by" hint="Same as the price unit unless it comes packed, such as LVP priced per SF and bought by the carton.">
            <UomSelect value={f.purchase_uom} onChange={(v) => set({ purchase_uom: v as Uom })} />
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label={`One ${f.purchase_uom} covers`} hint={packed ? "Used to work out how many to order." : "Not needed."}>
              <Input className="h-11" inputMode="decimal" disabled={!packed} value={packed ? f.coverage : ""} onChange={(e) => set({ coverage: e.target.value })} />
            </F>
            <F label="Measured in">
              <select className={selectCls} disabled={!packed} value={f.coverage_uom} onChange={(e) => set({ coverage_uom: e.target.value as Uom })}>
                {AREA.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </F>
          </div>
          <F label="Default waste %">
            <Input className="h-11" inputMode="decimal" value={f.waste} onChange={(e) => set({ waste: e.target.value })} />
          </F>
          <F label="Cost code">
            <CostCodeSelect value={f.cost_code} onChange={(v) => set({ cost_code: v })} codes={costCodes} />
          </F>
          <label className="flex min-h-11 items-start gap-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={f.pst_applies} onChange={(e) => set({ pst_applies: e.target.checked })} />
            <span>
              Add PST to this price
              <span className="block text-xs text-muted-foreground">Leave on for supplier prices quoted before PST. Turn off when the price already includes it.</span>
            </span>
          </label>
          <F label="Price source" hint="For example the supplier quote number or price list date." className="sm:col-span-2">
            <Input className="h-11" value={f.price_source} onChange={(e) => set({ price_source: e.target.value })} />
          </F>
          {material && (
            <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
              Active (untick to hide it from pickers; existing estimates keep it)
            </label>
          )}
        </fieldset>
        <DialogFooter>
          {canEdit && material && <DeleteButton kind="material" id={material.id} name={material.name} onDeleted={() => onSaved(material.id)} />}
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button disabled={busy || !f.name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
