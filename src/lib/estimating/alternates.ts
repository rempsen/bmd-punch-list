import type { Template } from "@/lib/catalogue/data";
import type { CatalogueView } from "./assemble";
import type { EstLine, EstVersion, Finish, SaveItem } from "./data";
import { lineFromFinish } from "./lines";
import { versionSummary, type Rates } from "./worksheet";

/**
 * "Swap finish": replace the finish behind a set of lines, across the whole price or only in chosen sections.
 * Quantity, markup and section stay; the assembly is rebuilt from the new finish at today's catalogue prices.
 * Lines carrying a hand-entered cost or a hand-set selling price are reported and left as they are.
 */
export function planSwap(a: { lines: EstLine[]; fromFinishId: string; to: Finish; template: Template; catalogue: CatalogueView; sections?: string[] | undefined }) {
  const items: SaveItem[] = [];
  const overrideKept: { id: string; description: string; section: string }[] = [];
  let untouched = 0;
  for (const l of a.lines) {
    if (l.finish_id !== a.fromFinishId) continue;
    if (a.sections && !a.sections.includes(l.section)) {
      untouched += 1;
      continue;
    }
    if (l.price_basis === "fixed_sell" || l.components.some((c) => c.cost_overridden)) {
      overrideKept.push({ id: l.id, description: l.description, section: l.section });
      continue;
    }
    const built = lineFromFinish({ versionId: l.version_id, finish: a.to, template: a.template, catalogue: a.catalogue, qty: l.driver_qty, section: l.section, markupPct: l.markup_pct }).item;
    items.push({
      id: l.id,
      row_version: l.row_version,
      line: { finish_id: a.to.id, description: built.line.description!, waste_pct: built.line.waste_pct!, cost_code: built.line.cost_code ?? null, driver_uom: built.line.driver_uom! },
      components: built.components!,
    });
  }
  return { items, overrideKept, untouched };
}

export type Comparison = {
  versions: { id: string; name: string }[];
  /** One row per section, in Base order then any sections only alternates have. Arrays line up with `versions`. */
  rows: { section: string; sellCents: number[]; deltaCents: number[]; changed: boolean[] }[];
  totals: { id: string; name: string; subtotalCents: number; taxCents: number; totalCents: number; deltaCents: number }[];
};

/** Base and alternates side by side by section, with each difference from the first (Base) price. */
export function compareVersions(versions: EstVersion[], rates: Rates): Comparison {
  const sums = versions.map((v) => versionSummary(v.lines, rates));
  const sections: string[] = [];
  for (const s of sums) for (const x of s.sections) if (!sections.includes(x.section)) sections.push(x.section);
  const rows = sections.map((section) => {
    const sellCents = sums.map((s) => s.sections.find((x) => x.section === section)?.sellCents ?? 0);
    const deltaCents = sellCents.map((c) => c - sellCents[0]!);
    return { section, sellCents, deltaCents, changed: deltaCents.map((d) => d !== 0) };
  });
  const totals = versions.map((v, i) => ({
    id: v.id,
    name: v.name,
    subtotalCents: sums[i]!.totals.subtotalCents,
    taxCents: sums[i]!.totals.taxCents,
    totalCents: sums[i]!.totals.totalCents,
    deltaCents: sums[i]!.totals.totalCents - sums[0]!.totals.totalCents,
  }));
  return { versions: versions.map((v) => ({ id: v.id, name: v.name })), rows, totals };
}
