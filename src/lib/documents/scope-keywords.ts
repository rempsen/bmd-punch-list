/**
 * Scope keyword detection: finds BMD's scope terms (carpet, LVP, wall base…) in the page text of plans and specifications.
 * Pure: no database, no network. The server runs it when a document's text is stored (see scope.server.ts).
 */
export type ScopeKeyword = { id: string; term: string; group_key: string; whole_word: boolean; active?: boolean; sort?: number };
export type ScopeHit = { keyword_id: string; page: number | null; snippet: string; count: number };

export const SCOPE_GROUPS: { key: string; label: string }[] = [
  { key: "carpet", label: "Carpet" },
  { key: "wall_base", label: "Wall base" },
  { key: "vinyl", label: "Vinyl (LVT / LVP)" },
  { key: "sheet_safety", label: "Sheet vinyl & safety floor" },
  { key: "rubber", label: "Rubber" },
  { key: "window_coverings", label: "Window coverings" },
  { key: "tile", label: "Tile" },
  { key: "kitchen_entrance", label: "Kitchen & entrance" },
  { key: "laminate", label: "Laminate" },
  { key: "stairs_transitions", label: "Stairs & transitions" },
  { key: "wet_areas", label: "Wet areas" },
  { key: "other", label: "Other" },
];
export const scopeGroupLabel = (key: string) => SCOPE_GROUPS.find((g) => g.key === key)?.label ?? key;

/** One word in its plain form: lower case, plural "s"/"es" removed ("backsplashes" → "backsplash", "nosings" → "nosing"). */
export function stemWord(w: string): string {
  const s = w.toLowerCase();
  if (s.length > 4 && /(sh|ch|x|ss)es$/.test(s)) return s.slice(0, -2);
  if (s.length > 2 && s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
  return s;
}

/** The words of a term or text, split on anything that is not a letter or digit (so hyphens and spaces are the same). */
export function words(text: string): { w: string; start: number; end: number }[] {
  const out: { w: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ w: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** A term with hyphens and spaces collapsed and each word in its plain form: "Loose-lay planks" → "looselayplank". */
export function normaliseTerm(term: string): string {
  return words(term).map((x) => stemWord(x.w)).join("");
}

/** Endings a non-whole-word term may carry on its last word ("tile" matches "tiles", "tiled", "tiling" is not covered). */
const ENDINGS = new Set(["", "s", "es", "d", "ed", "ing", "ings"]);

type Match = { kw: ScopeKeyword; start: number; end: number; page: number | null };

function matchesIn(text: string, page: number | null, kws: { kw: ScopeKeyword; key: string; parts: string[] }[]): Match[] {
  const toks = words(text);
  const out: Match[] = [];
  for (let i = 0; i < toks.length; i++) {
    const first = toks[i]!.w[0];
    for (const k of kws) {
      if (!k.key || k.key[0] !== first) continue;
      if (k.kw.whole_word) {
        // Exactly these words, each allowed a plural: "LVT", "LVTs", "CT-1" — never inside another word.
        if (i + k.parts.length > toks.length) continue;
        let ok = true;
        for (let j = 0; j < k.parts.length; j++) if (stemWord(toks[i + j]!.w) !== k.parts[j]) ok = false;
        if (ok) out.push({ kw: k.kw, start: toks[i]!.start, end: toks[i + k.parts.length - 1]!.end, page });
        continue;
      }
      // Collapsed: words joined without separators, so "loose lay", "loose-lay" and "looselay" are the same.
      let acc = "";
      for (let j = i; j < toks.length && acc.length < k.key.length; j++) {
        const before = acc;
        acc += toks[j]!.w;
        if (acc.length >= k.key.length) {
          if (acc.startsWith(k.key) && ENDINGS.has(acc.slice(k.key.length))) out.push({ kw: k.kw, start: toks[i]!.start, end: toks[j]!.end, page });
          else if (before + stemWord(toks[j]!.w) === k.key) out.push({ kw: k.kw, start: toks[i]!.start, end: toks[j]!.end, page });
        }
      }
    }
  }
  return out;
}

/** About 200 characters of text around a match, on one line. */
export function snippetAround(text: string, start: number, end: number, max = 200): string {
  const room = Math.max(0, max - (end - start) - 2);
  let a = Math.max(0, start - Math.floor(room / 2));
  const b = Math.min(text.length, a + (end - start) + room);
  a = Math.max(0, Math.min(a, b - (end - start) - room));
  let s = text.slice(a, b).replace(/\s+/g, " ").trim();
  if (a > 0) s = `…${s}`;
  if (b < text.length) s = `${s}…`;
  return s.slice(0, max);
}

/**
 * Every active keyword found in the text, one hit per keyword per page with the count and a snippet of the first match.
 * `text` is one string (page unknown) or the pages in order (page numbers from 1). A match that sits inside a longer
 * keyword's match is not counted for the shorter one: "carpet tile" counts as carpet tile, not also as carpet and tile.
 */
export function findScopeHits(text: string | string[], keywords: ScopeKeyword[]): ScopeHit[] {
  const kws = keywords.filter((k) => k.active !== false).map((kw) => ({ kw, key: normaliseTerm(kw.term), parts: words(kw.term).map((x) => stemWord(x.w)) })).filter((k) => k.key);
  const pages = Array.isArray(text) ? text.map((t, i) => ({ t, page: i + 1 as number | null })) : [{ t: text, page: null as number | null }];
  const hits = new Map<string, ScopeHit>();
  for (const { t, page } of pages) {
    if (!t) continue;
    const all = matchesIn(t, page, kws).sort((x, y) => y.end - y.start - (x.end - x.start) || x.start - y.start);
    const kept: Match[] = [];
    for (const m of all) if (!kept.some((k) => k.start <= m.start && k.end >= m.end && k.kw.id !== m.kw.id)) if (!kept.some((k) => k.kw.id === m.kw.id && k.start === m.start)) kept.push(m);
    kept.sort((x, y) => x.start - y.start);
    for (const m of kept) {
      const key = `${m.kw.id}|${page}`;
      const h = hits.get(key);
      if (h) h.count += 1;
      else hits.set(key, { keyword_id: m.kw.id, page, snippet: snippetAround(t, m.start, m.end), count: 1 });
    }
  }
  return [...hits.values()];
}

/** Whether a document is searched for scope: Plans and Specifications, and Other when the file name says spec or drawing. */
export function scansForScope(section: string, fileName: string): boolean {
  if (section === "plans" || section === "specifications") return true;
  return section === "other" && /spec|drawing/i.test(fileName);
}

/** The terms as a short system block for any AI that reads plans or specifications. Empty when there are no terms. */
export function scopeTermsBlock(terms: string[]): string {
  const list = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  if (!list.length) return "";
  return `BMD Materials' scope terms — flag any of these and close variants found in plans or specifications, with page references: ${list.join(", ")}.`;
}

/** A one-line "Scope found: carpet, LVP, wall base…" from hit terms, most frequent first. */
export function scopeSummary(terms: string[], max = 6): string {
  const n = new Map<string, number>();
  for (const t of terms) n.set(t, (n.get(t) ?? 0) + 1);
  const list = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return list.length ? `Scope found: ${list.slice(0, max).join(", ")}${list.length > max ? "…" : ""}` : "";
}
