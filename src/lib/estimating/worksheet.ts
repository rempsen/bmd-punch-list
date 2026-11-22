import { normaliseUom } from "@/lib/catalogue/logic";
import { priceEstimateLine, type LineInput, type PricedEstimateLine, type SnapComponent } from "./assemble";
import { totals, type Totals, type Uom } from "./calc";

export type Selection = "required" | "optional" | "choose_one";
export type ClientChoice = "yes" | "no" | "maybe";
export type WsLine = LineInput & {
  id: string;
  section: string;
  cost_code: string | null;
  description: string;
  selection: Selection;
  selection_group: string | null;
  components: SnapComponent[];
};
export type Rates = { pstPct: number; gstPct: number; hstPct: number };

export type VersionSummary = {
  costCents: number;
  sellCents: number;
  marginPct: number;
  unknownLines: number;
  /** Value of optional lines answered "maybe": shown apart, never in the committed total. */
  maybeCents: number;
  totals: Totals;
  sections: { section: string; costCents: number; sellCents: number }[];
  priced: Record<string, PricedEstimateLine & { included: boolean }>;
};

/**
 * Which lines count toward the total. Required lines always do. An optional line counts only on "yes".
 * In a choose-one group exactly one member counts: the one answered "yes", otherwise the first.
 */
export function includedIds(lines: WsLine[], choices: Record<string, ClientChoice> = {}): Set<string> {
  const out = new Set<string>();
  const groups = new Map<string, WsLine[]>();
  for (const l of lines) {
    if (l.selection === "required") out.add(l.id);
    else if (l.selection === "optional") {
      if (choices[l.id] === "yes") out.add(l.id);
    } else groups.set(l.selection_group ?? l.id, [...(groups.get(l.selection_group ?? l.id) ?? []), l]);
  }
  for (const members of groups.values()) out.add((members.find((m) => choices[m.id] === "yes") ?? members[0]!).id);
  return out;
}

export function versionSummary(lines: WsLine[], rates: Rates, choices: Record<string, ClientChoice> = {}): VersionSummary {
  const included = includedIds(lines, choices);
  const priced: VersionSummary["priced"] = {};
  const sections: VersionSummary["sections"] = [];
  let costCents = 0;
  let unknownLines = 0;
  let maybeCents = 0;
  const forTotals = [];
  for (const l of lines) {
    const p = priceEstimateLine(l, l.components, rates);
    const inc = included.has(l.id);
    priced[l.id] = { ...p, included: inc };
    if (l.selection === "optional" && choices[l.id] === "maybe") maybeCents += p.sellCents;
    if (!inc) continue;
    if (p.unknown || p.error) unknownLines += 1;
    costCents += p.costCents;
    forTotals.push({ sellCents: p.sellCents, taxCode: l.tax_code, costCode: l.cost_code ?? "", section: l.section });
    let s = sections.find((x) => x.section === l.section);
    if (!s) sections.push((s = { section: l.section, costCents: 0, sellCents: 0 }));
    s.costCents += p.costCents;
    s.sellCents += p.sellCents;
  }
  const t = totals(forTotals, rates);
  return {
    costCents,
    sellCents: t.subtotalCents,
    marginPct: t.subtotalCents === 0 ? 0 : Math.round(((t.subtotalCents - costCents) / t.subtotalCents) * 10000) / 100,
    unknownLines,
    maybeCents,
    totals: t,
    sections,
    priced,
  };
}

export type PastedRow = { tag: string; qty: number; uom: Uom | null; section: string | null };

/** Quantities pasted from Excel or typed as CSV: tag, quantity, then optionally unit and section. */
export function parsePastedQuantities(text: string): { rows: PastedRow[]; problems: string[] } {
  const rows: PastedRow[] = [];
  const problems: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  let n = 0;
  for (const raw of lines) {
    const cells = (raw.includes("\t") ? raw.split("\t") : raw.split(",")).map((c) => c.trim());
    const [tag, q, u, section] = cells;
    if (!tag) continue;
    if (n === 0 && rows.length === 0 && /^(tag|finish|code|item)$/i.test(tag)) continue; // header row
    n += 1;
    const qty = Number((q ?? "").replace(/,/g, ""));
    if (!q || !Number.isFinite(qty) || qty < 0) {
      problems.push(`Row ${n}: "${q ?? ""}" is not a quantity.`);
      continue;
    }
    rows.push({ tag, qty, uom: normaliseUom(u), section: section || null });
  }
  return { rows, problems };
}
