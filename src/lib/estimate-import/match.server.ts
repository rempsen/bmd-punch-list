/** Server side of import matching: loads the catalogue and aliases, asks the AI for weak lines, writes aliases. */
import { STRONG_SCORE, aiMatchPrompt, AI_MATCH_SYSTEM, fuzzyCandidates, matchLine, normaliseAlias, parseAiMatch, type AliasRow, type Candidate, type CatalogueEntry, type ImportedLine, type MatchResult } from "./match";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;
const dollars = (c: number | null | undefined) => (c == null ? null : Number(c) / 100);

/** Active materials and assemblies as match entries. Assembly prices are the per-driver sum of their priced parts. */
export async function loadCatalogue(sb: Sb): Promise<{ catalogue: CatalogueEntry[]; aliases: AliasRow[] }> {
  const [mats, labour, tpls, comps, aliases] = await Promise.all([
    sb.from("catalogue_materials").select("id,name,category,cost_uom,unit_cost_cents,manufacturer,product_line,colour").eq("active", true),
    sb.from("labour_rates").select("id,unit_cost_cents"),
    sb.from("assembly_templates").select("id,name,category,driver_uom").eq("active", true),
    sb.from("assembly_template_components").select("template_id,kind,source,catalogue_material_id,labour_rate_id,unit_cost_cents,qty_per_driver"),
    sb.from("catalogue_aliases").select("alias_norm,catalogue_item_id,assembly_id"),
  ]);
  for (const r of [mats, labour, tpls, comps, aliases]) if (r.error) throw new Error(r.error.message);
  const matCost = new Map<string, number | null>((mats.data ?? []).map((m: { id: string; unit_cost_cents: number | null }) => [m.id, m.unit_cost_cents]));
  const labCost = new Map<string, number | null>((labour.data ?? []).map((l: { id: string; unit_cost_cents: number | null }) => [l.id, l.unit_cost_cents]));
  const catalogue: CatalogueEntry[] = (mats.data ?? []).map((m: { id: string; name: string; category: string; cost_uom: string; unit_cost_cents: number | null; manufacturer: string | null; product_line: string | null; colour: string | null }) => ({
    kind: "item" as const, id: m.id, name: m.name, description: [m.manufacturer, m.product_line, m.colour].filter(Boolean).join(" · ") || null,
    category: m.category, unit: m.cost_uom, material_unit_cost: dollars(m.unit_cost_cents), labour_unit_cost: null,
  }));
  for (const t of (tpls.data ?? []) as { id: string; name: string; category: string; driver_uom: string }[]) {
    let mat: number | null = null;
    let lab: number | null = null;
    for (const c of (comps.data ?? []) as { template_id: string; kind: string; source: string; catalogue_material_id: string | null; labour_rate_id: string | null; unit_cost_cents: number | null; qty_per_driver: number }[]) {
      if (c.template_id !== t.id) continue;
      const cents = c.source === "catalogue" ? matCost.get(c.catalogue_material_id ?? "") : c.source === "labour_rate" ? labCost.get(c.labour_rate_id ?? "") : c.source === "fixed" ? c.unit_cost_cents : null;
      if (cents == null) continue;
      const v = (Number(cents) / 100) * Number(c.qty_per_driver ?? 1);
      if (c.kind === "labour") lab = (lab ?? 0) + v;
      else mat = (mat ?? 0) + v;
    }
    catalogue.push({ kind: "assembly", id: t.id, name: t.name, description: null, category: t.category, unit: t.driver_uom, material_unit_cost: mat, labour_unit_cost: lab });
  }
  return { catalogue, aliases: aliases.data ?? [] };
}

type Ask = (a: { system: string; prompt: string; maxTokens?: number }) => Promise<{ text: string }>;

/** Best-effort AI ranking of the top fuzzy candidates. Returns [] on any failure; ids and reasons only. */
export async function suggestWithAI(line: ImportedLine, top20: Candidate[], ask?: Ask): Promise<Candidate[]> {
  if (!top20.length) return [];
  try {
    const fn = ask ?? (await import("@/lib/ai/model.server")).askStrongModel;
    const res = await fn({ system: AI_MATCH_SYSTEM, prompt: aiMatchPrompt(line, top20), maxTokens: 600 });
    return parseAiMatch(res.text, top20);
  } catch (e) {
    console.error(`[import-match] AI ranking skipped: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** matchLine, then the AI when nothing scores 0.6 or more. AI candidates take a 0.6 score so they sort above weak words. */
export async function matchWithAI(line: ImportedLine, catalogue: CatalogueEntry[], aliases: AliasRow[], opts: { ai?: boolean; ask?: Ask } = {}): Promise<MatchResult & { ai: boolean }> {
  const r = matchLine(line, catalogue, aliases);
  if (r.status === "exact_alias" || opts.ai === false || (r.candidates[0]?.score ?? 0) >= STRONG_SCORE) return { ...r, ai: false };
  const ranked = await suggestWithAI(line, fuzzyCandidates(line, catalogue, 20, 0.01), opts.ask);
  if (!ranked.length) return { ...r, ai: false };
  const rest = r.candidates.filter((c) => !ranked.some((x) => (x.catalogue_item_id ?? x.assembly_id) === (c.catalogue_item_id ?? c.assembly_id)));
  return { status: "fuzzy", candidates: [...ranked.map((c) => ({ ...c, score: Math.max(c.score, STRONG_SCORE) })), ...rest].slice(0, 5), ai: true };
}

/** Writes the alias (imported text → item) or bumps its use count. Runs as the caller, so alias permissions apply. */
export async function writeAlias(sb: Sb, text: string, target: { catalogue_item_id?: string | null; assembly_id?: string | null }, source: "import" | "manual" = "import"): Promise<string> {
  const norm = normaliseAlias(text);
  if (!norm) throw new Error("The alias is empty.");
  if (!target.catalogue_item_id === !target.assembly_id) throw new Error("Pick exactly one catalogue item or assembly.");
  const { data, error } = await sb.rpc("confirm_catalogue_alias", { _alias: text, _alias_norm: norm, _catalogue_item_id: target.catalogue_item_id ?? null, _assembly_id: target.assembly_id ?? null, _source: source });
  if (error) throw new Error(error.message);
  return data as string;
}
