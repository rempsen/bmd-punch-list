export type ScopeVerdict = "in_scope" | "not_scope" | "unclear";
export type ScopeAiHit = { id: string; term: string; document: string; page: number | null; snippet: string };
export type ScopeAiSuggestion = { id: string; verdict: ScopeVerdict; suggestion: string };

export const SCOPE_AI_BATCH = 60;

export const SCOPE_AI_SYSTEM =
  "You review plans and specifications for BMD Materials, a flooring, tile, base and window-covering contractor. " +
  "For each flagged scope term you get the surrounding text. Decide whether it is BMD scope to price (in_scope), clearly not BMD's work " +
  "(not_scope — e.g. 'by others', a different trade, a title block or a false match like CT for 'contract'), or unclear. " +
  "Give the estimator one short, practical suggestion (max 200 characters): what to price, what to check, or why to ignore. " +
  'Reply with JSON only: {"items":[{"id":"…","verdict":"in_scope|not_scope|unclear","suggestion":"…"}]}.';

export function scopeAiPrompt(hits: ScopeAiHit[]): string {
  return hits.map((h) => `id=${h.id} | term="${h.term}" | ${h.document}${h.page ? ` p.${h.page}` : ""}\n${h.snippet}`).join("\n\n");
}

const VERDICTS = new Set<ScopeVerdict>(["in_scope", "not_scope", "unclear"]);

/** Reads the model's answer; keeps only items for hits that were asked about, with a valid verdict. */
export function parseScopeAi(text: string, askedIds: Set<string>): ScopeAiSuggestion[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let body: unknown;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: ScopeAiSuggestion[] = [];
  for (const it of items as Record<string, unknown>[]) {
    const id = typeof it["id"] === "string" ? it["id"] : "";
    const verdict = it["verdict"] as ScopeVerdict;
    if (!askedIds.has(id) || !VERDICTS.has(verdict)) continue;
    out.push({ id, verdict, suggestion: String(it["suggestion"] ?? "").trim().slice(0, 500) });
  }
  return out;
}

export const verdictLabel = (v: string | null) => (v === "in_scope" ? "Likely BMD scope" : v === "not_scope" ? "Probably not ours" : v === "unclear" ? "Check" : "");
