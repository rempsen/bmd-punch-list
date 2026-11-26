/**
 * Matching imported estimate lines to the BMD catalogue. Pure: no database, no network.
 * The imported line keeps its own numbers; a match is only offered, with the price difference, for a person to confirm.
 */
import { findScopeHits, type ScopeKeyword } from "@/lib/documents/scope-keywords";
import type { Category } from "@/lib/catalogue/logic";

/** Minimal imported line. Draft 1's types.ts owns the full row type; this shape is a subset of it. */
export type ImportedLine = {
  description: string;
  detail: string | null;
  uom: string | null;
  material_unit_cost: number | null;
  labour_unit_cost: number | null;
};

/** One catalogue entry to match against: a material or an assembly. Costs in dollars per `unit`. */
export type CatalogueEntry = {
  kind: "item" | "assembly";
  id: string;
  name: string;
  description: string | null;
  category: string;
  unit: string;
  material_unit_cost: number | null;
  labour_unit_cost: number | null;
};
export type AliasRow = { alias_norm: string; catalogue_item_id: string | null; assembly_id: string | null };

export type Candidate = {
  catalogue_item_id?: string;
  assembly_id?: string;
  name: string;
  score: number;
  /** The catalogue's own unit and prices. */
  uom: string;
  material_unit_cost: number | null;
  labour_unit_cost: number | null;
  reason: string;
};
export type MatchStatus = "exact_alias" | "fuzzy" | "none";
export type MatchResult = { status: MatchStatus; candidates: Candidate[] };

export const MIN_SCORE = 0.35;
export const STRONG_SCORE = 0.6;
export const MAX_CANDIDATES = 5;
export const PRICE_BONUS_BAND = 0.25;
export const VERIFY_BAND = 0.15;

/** Lower case, trimmed, punctuation and runs of whitespace collapsed to one space: "  LVT-1,  Main. " → "lvt 1 main". */
export function normaliseAlias(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Units: upper-cased short forms; SY/SF convertible. */
export function normaliseUom(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.trim().toLowerCase().replace(/[.\s]/g, "");
  const map: Record<string, string> = { sf: "SF", sqft: "SF", ft2: "SF", sy: "SY", sqyd: "SY", yd2: "SY", lf: "LF", lft: "LF", ft: "LF", feet: "LF", ea: "EA", each: "EA", pc: "EA", hr: "hour", hour: "hour", ls: "LS", lot: "LS" };
  return map[s] ?? u.trim();
}

/** Price per `from` unit expressed per `to` unit; null when the units don't convert. */
export function convertPrice(price: number, from: string | null, to: string | null): number | null {
  const f = normaliseUom(from);
  const t = normaliseUom(to);
  if (!f || !t) return null;
  if (f === t) return price;
  if (f === "SF" && t === "SY") return price * 9;
  if (f === "SY" && t === "SF") return price / 9;
  return null;
}

// Phrases first (longest), then single words, mapped to one canonical token.
const PHRASES: [RegExp, string][] = [
  [/\bluxury vinyl (plank|tile)\b/g, "lvt"],
  [/\bvinyl plank\b/g, "lvt"],
  [/\bsheet vinyl\b/g, "sheetvinyl"],
  [/\b(wall|millwork|rubber|cove) base\b/g, "base"],
];
const WORDS: Record<string, string> = {
  lvt: "lvt", lvp: "lvt", plank: "lvt",
  carpet: "carpet", broadloom: "carpet",
  base: "base", baseboard: "base",
  tile: "tile", porcelain: "tile", ceramic: "tile",
  laminate: "laminate", spc: "laminate", wpc: "laminate",
  sv: "sheetvinyl",
};
const STOP = new Set(["floor", "flooring", "main", "the", "and", "of", "to", "for", "with", "a", "in", "supply", "install", "area", "areas", "new"]);
const CATEGORY_TOKEN: Record<string, string> = {
  carpet_broadloom: "carpet", carpet_tile: "carpet", lvp: "lvt", lvt: "lvt", sheet_vinyl: "sheetvinyl", rubber: "rubber",
  floor_tile: "tile", wall_tile: "tile", wall_base: "base", transitions: "transition", tile_trim: "trim", window_coverings: "blind",
};

const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Normalised, synonym-folded tokens; numbers and filler words dropped. */
export function matchTokens(text: string): Set<string> {
  let s = normaliseAlias(text);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const out = new Set<string>();
  for (const raw of s.split(" ")) {
    if (!raw || /^\d+$/.test(raw)) continue;
    const w = stem(raw);
    if (STOP.has(w)) continue;
    out.add(WORDS[w] ?? w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const toCandidate = (e: CatalogueEntry, score: number, reason: string): Candidate => ({
  ...(e.kind === "item" ? { catalogue_item_id: e.id } : { assembly_id: e.id }),
  name: e.name,
  score: Math.round(score * 1000) / 1000,
  uom: e.unit,
  material_unit_cost: e.material_unit_cost,
  labour_unit_cost: e.labour_unit_cost,
  reason,
});

/** Every catalogue entry scored by words, unit and price; sorted best first, at or above `min`, at most `limit`. */
export function fuzzyCandidates(line: ImportedLine, catalogue: CatalogueEntry[], limit = MAX_CANDIDATES, min = MIN_SCORE): Candidate[] {
  const lt = matchTokens(line.description);
  const scored: Candidate[] = [];
  for (const e of catalogue) {
    const et = matchTokens(e.name);
    const ct = CATEGORY_TOKEN[e.category];
    if (ct) et.add(ct);
    const words = jaccard(lt, et);
    if (words === 0) continue;
    let score = words * 0.8;
    const reasons = [`words ${Math.round(words * 100)}% alike`];
    const lineUom = normaliseUom(line.uom);
    const sameUnit = lineUom != null && convertPrice(1, e.unit, lineUom) != null;
    if (sameUnit) {
      score += 0.1;
      reasons.push(normaliseUom(e.unit) === lineUom ? `same unit (${lineUom})` : `unit converts ${e.unit}→${lineUom}`);
    }
    if (sameUnit && line.material_unit_cost != null && e.material_unit_cost != null && e.material_unit_cost > 0) {
      const cat = convertPrice(e.material_unit_cost, e.unit, lineUom);
      if (cat != null && Math.abs(line.material_unit_cost - cat) <= cat * PRICE_BONUS_BAND) {
        score += 0.1;
        reasons.push(`price within 25% ($${cat.toFixed(2)}/${lineUom})`);
      }
    }
    score = Math.min(1, score);
    if (score >= min) scored.push(toCandidate(e, score, reasons.join(", ")));
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Alias first (score 1), then fuzzy. AI ranking for weak results is done on the server (match.server.ts). */
export function matchLine(line: ImportedLine, catalogue: CatalogueEntry[], aliases: AliasRow[]): MatchResult {
  const norm = normaliseAlias(line.description);
  const hits = aliases.filter((a) => a.alias_norm === norm);
  if (hits.length) {
    const byId = new Map(catalogue.map((e) => [`${e.kind}:${e.id}`, e]));
    const exact = hits
      .map((a) => byId.get(a.catalogue_item_id ? `item:${a.catalogue_item_id}` : `assembly:${a.assembly_id}`))
      .filter((e): e is CatalogueEntry => !!e)
      .map((e) => toCandidate(e, 1, "confirmed before (saved alias)"));
    if (exact.length) {
      const rest = fuzzyCandidates(line, catalogue).filter((c) => !exact.some((x) => x.name === c.name && x.uom === c.uom));
      return { status: "exact_alias", candidates: [...exact, ...rest].slice(0, MAX_CANDIDATES) };
    }
  }
  const candidates = fuzzyCandidates(line, catalogue);
  return { status: candidates.length ? "fuzzy" : "none", candidates };
}

export type CostDelta = { imported: number; catalogue: number; delta: number; pct: number };

/** Display the real price, and its equivalent in the imported line's unit. Labour-only candidates remain priced. */
export function candidateLabel(candidate: Pick<Candidate, "name" | "uom" | "material_unit_cost" | "labour_unit_cost">, lineUnit: string | null): string {
  const price = candidate.material_unit_cost ?? candidate.labour_unit_cost;
  if (price == null) return `${candidate.name} · no price`;
  const from = normaliseUom(candidate.uom) ?? candidate.uom;
  const to = normaliseUom(lineUnit) ?? from;
  const converted = convertPrice(price, from, to);
  const original = `$${price.toFixed(2)}/${from}`;
  return `${candidate.name} · ${original}${converted != null && from !== to ? ` = $${converted.toFixed(2)}/${to}` : ""}${candidate.material_unit_cost == null ? " (labour)" : ""}`;
}
export type PriceDelta = { uom: string | null; material: CostDelta | null; labour: CostDelta | null; needs_verification: boolean };

/** Per-unit difference (imported − catalogue) in the imported line's unit. Flags > 15% off the catalogue price. */
export function priceDelta(line: ImportedLine, candidate: Pick<Candidate, "uom" | "material_unit_cost" | "labour_unit_cost">): PriceDelta {
  const uom = normaliseUom(line.uom) ?? normaliseUom(candidate.uom);
  const one = (imp: number | null, cat: number | null): CostDelta | null => {
    if (imp == null || cat == null) return null;
    const c = convertPrice(cat, candidate.uom, uom);
    if (c == null) return null;
    const delta = Math.round((imp - c) * 100) / 100;
    return { imported: imp, catalogue: Math.round(c * 100) / 100, delta, pct: c === 0 ? (imp === 0 ? 0 : 1) : delta / c };
  };
  const material = one(line.material_unit_cost, candidate.material_unit_cost);
  const labour = one(line.labour_unit_cost, candidate.labour_unit_cost);
  const off = (d: CostDelta | null) => d != null && Math.abs(d.delta) > Math.abs(d.catalogue) * VERIFY_BAND + 1e-9;
  return { uom, material, labour, needs_verification: off(material) || off(labour) };
}

// ---- AI ranking (prompt + parse; the call itself is in match.server.ts) ----
export const AI_MATCH_SYSTEM =
  "You match a line from a flooring contractor's imported estimate to products in its catalogue. Reply with JSON only: " +
  '{"matches":[{"id":"<candidate id>","reason":"<one short line>"}]} best first, at most 5, using only ids from the list. ' +
  "Return an empty list when none is the same product. Never invent prices.";

export function aiMatchPrompt(line: ImportedLine, candidates: Candidate[]): string {
  const rows = candidates.map((c) => `${c.catalogue_item_id ?? c.assembly_id} | ${c.name} | per ${c.uom}`).join("\n");
  return `Imported line: ${line.description}${line.detail ? ` — ${line.detail}` : ""} (unit ${line.uom ?? "?"})\nCandidates (id | name | unit):\n${rows}`;
}

export function parseAiMatch(text: string, candidates: Candidate[]): Candidate[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const list = (parsed as { matches?: { id?: unknown; reason?: unknown }[] }).matches;
  if (!Array.isArray(list)) return [];
  const byId = new Map(candidates.map((c) => [c.catalogue_item_id ?? c.assembly_id, c]));
  const out: Candidate[] = [];
  for (const x of list) {
    const c = byId.get(String(x?.id ?? ""));
    if (!c || out.includes(c)) continue;
    // Numbers stay the catalogue's; the AI only orders and explains.
    out.push({ ...c, reason: `AI: ${String(x.reason ?? "").slice(0, 160)}` });
  }
  return out.slice(0, MAX_CANDIDATES);
}

// ---- New product from an imported line ----
const GROUP_CATEGORY: Record<string, Category> = {
  carpet: "carpet_broadloom", wall_base: "wall_base", vinyl: "lvt", sheet_safety: "sheet_vinyl", rubber: "rubber",
  window_coverings: "window_coverings", tile: "floor_tile", stairs_transitions: "transitions",
};

/** Catalogue category guessed from the scope keyword groups, using the scope scanner's own matcher. */
export function guessCategory(text: string, keywords: ScopeKeyword[]): Category {
  const hits = findScopeHits(text, keywords);
  const group = new Map(keywords.map((k) => [k.id, k.group_key]));
  for (const h of hits.sort((a, b) => b.count - a.count)) {
    const c = GROUP_CATEGORY[group.get(h.keyword_id) ?? ""];
    if (c) return c;
  }
  return "other";
}
