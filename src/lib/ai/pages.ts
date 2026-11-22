/**
 * Choosing what to read from a long document. A full specification book or drawing set is far more than can be sent
 * at once, and the flooring sections are rarely at the front. Each page is scored for how much it has to do with
 * floor finishes, base, tile and window coverings, and the best-scoring pages are sent, in page order.
 */
const STRONG: RegExp[] = [
  /\b(room\s+)?finish(es)?\s+(schedule|legend|plan|key)\b/i,
  /\bfloor(ing)?\s+(finish|schedule|legend|pattern)\b/i,
  /\b09\s?6\d(\s?\d\d){0,2}\b/, // resilient, carpet and other flooring sections
  /\b09\s?3\d(\s?\d\d){0,2}\b/, // tiling sections
  /\b12\s?2\d(\s?\d\d){0,2}\b/, // window treatment sections
  /\b(resilient|carpet|carpeting|luxury vinyl|vinyl (tile|plank|sheet)|sheet vinyl|lvt|lvp|vct|linoleum|marmoleum|rubber (base|flooring|tile)|wall base|cove base|porcelain|ceramic tile|quarry tile|engineered (wood|hardwood)|hardwood flooring|laminate flooring|epoxy floor(ing)?|polished concrete|sealed concrete|walk-?off|entrance mat)\b/i,
  /\b(window (covering|treatment|shade|blind)s?|roller (shade|blind)s?|blackout|solar shade|drapery|draperies|venetian blinds?)\b/i,
];
const WEAK: RegExp[] = [/\bfloor(ing)?\b/i, /\btiles?\b/i, /\bbase\b/i, /\btransition (strip|s)\b/i, /\bunderlay(ment)?\b/i, /\bgrout\b/i, /\bshades?\b/i, /\bblinds?\b/i];
/** Finish tags as they appear on schedules and plans: CPT-1, LVT2, RB-1, PT-3, WC-1 and the like. */
const TAG = /\b(CPT|CT|LVT|LVP|VCT|SV|RF|RB|WB|VB|PT|CER|QT|WT|FT|TL|HW|EW|LAM|EP|SC|PC|WOM|EM|WC|RS|BL|F|FL)-?\d{1,2}[A-Z]?\b/g;

const count = (text: string, re: RegExp) => (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)) ?? []).length;

/** How much a page has to do with the finishes BMD supplies. Zero means nothing on it is relevant. */
export function pageScore(text: string): number {
  if (!text.trim()) return 0;
  let strong = 0;
  for (const re of STRONG) strong += Math.min(6, count(text, re));
  const tags = Math.min(20, count(text, TAG));
  let weak = 0;
  for (const re of WEAK) weak += Math.min(3, count(text, re));
  // Weak words alone ("base", "tile") turn up everywhere, so they only count beside something stronger or in numbers.
  if (strong === 0 && tags === 0) return weak >= 4 ? 1 : weak > 0 ? 0.5 : 0;
  return strong * 10 + tags * 3 + weak;
}

export type Selection = {
  /** The chosen text, each page headed "[page N]". */
  text: string;
  /** Page numbers read, in order. */
  pages: number[];
  total: number;
  /** Pages with something relevant on them. */
  relevant: number;
  /** Relevant pages that did not fit. */
  leftOut: number;
  /** True when anything with text was left unread or cut short. */
  cut: boolean;
};

export function selectPages(pageTexts: string[], budget: number): Selection {
  const pages = pageTexts.map((t, i) => ({ n: i + 1, text: t.trim(), score: pageScore(t) })).filter((p) => p.text);
  const block = (p: { n: number; text: string }) => `[page ${p.n}]\n${p.text}\n\n`;
  const all = pages.map(block).join("");
  const relevant = pages.filter((p) => p.score >= 1);
  if (all.length <= budget) return { text: all.trim(), pages: pages.map((p) => p.n), total: pageTexts.length, relevant: relevant.length, leftOut: 0, cut: false };

  // Too long to read whole: take the strongest pages first; with nothing relevant, fall back to the front of the document.
  const order = relevant.length ? [...relevant].sort((a, b) => b.score - a.score || a.n - b.n) : pages;
  const chosen: { n: number; text: string }[] = [];
  let used = 0;
  for (const p of order) {
    const size = block(p).length;
    if (used + size <= budget) {
      chosen.push(p);
      used += size;
    } else if (chosen.length === 0) {
      // One page bigger than the whole allowance: read as much of it as fits.
      const head = `[page ${p.n}]\n`;
      chosen.push({ n: p.n, text: p.text.slice(0, Math.max(0, budget - head.length - 2)) });
      used = budget;
      break;
    } else if (!relevant.length) break;
  }
  chosen.sort((a, b) => a.n - b.n);
  return {
    text: chosen.map(block).join("").trim().slice(0, budget),
    pages: chosen.map((p) => p.n),
    total: pageTexts.length,
    relevant: relevant.length,
    leftOut: relevant.length ? relevant.length - chosen.filter((c) => relevant.some((r) => r.n === c.n)).length : 0,
    cut: true,
  };
}

/** Page numbers as short ranges: 3, 7-9, 14. */
export function pageRanges(pages: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return out.join(", ");
}
