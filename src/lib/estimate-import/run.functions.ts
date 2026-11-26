import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ImportOptions, Mapping } from "./types";
import { MAPPING_FIELDS } from "./types";

const UUID = /^[0-9a-f-]{36}$/i;

export const runEstimateImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; documentId: string }) => {
    if (!d || !UUID.test(d.projectId ?? "") || !UUID.test(d.documentId ?? "")) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { runImport } = await import("./run.server");
    return runImport(context.supabase, context.userId, data);
  });

export const reparseEstimateImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { importId: string; mapping: Mapping; options: Partial<ImportOptions> }) => {
    if (!d || !UUID.test(d.importId ?? "") || !d.mapping || typeof d.mapping !== "object") throw new Error("Invalid request");
    for (const [k, v] of Object.entries(d.mapping)) if (!(MAPPING_FIELDS as readonly string[]).includes(k) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > 500) throw new Error(`Invalid column for ${k}`);
    const o = d.options ?? {};
    if (o.gross_up_pst_pct != null && !(o.gross_up_pst_pct >= 0 && o.gross_up_pst_pct <= 20)) throw new Error("PST gross-up must be 0–20%");
    if (o.default_markup_pct != null && !(o.default_markup_pct > -100 && o.default_markup_pct < 1000)) throw new Error("Invalid markup");
    if (o.category_strategy != null && !["groups", "single", "none"].includes(o.category_strategy)) throw new Error("Invalid category strategy");
    return { importId: d.importId, mapping: d.mapping, options: o };
  })
  .handler(async ({ data, context }) => {
    const { reparseImport } = await import("./run.server");
    return reparseImport(context.supabase, data);
  });
