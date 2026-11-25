import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VisitLine } from "./lines";
import type { LabourRateSource, ValuedLine } from "./valuation";
import { checkLinesInput } from "./valuation-load";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>; from: (t: string) => any };
type Result = { ok: true } | { ok: false; message: string };

const uuid = (v: unknown, what: string) => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`${what} is not valid.`);
  return v;
};
const SOURCES = new Set<LabourRateSource>(["estimate", "catalogue", "manual"]);

export type LineInput = VisitLine & {
  unit_labour_cost_cents?: number | null;
  labour_rate_source?: LabourRateSource | null;
  labour_rate_id?: string | null;
  /** "Use estimate rate": drop the manual rate and value the line again from the estimate, then the catalogue. */
  clear_manual?: boolean;
};

/**
 * Saves a work order's lines with their value. The rate on each line is a snapshot: a saved line keeps the rate it was
 * created with; a new line takes the approved estimate's labour cost per unit (the estimate's own arithmetic), else the
 * catalogue's rate for its cost code, else none. Pricing staff may enter a rate ("manual") or clear one back to the
 * estimate's. The rates are read here with the service role, so nobody needs view_pricing to create a valued work order,
 * and the browser of someone without it never sees them; the lines are then written as the person, so the table's own
 * rules decide who may write. A failed read stops the save: no line is ever re-valued from half the facts.
 */
export const saveVisitLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { visitId: string; lines: LineInput[] }) => {
    checkLinesInput(d?.lines);
    const lines = d.lines as LineInput[];
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
    const { loadValuationContext } = await import("./valuation-load");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: visit, error: ve } = await sb.from("install_visits").select("id,project_id").eq("id", data.visitId).maybeSingle();
    if (ve) return { ok: false, message: ve.message };
    if (!visit) return { ok: false, message: "That work order could not be found." };
    const [{ data: manage }, { data: price }] = await Promise.all([
      sb.rpc("has_capability", { _capability: "manage_projects", _project: visit.project_id }),
      sb.rpc("has_capability", { _capability: "view_pricing", _project: visit.project_id }),
    ]);
    if (manage !== true) return { ok: false, message: "You don't have permission to edit work orders." };

    let ctx;
    try {
      ctx = await loadValuationContext(supabaseAdmin as any, visit.project_id, visit.id);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    const valued = valueLines(data.lines as ValuedLine[], { ...ctx, canPrice: price === true });
    const { error } = await sb.rpc("install_visit_replace_lines", {
      _visit: visit.id,
      _lines: valued.map(({ id: _id, visit_id: _v, ...l }, i) => ({ ...l, quantity: Number(l.quantity), sort_order: l.sort_order ?? i })),
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  });
