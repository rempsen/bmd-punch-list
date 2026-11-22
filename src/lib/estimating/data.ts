import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LabourRate, Material } from "@/lib/catalogue/data";
import { db } from "@/lib/platform/db";
import type { CatalogueView, PriceBasis, SnapComponent } from "./assemble";
import type { TaxCode, Uom } from "./calc";
import type { Selection, WsLine } from "./worksheet";

export type Finish = {
  id: string;
  project_id: string;
  tag: string;
  description: string | null;
  assembly_template_id: string | null;
  catalogue_material_id: string | null;
  sort_order: number;
};

export type LineKind = "assembly" | "prep" | "misc" | "delivery" | "subcontract" | "allowance" | "lump_sum";
export const LINE_KINDS: { value: Exclude<LineKind, "assembly">; label: string; costCode: string | null }[] = [
  { value: "prep", label: "Prep", costCode: "01-18" },
  { value: "misc", label: "Miscellaneous", costCode: "03-000" },
  { value: "delivery", label: "Delivery / freight", costCode: "03-050" },
  { value: "subcontract", label: "Subcontract", costCode: null },
  { value: "allowance", label: "Allowance", costCode: "04-010" },
  { value: "lump_sum", label: "Lump sum", costCode: null },
];

export type EstLine = WsLine & {
  version_id: string;
  finish_id: string | null;
  kind: LineKind;
  source: "manual" | "import" | "takeoff";
  waste_pct: number;
  notes: string | null;
  sort_order: number;
  is_allowance: boolean;
  subject_to_measure: boolean;
  takeoff_condition_id: string | null;
  detached: boolean;
  row_version: number;
};
export type EstVersion = {
  id: string;
  project_id: string;
  kind: "estimate" | "change_order";
  co_number: number | null;
  name: string;
  description: string | null;
  default_markup_pct: number;
  sort_order: number;
  is_base: boolean;
  locked: boolean;
  status: "draft" | "sent" | "accepted" | "not_taken";
  lines: EstLine[];
};

const num = (v: unknown) => (v == null ? null : Number(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeLine(r: any): EstLine {
  return {
    ...r,
    driver_qty: Number(r.driver_qty),
    waste_pct: Number(r.waste_pct),
    markup_pct: Number(r.markup_pct),
    margin_pct: num(r.margin_pct),
    fixed_sell_cents: num(r.fixed_sell_cents),
    driver_uom: r.driver_uom as Uom,
    tax_code: r.tax_code as TaxCode,
    price_basis: r.price_basis as PriceBasis,
    selection: r.selection as Selection,
    components: ((r.components ?? []) as Record<string, unknown>[])
      .map((c) => ({ ...c, unit_cost_cents: num(c["unit_cost_cents"]), coverage_per_purchase_unit: num(c["coverage_per_purchase_unit"]), qty_per_driver: Number(c["qty_per_driver"]), waste_pct: Number(c["waste_pct"]) }) as unknown as SnapComponent)
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}

export function useEstimate(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["estimate", projectId],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("estimate_versions")
        .select("id,project_id,kind,co_number,name,description,default_markup_pct,sort_order,is_base,locked,status,lines:estimate_lines(*,components:estimate_line_components(*))")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map(
        (v): EstVersion => ({ ...v, default_markup_pct: Number(v.default_markup_pct), lines: (v.lines as unknown[]).map(shapeLine).sort((a, b) => a.sort_order - b.sort_order) }),
      );
    },
  });
}

export function useFinishes(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["finishes", projectId],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const { data, error } = await db.from("project_finishes").select("id,project_id,tag,description,assembly_template_id,catalogue_material_id,sort_order").eq("project_id", projectId!).order("sort_order").order("tag");
      if (error) throw error;
      return (data ?? []) as Finish[];
    },
  });
}

export function useRefreshEstimate(projectId: string | null) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["estimate", projectId] });
    void qc.invalidateQueries({ queryKey: ["finishes", projectId] });
  };
}

/** True when the save was refused because someone else changed the line first. */
export const isReload = (e: unknown) => /RELOAD:/.test(e instanceof Error ? e.message : String(e));
const clean = (m: string) => m.replace(/^RELOAD:\s*/, "").replace(/^s/, "S");
const fail = (error: { message: string } | null) => {
  if (error) throw new Error(/RELOAD:/.test(error.message) ? `RELOAD: ${clean(error.message)}` : error.message);
};

export type LinePatch = Partial<Omit<EstLine, "id" | "version_id" | "components" | "row_version">>;
export type SaveItem = { id?: string; version_id?: string; row_version?: number; line: LinePatch; components?: SnapComponent[] };

export async function saveLines(items: SaveItem[]) {
  if (items.length === 0) return;
  fail((await db.rpc("save_estimate_lines", { _items: items })).error);
}
export async function deleteLine(id: string, rowVersion: number) {
  fail((await db.rpc("delete_estimate_line", { _id: id, _row_version: rowVersion })).error);
}
export async function createVersion(projectId: string, name: string, kind: "estimate" | "change_order" = "estimate"): Promise<string> {
  const { data, error } = await db.rpc("create_estimate_version", { _project: projectId, _name: name, _kind: kind });
  fail(error);
  return data as string;
}
export async function copyVersion(fromId: string, name: string, description: string | null): Promise<string> {
  const { data, error } = await db.rpc("copy_estimate_version", { _from: fromId, _name: name, _description: description });
  fail(error);
  return data as string;
}
export async function deleteVersion(id: string) {
  fail((await db.rpc("delete_estimate_version", { _id: id })).error);
}
export async function updateVersion(id: string, patch: { name?: string; description?: string | null; default_markup_pct?: number }) {
  fail((await db.from("estimate_versions").update(patch).eq("id", id)).error);
}
export async function saveFinish(id: string | null, row: Omit<Finish, "id">): Promise<string> {
  if (id) {
    fail((await db.from("project_finishes").update(row).eq("id", id)).error);
    return id;
  }
  const { data, error } = await db.from("project_finishes").insert(row).select("id").single();
  if (error) throw new Error(/tag_key/.test(error.message) ? `The tag ${row.tag} is already used on this project.` : error.message);
  return (data as { id: string }).id;
}
export async function deleteFinish(id: string) {
  fail((await db.from("project_finishes").delete().eq("id", id)).error);
}

export function catalogueView(materials: Material[], labour: LabourRate[]): CatalogueView {
  return {
    materials: Object.fromEntries(materials.map((m) => [m.id, { ...m, default_waste_pct: Number(m.default_waste_pct), coverage_per_purchase_unit: num(m.coverage_per_purchase_unit) }])),
    labour: Object.fromEntries(labour.map((l) => [l.id, l])),
  };
}

export const dollars = (cents: number) => (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
