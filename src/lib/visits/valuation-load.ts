// What saveVisitLines needs from the database to value a work order's lines, read with the service role: the approved
// estimate's labour parts, the catalogue's labour rates and the visit's saved lines. Every read is checked: a failed
// read throws, so a passing database blip never snapshots catalogue or null rates onto a work order and reports success.
// Kept apart from the server function so it can be tested with a stub client.
import type { LabourRate } from "@/lib/subcontract/logic";
import type { VisitLine } from "./lines";
import type { EstimateLabour, LineValuation } from "./valuation";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DbClient = { from: (table: string) => any };
type Reply<T> = { data: T | null; error: { message: string } | null };

export const MAX_WORK_ORDER_LINES = 200;

/** The line objects of a save request as they may arrive; throws a plain message for anything that cannot be saved. */
export function checkLinesInput(lines: unknown): asserts lines is unknown[] {
  if (!Array.isArray(lines)) throw new Error("Lines must be a list.");
  if (lines.length > MAX_WORK_ORDER_LINES) throw new Error(`A work order can have at most ${MAX_WORK_ORDER_LINES} lines.`);
}

const fail = (what: string, error: { message: string } | null) => new Error(`Could not read ${what} to value the work order: ${error?.message ?? "unknown error"}`);

export type ValuationContext = { items: EstimateLabour[]; rates: LabourRate[]; saved: (Pick<VisitLine, "id"> & LineValuation)[] };

/** The approved estimate (accepted, else base, as work_order_items picks it), the active labour rates and the visit's saved lines. */
export async function loadValuationContext(admin: DbClient, projectId: string, visitId: string): Promise<ValuationContext> {
  const versions: Reply<{ id: string; status: string; is_base: boolean }[]> = await admin
    .from("estimate_versions")
    .select("id,status,is_base,sort_order,created_at")
    .eq("project_id", projectId)
    .eq("kind", "estimate")
    .or("status.eq.accepted,is_base.eq.true")
    .order("sort_order")
    .order("created_at");
  if (versions.error) throw fail("the approved estimate", versions.error);
  const all = versions.data ?? [];
  const chosen = all.find((v) => v.status === "accepted") ?? all.find((v) => v.is_base) ?? all[0] ?? null;

  let items: EstimateLabour[] = [];
  if (chosen) {
    const est: Reply<any[]> = await admin
      .from("estimate_lines")
      .select("id,driver_qty,driver_uom,cost_code,estimate_line_components(unit_cost_cents,cost_uom,purchase_uom,coverage_per_purchase_unit,qty_per_driver,waste_pct,round_up,on_gross,labour_rate_id,kind,not_applicable,sort_order)")
      .eq("version_id", chosen.id);
    if (est.error) throw fail("the estimate's lines", est.error);
    items = (est.data ?? []).map((l) => {
      const parts = ((l.estimate_line_components ?? []) as any[]).filter((c) => c.kind === "labour" && !c.not_applicable).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      return { estimate_line_id: l.id, quantity: l.driver_qty, uom: l.driver_uom, cost_code: l.cost_code, labour_components: parts, labour_rate_id: parts.find((c) => c.labour_rate_id)?.labour_rate_id ?? null };
    });
  }

  const rates: Reply<any[]> = await admin.from("labour_rates").select("id,name,uom,unit_cost_cents,cost_code,active").eq("active", true);
  if (rates.error) throw fail("the catalogue's labour rates", rates.error);
  const saved: Reply<any[]> = await admin.from("install_visit_lines").select("id,unit_labour_cost_cents,labour_rate_source,labour_rate_id").eq("visit_id", visitId);
  if (saved.error) throw fail("the work order's saved lines", saved.error);

  return {
    items,
    rates: (rates.data ?? []).map((r) => ({ ...r, unit_cost_cents: r.unit_cost_cents === null ? null : Number(r.unit_cost_cents) })),
    saved: (saved.data ?? []).map((s) => ({ id: s.id, unit_labour_cost_cents: s.unit_labour_cost_cents === null ? null : Number(s.unit_labour_cost_cents), labour_rate_source: s.labour_rate_source ?? null, labour_rate_id: s.labour_rate_id ?? null })),
  };
}
