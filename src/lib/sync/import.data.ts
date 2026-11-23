import { db } from "@/lib/platform/db";
import { planImport, suggestPicks, type Action, type Existing, type ImportPick, type StagedRow } from "./import";

/** Reads what is held for review from one system and what BMD already has, and works out the import. Nothing is written. */
export async function loadImportPlan(system: "quickbooks"): Promise<{ plan: Action[]; picks: Map<string, ImportPick>; staged: number }> {
  const [staged, materials, labour, suppliers, costCodes, links] = await Promise.all([
    db.from("sync_staging").select("entity,external_id,kind,name,data").eq("system", system).order("name").limit(20000),
    db.from("catalogue_materials").select("id,name,sku,unit_cost_cents,active").limit(20000),
    db.from("labour_rates").select("id,name,unit_cost_cents,active").limit(5000),
    db.from("suppliers").select("id,name,contact_name,email,phone,account_number,active").limit(20000),
    db.from("cost_codes").select("code,name,qbo_item_id").limit(5000),
    db.from("sync_links").select("kind,bmd_id,external_id").eq("system", system).limit(50000),
  ]);
  for (const r of [staged, materials, labour, suppliers, costCodes, links]) if (r.error) throw r.error;
  const existing: Existing = {
    materials: (materials.data ?? []) as Existing["materials"],
    labour: (labour.data ?? []) as Existing["labour"],
    suppliers: (suppliers.data ?? []) as Existing["suppliers"],
    costCodes: (costCodes.data ?? []) as Existing["costCodes"],
    links: (links.data ?? []) as Existing["links"],
  };
  const rows = (staged.data ?? []) as StagedRow[];
  const plan = planImport(rows, existing);
  return { plan, picks: suggestPicks(plan, rows), staged: rows.length };
}

/** Applies the ticked steps of a plan that has been shown as a dry run. Only "create" and "link" steps are sent; what is left out stays held. */
export async function applyImport(system: "quickbooks", plan: Action[]): Promise<{ created: number; linked: number; skipped: number }> {
  const actions = plan.filter((a) => a.op === "create" || a.op === "link");
  const total = { created: 0, linked: 0, skipped: 0 };
  // Suppliers go first and on their own, so every product's supplier already exists when the products are written.
  const batches: Action[][] = [actions.filter((a) => a.kind === "supplier"), actions.filter((a) => a.kind !== "supplier")].flatMap((list) => {
    const out: Action[][] = [];
    for (let i = 0; i < list.length; i += 400) out.push(list.slice(i, i + 400));
    return out;
  });
  for (const batch of batches) {
    const { data, error } = await db.rpc("sync_import_apply", { _system: system, _actions: batch });
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as Partial<typeof total>;
    total.created += r.created ?? 0;
    total.linked += r.linked ?? 0;
    total.skipped += r.skipped ?? 0;
  }
  return total;
}
