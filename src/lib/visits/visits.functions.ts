import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VisitLine } from "./lines";
import type { EstimateLabour, LabourRateSource, ValuedLine } from "./valuation";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>; from: (t: string) => any };
type Result = { ok: true } | { ok: false; message: string };

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`${what} is not valid.`);
  return v;
};
const SOURCES = new Set<LabourRateSource>(["estimate", "catalogue", "manual"]);

export type LineInput = VisitLine & { unit_labour_cost_cents?: number | null; labour_rate_source?: LabourRateSource | null; labour_rate_id?: string | null };

/**
 * Saves a work order's lines with their value. The rate on each line is a snapshot: a saved line keeps the rate it was
 * created with; a new line takes the approved estimate's labour cost per unit (the estimate's own arithmetic), else the
 * catalogue's rate for its cost code, else none. Pricing staff may enter a rate ("manual"). The rates are read here with
 * the service role, so nobody needs view_pricing to create a valued work order, and the browser of someone without it
 * never sees them; the lines are then written as the person, so the table's own rules decide who may write.
 */
export const saveVisitLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { visitId: string; lines: LineInput[] }) => {
    const lines = Array.isArray(d?.lines) ? d.lines.slice(0, 200) : [];
    for (const l of lines) {
      if (!Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0) throw new Error("Each work item needs a quantity of zero or more.");
      if (l.unit_labour_cost_cents != null && (!Number.isFinite(Number(l.unit_labour_cost_cents)) || Number(l.unit_labour_cost_cents) < 0)) throw new Error("A rate must be zero or more.");
      if (l.labour_rate_source != null && !SOURCES.has(l.labour_rate_source)) throw new Error("Unknown rate source.");
    }
    return { visitId: uuid(d?.visitId, "The work order"), lines };
  })
  .handler(async ({ data, context }): Promise<Result> => {
    const sb = context.supabase as never as Sb;
    const { valueLines } = await import("./valuation");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: visit, error: ve } = await sb.from("install_visits").select("id,project_id").eq("id", data.visitId).maybeSingle();
    if (ve) return { ok: false, message: ve.message };
    if (!visit) return { ok: false, message: "That work order could not be found." };
    const [{ data: manage }, { data: price }] = await Promise.all([
      sb.rpc("has_capability", { _capability: "manage_projects", _project: visit.project_id }),
      sb.rpc("has_capability", { _capability: "view_pricing", _project: visit.project_id }),
    ]);
    if (manage !== true) return { ok: false, message: "You don't have permission to edit work orders." };

    // The approved estimate's lines with their labour parts (the accepted version, else the base version).
    const { data: version } = await admin
      .from("estimate_versions")
      .select("id,status,is_base,sort_order,created_at")
      .eq("project_id", visit.project_id)
      .eq("kind", "estimate")
      .or("status.eq.accepted,is_base.eq.true")
      .order("sort_order")
      .order("created_at");
    const versions = (version ?? []) as { id: string; status: string; is_base: boolean }[];
    const chosen = versions.find((v) => v.status === "accepted") ?? versions.find((v) => v.is_base) ?? versions[0] ?? null;
    let items: EstimateLabour[] = [];
    if (chosen) {
      const { data: est } = await admin
        .from("estimate_lines")
        .select("id,driver_qty,driver_uom,cost_code,estimate_line_components(unit_cost_cents,cost_uom,purchase_uom,coverage_per_purchase_unit,qty_per_driver,waste_pct,round_up,on_gross,labour_rate_id,kind,not_applicable,sort_order)")
        .eq("version_id", chosen.id);
      items = ((est ?? []) as any[]).map((l) => {
        const parts = ((l.estimate_line_components ?? []) as any[]).filter((c) => c.kind === "labour" && !c.not_applicable).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        return { estimate_line_id: l.id, quantity: l.driver_qty, uom: l.driver_uom, cost_code: l.cost_code, labour_components: parts, labour_rate_id: parts.find((c) => c.labour_rate_id)?.labour_rate_id ?? null };
      });
    }
    const [{ data: rates }, { data: saved, error: se }] = await Promise.all([
      admin.from("labour_rates").select("id,name,uom,unit_cost_cents,cost_code,active").eq("active", true),
      admin.from("install_visit_lines").select("id,unit_labour_cost_cents,labour_rate_source,labour_rate_id").eq("visit_id", visit.id),
    ]);
    if (se) return { ok: false, message: se.message };

    const valued = valueLines(data.lines as ValuedLine[], {
      saved: ((saved ?? []) as any[]).map((s) => ({ id: s.id, unit_labour_cost_cents: s.unit_labour_cost_cents === null ? null : Number(s.unit_labour_cost_cents), labour_rate_source: s.labour_rate_source, labour_rate_id: s.labour_rate_id })),
      items,
      rates: ((rates ?? []) as any[]).map((r) => ({ ...r, unit_cost_cents: r.unit_cost_cents === null ? null : Number(r.unit_cost_cents) })),
      canPrice: price === true,
    });
    const { error } = await sb.rpc("install_visit_replace_lines", {
      _visit: visit.id,
      _lines: valued.map(({ id: _id, visit_id: _v, ...l }, i) => ({ ...l, quantity: Number(l.quantity), sort_order: l.sort_order ?? i })),
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  });
