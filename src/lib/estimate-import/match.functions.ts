import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Candidate, ImportedLine } from "./match";

const asLine = (l: ImportedLine): ImportedLine => ({
  description: String(l?.description ?? "").slice(0, 500),
  detail: l?.detail == null ? null : String(l.detail).slice(0, 1000),
  uom: l?.uom == null ? null : String(l.uom).slice(0, 20),
  material_unit_cost: l?.material_unit_cost == null ? null : Number(l.material_unit_cost),
  labour_unit_cost: l?.labour_unit_cost == null ? null : Number(l.labour_unit_cost),
});

/** Matches up to 300 imported lines against the catalogue. AI is used only for weak lines, best-effort. */
export const matchImportedLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lines: ImportedLine[]; ai?: boolean }) => ({ lines: (d?.lines ?? []).slice(0, 300).map(asLine), ai: d?.ai !== false }))
  .handler(async ({ data, context }) => {
    const { loadCatalogue, matchWithAI } = await import("./match.server");
    const { catalogue, aliases } = await loadCatalogue(context.supabase);
    // Weak lines each wait on an AI call; run them a few at a time so a full file finishes well inside the request limit.
    const out: Awaited<ReturnType<typeof matchWithAI>>[] = new Array(data.lines.length);
    let next = 0;
    const worker = async () => {
      while (next < data.lines.length) {
        const i = next++;
        out[i] = await matchWithAI(data.lines[i]!, catalogue, aliases, { ai: data.ai });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, data.lines.length) }, worker));
    return out;
  });

/** The user confirmed a match: save the imported wording as an alias of the item. Works with or without an import row. */
export const confirmMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { importRowId?: string | null; line: ImportedLine; candidate: Pick<Candidate, "catalogue_item_id" | "assembly_id"> }) => ({
    importRowId: d?.importRowId ?? null,
    line: asLine(d.line),
    candidate: { catalogue_item_id: d?.candidate?.catalogue_item_id ?? null, assembly_id: d?.candidate?.assembly_id ?? null },
  }))
  .handler(async ({ data, context }) => {
    const { writeAlias } = await import("./match.server");
    const aliasId = await writeAlias(context.supabase, data.line.description, data.candidate, "import");
    return { aliasId, importRowId: data.importRowId, by: context.userId };
  });
