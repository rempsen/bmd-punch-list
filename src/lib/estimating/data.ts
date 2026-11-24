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
  unlocked_by: string | null;
  unlocked_at: string | null;
  unlock_reason: string | null;
  /** Markup % per category (section), applied to lines not set individually. */
  section_markups: Record<string, number>;
  lines: EstLine[];
};

const num = (v: unknown) => (v == null ? null : Number(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeLine(r: any): EstLine {
  return {
    ...r,
    driver_qty: Number(r.driver_qty),
    waste_pct: Number(r.waste_pct),
    markup_pct: Number(r.markup_pct),
    margin_pct: num(r.margin_pct),
    fixed_sell_cents: num(r.fixed_sell_cents),
    unit_cost_override_cents: num(r.unit_cost_override_cents),
    sell_override_cents: num(r.sell_override_cents),
    markup_overridden: r.markup_overridden === true,
    driver_uom: r.driver_uom as Uom,
    tax_code: r.tax_code as TaxCode,
    price_basis: r.price_basis as PriceBasis,
    selection: r.selection as Selection,
    components: ((r.components ?? []) as Record<string, unknown>[])
      .map((c) => ({ ...c, unit_cost_cents: num(c["unit_cost_cents"]), coverage_per_purchase_unit: num(c["coverage_per_purchase_unit"]), qty_per_driver: Number(c["qty_per_driver"]), waste_pct: Number(c["waste_pct"]), order_uom_factor: num(c["order_uom_factor"]), price_per: c["price_per"] === "order_unit" ? "order_unit" : "cost_unit" }) as unknown as SnapComponent)
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
        .select("id,project_id,kind,co_number,name,description,default_markup_pct,sort_order,is_base,locked,status,unlocked_by,unlocked_at,unlock_reason,section_markups,lines:estimate_lines(*,components:estimate_line_components(*))")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map(
        (v): EstVersion => ({ ...v, default_markup_pct: Number(v.default_markup_pct), section_markups: Object.fromEntries(Object.entries((v.section_markups ?? {}) as Record<string, unknown>).map(([k, x]) => [k, Number(x)])), lines: (v.lines as unknown[]).map(shapeLine).sort((a, b) => a.sort_order - b.sort_order) }),
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
    void qc.invalidateQueries({ queryKey: ["estimate-changes"] });
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
export async function updateVersion(id: string, patch: { name?: string; description?: string | null; default_markup_pct?: number; section_markups?: Record<string, number> }) {
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

/** True while an accepted or sent price is open for corrections. */
export const isEditable = (v: Pick<EstVersion, "locked" | "unlocked_at">) => !v.locked || v.unlocked_at != null;

export async function unlockVersion(id: string, reason: string) {
  fail((await db.rpc("unlock_estimate_version", { _id: id, _reason: reason })).error);
}
export async function relockVersion(id: string) {
  fail((await db.rpc("relock_estimate_version", { _id: id })).error);
}

export type EstChange = {
  id: string;
  version_id: string;
  line_id: string | null;
  component_index: number | null;
  line_label: string;
  field: string;
  field_label: string;
  from_value: unknown;
  to_value: unknown;
  changed_by: string | null;
  changed_at: string;
  reverted_at: string | null;
};
export type NewChange = Pick<EstChange, "version_id" | "line_id" | "component_index" | "line_label" | "field" | "field_label" | "from_value" | "to_value">;

export function useEstimateChanges(versionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["estimate-changes", versionId],
    enabled: !!versionId && enabled,
    queryFn: async () => {
      const { data, error } = await db.from("estimate_changes").select("*").eq("version_id", versionId!).order("changed_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as EstChange[];
    },
  });
}
/** Records typed overrides in the change history. A failure here never undoes the edit itself. */
export async function logChanges(rows: NewChange[], userId: string | null) {
  if (rows.length === 0 || !userId) return;
  const { error } = await db.from("estimate_changes").insert(rows.map((r) => ({ ...r, changed_by: userId })) as never);
  if (error) console.warn("Could not record estimate change", error.message);
}
export async function markReverted(id: string, userId: string | null) {
  fail((await db.from("estimate_changes").update({ reverted_at: new Date().toISOString(), reverted_by: userId } as never).eq("id", id)).error);
}

/** Accepted quotes on the project, for the "quote no longer matches" warning. */
export function useAcceptedQuotes(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["accepted-quotes", projectId],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const { data, error } = await db.from("quotes").select("id,number,accepted_version_id,accepted_value_cents,status").eq("project_id", projectId!).eq("status", "accepted");
      if (error) throw error;
      return (data ?? []) as { id: string; number: string | null; accepted_version_id: string | null; accepted_value_cents: number | null; status: string }[];
    },
  });
}
