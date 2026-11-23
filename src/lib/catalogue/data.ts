import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Uom } from "@/lib/estimating/calc";
import { db } from "@/lib/platform/db";
import { planMaterialImport, type Category, type MaterialInput } from "./logic";

/** What a vendor supplies BMD: materials, labour (an installer or other subcontractor), or both. */
export type Supplies = "materials" | "labour" | "both";
export const SUPPLIES: { value: Supplies; label: string; short: string }[] = [
  { value: "materials", label: "Materials", short: "Materials" },
  { value: "labour", label: "Labour (installer or subcontractor)", short: "Labour" },
  { value: "both", label: "Materials and labour", short: "Both" },
];
/** Vendors that can sell BMD materials: the ones to offer when a product's supplier is picked. */
export const sellsMaterials = (s: { supplies: Supplies }) => s.supplies !== "labour";
export type Supplier = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; account_number: string | null; notes: string | null; active: boolean; supplies: Supplies };
export type CostCode = { code: string; name: string; qbo_item_id: string | null };
export type Material = {
  id: string;
  category: Category;
  name: string;
  manufacturer: string | null;
  product_line: string | null;
  colour: string | null;
  sku: string | null;
  supplier_id: string | null;
  cost_uom: Uom;
  unit_cost_cents: number | null;
  purchase_uom: Uom;
  coverage_per_purchase_unit: number | null;
  coverage_uom: Uom | null;
  pst_applies: boolean;
  default_waste_pct: number;
  cost_code: string | null;
  active: boolean;
  price_date: string | null;
  price_source: string | null;
  notes: string | null;
  /** False for a record imported from QuickBooks, which holds no units, until someone confirms the unit. */
  uom_confirmed: boolean;
};
export type LabourRate = { id: string; name: string; uom: Uom; unit_cost_cents: number | null; cost_code: string | null; active: boolean; uom_confirmed: boolean };
export type TemplateComponent = {
  id?: string;
  kind: "material" | "labour" | "fixed";
  label: string;
  source: "finish_material" | "catalogue" | "labour_rate" | "fixed";
  catalogue_material_id: string | null;
  labour_rate_id: string | null;
  unit_cost_cents: number | null;
  cost_uom: Uom | null;
  qty_per_driver: number;
  waste_pct: number | null;
  round_up: boolean;
  pst_applies: boolean;
  on_gross: boolean;
  sort_order: number;
};
export type Template = {
  id: string;
  name: string;
  category: Category;
  driver_uom: Uom;
  cost_code: string | null;
  default_waste_pct: number;
  sort_order: number;
  active: boolean;
  components: TemplateComponent[];
};
export type TaxSettings = { pst_pct: number; gst_pct: number; hst_pct: number };

const list = <T,>(key: string, table: string, select: string, order: string) =>
  function useList(enabled = true) {
    return useQuery({
      queryKey: ["catalogue", key],
      enabled,
      queryFn: async () => {
        const { data, error } = await db.from(table).select(select).order(order);
        if (error) throw error;
        return (data ?? []) as unknown as T[];
      },
    });
  };

export const useSuppliers = list<Supplier>("suppliers", "suppliers", "id,name,contact_name,email,phone,account_number,notes,active,supplies", "name");
export const useCostCodes = list<CostCode>("cost-codes", "cost_codes", "code,name,qbo_item_id", "sort_order");
export const useLabourRates = list<LabourRate>("labour", "labour_rates", "id,name,uom,unit_cost_cents,cost_code,active,uom_confirmed", "name");
const MATERIAL_COLS =
  "id,category,name,manufacturer,product_line,colour,sku,supplier_id,cost_uom,unit_cost_cents,purchase_uom,coverage_per_purchase_unit,coverage_uom,pst_applies,default_waste_pct,cost_code,active,price_date,price_source,notes,uom_confirmed";
export const useMaterials = list<Material>("materials", "catalogue_materials", MATERIAL_COLS, "name");

const COMPONENT_COLS = "id,kind,label,source,catalogue_material_id,labour_rate_id,unit_cost_cents,cost_uom,qty_per_driver,waste_pct,round_up,pst_applies,on_gross,sort_order";
export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: ["catalogue", "templates"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("assembly_templates")
        .select(`id,name,category,driver_uom,cost_code,default_waste_pct,sort_order,active,components:assembly_template_components(${COMPONENT_COLS})`)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as unknown as Template[]).map((t) => ({
        ...t,
        default_waste_pct: Number(t.default_waste_pct),
        components: [...t.components].sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ ...c, qty_per_driver: Number(c.qty_per_driver), waste_pct: c.waste_pct == null ? null : Number(c.waste_pct) })),
      }));
    },
  });
}

export function useTaxSettings(enabled = true) {
  return useQuery({
    queryKey: ["catalogue", "tax"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("tax_settings").select("pst_pct,gst_pct,hst_pct").eq("id", 1).maybeSingle();
      if (error) throw error;
      const t = data as { pst_pct: number; gst_pct: number; hst_pct: number } | null;
      if (!t) throw new Error("Tax rates are not set");
      return { pst_pct: Number(t.pst_pct), gst_pct: Number(t.gst_pct), hst_pct: Number(t.hst_pct) } as TaxSettings;
    },
  });
}

export function useRefreshCatalogue() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["catalogue"] });
}

const check = (error: { message: string } | null) => {
  if (!error) return;
  throw new Error(/_name_key/.test(error.message) ? "That name is already in use." : error.message);
};

async function save(table: string, id: string | null, row: Record<string, unknown>): Promise<string> {
  if (id) {
    check((await db.from(table).update(row).eq("id", id)).error);
    return id;
  }
  const { data, error } = await db.from(table).insert(row).select("id").single();
  check(error);
  return (data as { id: string }).id;
}

export const saveSupplier = (id: string | null, row: Omit<Supplier, "id">) => save("suppliers", id, row);
export const saveLabourRate = (id: string | null, row: Omit<LabourRate, "id">) => save("labour_rates", id, row);
export const saveMaterial = (id: string | null, row: Omit<Material, "id">) => save("catalogue_materials", id, { ...row, updated_at: new Date().toISOString() });

export async function saveTemplate(id: string | null, t: Omit<Template, "id" | "components">, components: TemplateComponent[]): Promise<string> {
  const templateId = await save("assembly_templates", id, t);
  check((await db.from("assembly_template_components").delete().eq("template_id", templateId)).error);
  if (components.length) {
    check(
      (
        await db.from("assembly_template_components").insert(
          components.map((c, i) => {
            const { id: _drop, ...rest } = c;
            return { ...rest, template_id: templateId, sort_order: i + 1 };
          }),
        )
      ).error,
    );
  }
  return templateId;
}

export async function saveTaxSettings(t: TaxSettings) {
  check((await db.from("tax_settings").update({ ...t, updated_at: new Date().toISOString() }).eq("id", 1)).error);
}

/** Adds new materials and applies only the price changes the user ticked. */
export async function importMaterials(rows: MaterialInput[], extra: { supplier_id: string | null; price_source: string | null }, acceptPriceIds: Set<string>) {
  const { data: existing, error } = await db.from("catalogue_materials").select("id,name,sku,colour,unit_cost_cents");
  check(error);
  const plan = planMaterialImport(rows, (existing ?? []) as never);
  const today = new Date().toISOString().slice(0, 10);
  // New items start with the waste and cost code of the assembly for their category; both can be changed per item.
  const { data: tpl } = await db.from("assembly_templates").select("category,cost_code,default_waste_pct").eq("active", true);
  const byCategory = new Map(((tpl ?? []) as { category: string; cost_code: string | null; default_waste_pct: number }[]).map((t) => [t.category, t]));
  for (let i = 0; i < plan.inserts.length; i += 200) {
    check(
      (
        await db.from("catalogue_materials").insert(
          plan.inserts.slice(i, i + 200).map((m) => ({
            ...m,
            ...extra,
            cost_code: byCategory.get(m.category)?.cost_code ?? null,
            default_waste_pct: Number(byCategory.get(m.category)?.default_waste_pct ?? 0),
            price_date: m.unit_cost_cents == null ? null : today,
          })),
        )
      ).error,
    );
  }
  let repriced = 0;
  for (const c of plan.priceChanges) {
    if (!acceptPriceIds.has(c.id)) continue;
    check((await db.from("catalogue_materials").update({ unit_cost_cents: c.toCents, price_date: today, price_source: extra.price_source, updated_at: new Date().toISOString() }).eq("id", c.id)).error);
    repriced += 1;
  }
  return { added: plan.inserts.length, repriced };
}

/** "$2.50 / SF" or "Unknown". */
export const priceLabel = (cents: number | null, uom: string) =>
  cents == null ? "Unknown" : `${(cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} / ${uom}`;

export const centsToInput = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2));

/** Sets one cost from the catalogue table. A material's price date moves to today when a price is entered. */
export async function setUnitCost(kind: "material" | "labour", id: string, cents: number | null) {
  const row = kind === "material" ? { unit_cost_cents: cents, updated_at: new Date().toISOString(), ...(cents != null ? { price_date: new Date().toISOString().slice(0, 10) } : {}) } : { unit_cost_cents: cents };
  check((await db.from(kind === "material" ? "catalogue_materials" : "labour_rates").update(row).eq("id", id)).error);
}

/** Deletes a catalogue item that nothing uses. One still in use is refused with the reason, so it can be made inactive instead. */
export async function deleteCatalogueItem(kind: "material" | "labour" | "assembly" | "supplier", id: string) {
  const { error } = await db.rpc("delete_catalogue_item", { _kind: kind, _id: id });
  if (error) throw new Error(/IN_USE:/.test(error.message) ? `This can't be deleted: it is ${error.message.replace(/^.*IN_USE:\s*/, "")}` : error.message);
}
