/**
 * Quotes: what the client is shown. The snapshot built here is the only thing the PDF and the client link read,
 * and it is assembled field by field from selling figures, so costs, markups, suppliers and notes cannot leak into it.
 */
import { priceEstimateLine } from "@/lib/estimating/assemble";
import { totals, type TaxCode, type Uom } from "@/lib/estimating/calc";
import type { EstVersion } from "@/lib/estimating/data";
import { includedIds, type ClientChoice, type Rates, type Selection } from "@/lib/estimating/worksheet";
import { brandingFrom, companyOf, DEFAULT_BRANDING, type Branding, type Company } from "./branding";

export type Presentation = "lump_sum" | "by_section" | "itemised";
export type QuoteKind = "quote" | "change_order";

/** What a quote shows the client. Each switch only hides or shows; the total never changes. */
export type QuoteDisplay = {
  /** Group the scope by section (floor, area) or by material (all the carpet together, all the tile together). */
  groupBy: "section" | "material";
  showLines: boolean;
  showQuantities: boolean;
  showUnitPrices: boolean;
  showLineAmounts: boolean;
  showGroupSubtotals: boolean;
};
export function displayFor(p: Presentation): QuoteDisplay {
  const all = p === "itemised";
  return { groupBy: "section", showLines: true, showQuantities: true, showUnitPrices: all, showLineAmounts: all, showGroupSubtotals: p !== "lump_sum" };
}
/** A saved display setting, with anything missing or malformed taken from the preset. */
export function normalizeDisplay(raw: Partial<Record<keyof QuoteDisplay, unknown>> | null | undefined, preset: Presentation): QuoteDisplay {
  const d = displayFor(preset);
  if (!raw || typeof raw !== "object") return d;
  const flag = (k: Exclude<keyof QuoteDisplay, "groupBy">) => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : d[k]);
  return { groupBy: raw.groupBy === "material" || raw.groupBy === "section" ? raw.groupBy : d.groupBy, showLines: flag("showLines"), showQuantities: flag("showQuantities"), showUnitPrices: flag("showUnitPrices"), showLineAmounts: flag("showLineAmounts"), showGroupSubtotals: flag("showGroupSubtotals") };
}

/** The company's details when nothing has been saved under Company settings → Quotes. Quotes read the saved details from their snapshot. */
export const BMD = {
  name: DEFAULT_BRANDING.companyName,
  mailing: DEFAULT_BRANDING.mailingAddress,
  email: DEFAULT_BRANDING.email,
};

/** The short terms under the price: validity and deposit come from the quote, the rest from Company settings → Quotes. */
export const standingTerms = (validityDays: number, deposit: string | null, shortTerms: string[] = DEFAULT_BRANDING.shortTerms) => [
  `This quotation is valid for ${validityDays} days from its date.`,
  deposit ? `Deposit: ${deposit}` : "No deposit is required unless stated above.",
  ...shortTerms,
];

export function quoteNumber(kind: QuoteKind, projectNumber: string | null, coNumber: number | null, revision: number): string {
  if (kind === "change_order") return revision === 0 ? `CO-${coNumber ?? 1}` : `CO-${coNumber ?? 1}-R${revision}`;
  return `Q-${projectNumber ?? "0"}-R${revision}`;
}

export type SnapLine = {
  id: string;
  description: string;
  qty: number;
  uom: Uom;
  unitPriceCents: number;
  /** False when quantity × unit price does not come back to the line amount to the cent; the unit price is then shown as approximate. */
  unitPriceExact: boolean;
  sellCents: number;
  taxCode: TaxCode;
  /** The kind of material, for grouping (e.g. "Carpet tile"). Null when the line is not tied to one. */
  material: string | null;
  selection: Selection;
  group: string | null;
  allowance: boolean;
  subjectToMeasure: boolean;
};
export type SnapVersion = {
  id: string;
  name: string;
  description: string | null;
  sections: { name: string; subtotalCents: number; lines: SnapLine[] }[];
  /** Committed figures: required lines plus the default member of each choose-one group. */
  subtotalCents: number;
  taxByCode: Record<string, number>;
  taxCents: number;
  totalCents: number;
};
export type QuoteSnapshot = {
  number: string;
  date: string;
  validityDays: number;
  presentation: Presentation;
  display: QuoteDisplay;
  preparedBy: { name: string; email: string };
  project: { name: string; number: string | null; address: string | null };
  client: { name: string; address: string | null };
  /** The company's own details as they stood when the quote was built. */
  company: Company;
  /** Who at the client the quote is addressed to. */
  attention: string | null;
  /** Notes written for the client on this quote, shown under the price. (Named apart from the estimate's internal notes, which never leave the office.) */
  remarks: string;
  /** Wording printed at the foot of every page. */
  footer: string;
  /** The standard terms and conditions, printed on their own page after the quote. Null when none are set up. */
  conditions: { title: string; text: string } | null;
  inclusions: string[];
  exclusions: string[];
  clarifications: string[];
  deposit: string | null;
  /** Names of the colour-coded drawing sheets sent with the quote. */
  drawings: string[];
  terms: string[];
  gstPct: number;
  hstPct: number;
  versions: SnapVersion[];
};

export type SnapshotInput = Omit<QuoteSnapshot, "versions" | "terms" | "gstPct" | "hstPct" | "display" | "drawings" | "company" | "attention" | "remarks" | "footer" | "conditions"> & { branding?: Branding; attention?: string | null; remarks?: string | null; drawings?: string[]; versions: EstVersion[]; rates: Rates; display?: QuoteDisplay; materialOf?: Record<string, string> };

export function buildSnapshot(input: SnapshotInput): QuoteSnapshot {
  const { versions, rates, ...head } = input;
  const brand = head.branding ?? brandingFrom(null);
  return {
    number: head.number,
    date: head.date,
    validityDays: head.validityDays,
    presentation: head.presentation,
    display: normalizeDisplay(head.display, head.presentation),
    preparedBy: { name: head.preparedBy.name, email: head.preparedBy.email },
    project: { name: head.project.name, number: head.project.number, address: head.project.address },
    client: { name: head.client.name, address: head.client.address },
    company: companyOf(brand),
    attention: head.attention?.trim() || null,
    remarks: head.remarks?.trim() ?? "",
    footer: brand.footer,
    conditions: brand.termsText ? { title: brand.termsTitle, text: brand.termsText } : null,
    inclusions: [...head.inclusions],
    exclusions: [...head.exclusions],
    clarifications: [...head.clarifications],
    deposit: head.deposit,
    drawings: [...(head.drawings ?? [])],
    terms: standingTerms(head.validityDays, head.deposit, brand.shortTerms),
    gstPct: rates.gstPct,
    hstPct: rates.hstPct,
    versions: versions.map((v) => {
      const sections: SnapVersion["sections"] = [];
      for (const l of v.lines) {
        const sell = priceEstimateLine(l, l.components, rates).sellCents;
        let s = sections.find((x) => x.name === l.section);
        if (!s) sections.push((s = { name: l.section, subtotalCents: 0, lines: [] }));
        s.lines.push({
          id: l.id,
          description: l.description,
          qty: l.driver_qty,
          uom: l.driver_uom,
          unitPriceCents: l.driver_qty > 0 ? Math.round(sell / l.driver_qty) : sell,
          unitPriceExact: l.driver_qty > 0 ? Math.round(Math.round(sell / l.driver_qty) * l.driver_qty) === sell : true,
          sellCents: sell,
          taxCode: l.tax_code,
          material: head.materialOf?.[l.id] ?? null,
          selection: l.selection,
          group: l.selection_group,
          allowance: l.is_allowance,
          subjectToMeasure: l.subject_to_measure,
        });
      }
      const sv: SnapVersion = { id: v.id, name: v.name, description: v.description, sections, subtotalCents: 0, taxByCode: {}, taxCents: 0, totalCents: 0 };
      const t = snapshotTotals(sv, {}, rates);
      for (const s of sections) s.subtotalCents = t.sectionCents[s.name] ?? 0;
      return { ...sv, subtotalCents: t.subtotalCents, taxByCode: t.taxByCode, taxCents: t.taxCents, totalCents: t.totalCents };
    }),
  };
}

/** Totals for one price in a snapshot given the client's choices. Used by the PDF, the client page and the server check. */
export function snapshotTotals(v: SnapVersion, choices: Record<string, ClientChoice>, rates: { gstPct: number; hstPct: number }) {
  const lines = v.sections.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.name })));
  const included = includedIds(lines.map((l) => ({ id: l.id, selection: l.selection, selection_group: l.group }) as never), choices);
  const t = totals(lines.filter((l) => included.has(l.id)).map((l) => ({ sellCents: l.sellCents, taxCode: l.taxCode, costCode: "", section: l.section })), rates);
  return {
    subtotalCents: t.subtotalCents,
    taxByCode: t.taxByCode,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
    sectionCents: t.bySection,
    maybeCents: lines.filter((l) => l.selection === "optional" && choices[l.id] === "maybe").reduce((s, l) => s + l.sellCents, 0),
    included,
  };
}

/** Names every line that still has a cost neither entered nor marked not needed. A quote cannot be issued while any remain. */
export function unknownCostLabels(versions: EstVersion[], rates: Rates): string[] {
  const out: string[] = [];
  for (const v of versions) {
    for (const l of v.lines) {
      if (l.price_basis === "margin" && l.margin_pct == null) {
        out.push(`${v.name}: ${l.description} (no margin set)`);
        continue;
      }
      if (l.price_basis === "fixed_sell" && l.fixed_sell_cents == null) {
        out.push(`${v.name}: ${l.description} (no selling price set)`);
        continue;
      }
      const p = priceEstimateLine(l, l.components, rates);
      if (p.error) out.push(`${v.name}: ${l.description} (${p.error})`);
      else if (p.unknown) out.push(`${v.name}: ${l.description} (${p.unknownLabels.join(", ")})`);
    }
  }
  return out;
}

/** The QuickBooks roll-up for one price: each line whole under its own cost code, markup included. Internal; never part of a snapshot. */
export function rollupByCostCode(version: EstVersion, rates: Rates) {
  const included = includedIds(version.lines);
  const merged = new Map<string, { costCode: string; amountCents: number; taxCode: TaxCode }>();
  const forTotals = [];
  for (const l of version.lines) {
    if (!included.has(l.id)) continue;
    const sell = priceEstimateLine(l, l.components, rates).sellCents;
    const costCode = l.cost_code ?? "";
    const key = `${costCode}|${l.tax_code}`;
    const row = merged.get(key) ?? { costCode, amountCents: 0, taxCode: l.tax_code };
    row.amountCents += sell;
    merged.set(key, row);
    forTotals.push({ sellCents: sell, taxCode: l.tax_code, costCode, section: l.section });
  }
  const t = totals(forTotals, rates);
  return { lines: [...merged.values()], subtotalCents: t.subtotalCents, taxCents: t.taxCents, totalCents: t.totalCents };
}

type QuoteForValue = { kind: QuoteKind; status: string; accepted_value_cents: number | null; number: string; value_cents?: number | null };

/** Original contract + accepted change orders = current contract. Sent-but-unanswered change orders are shown as pending. */
export function contractValue(quotes: QuoteForValue[]) {
  const accepted = quotes.filter((q) => q.status === "accepted");
  const originalCents = accepted.filter((q) => q.kind === "quote").reduce((s, q) => s + (q.accepted_value_cents ?? 0), 0);
  const changeOrdersCents = accepted.filter((q) => q.kind === "change_order").reduce((s, q) => s + (q.accepted_value_cents ?? 0), 0);
  const pendingCents = quotes.filter((q) => q.kind === "change_order" && q.status === "sent").reduce((s, q) => s + (q.value_cents ?? 0), 0);
  return { originalCents, changeOrdersCents, currentCents: originalCents + changeOrdersCents, pendingCents };
}

export type MailResult = { ok: true } | { ok: false; reason: "reconnect" | "error"; message: string };
export type IssueDeps = {
  /** Returns a reason the quote cannot be issued, or null. */
  check: (quoteId: string) => Promise<string | null>;
  sendMail: (email: { to: string[]; cc: string[]; subject: string; html: string }, attachment: { name: string; bytes: Uint8Array }) => Promise<MailResult>;
  /** Stores the PDF under Quotes sent and returns the document id. */
  fileDocument: (quoteId: string, fileName: string, pdf: Uint8Array) => Promise<string>;
  /** Marks the quote sent, freezes the snapshot, locks its prices and moves the project to Quote out. */
  issue: (quoteId: string, snapshot: QuoteSnapshot, recipients: string[], documentId: string) => Promise<void>;
};
export type IssueInput = { quoteId: string; pdf: Uint8Array; fileName: string; snapshot: QuoteSnapshot; email: { to: string[]; cc: string[]; subject: string; html: string } | null };

/** Nothing is filed or marked until the email has gone. A failed send leaves the quote exactly as it was. */
export async function issueQuoteFlow(deps: IssueDeps, input: IssueInput): Promise<{ ok: true; documentId: string } | { ok: false; reason: "reconnect" | "error"; message: string }> {
  const blocked = await deps.check(input.quoteId);
  if (blocked) return { ok: false, reason: "error", message: blocked };
  if (input.email) {
    const sent = await deps.sendMail(input.email, { name: input.fileName, bytes: input.pdf });
    if (!sent.ok) return sent;
  }
  try {
    const documentId = await deps.fileDocument(input.quoteId, input.fileName, input.pdf);
    await deps.issue(input.quoteId, input.snapshot, input.email ? [...input.email.to, ...input.email.cc] : [], documentId);
    return { ok: true, documentId };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "error",
      message: input.email ? `The email was sent, but the quote could not be marked as sent (${why}). Do not send it again; use Mark as sent.` : `The quote could not be saved: ${why}`,
    };
  }
}

export const money = (cents: number) => (cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


export type LayoutLine = { line: SnapLine; text: string; amountCents: number | null; note: string | null };
export type LayoutGroup = { name: string; quantity: string | null; subtotalCents: number | null; lines: LayoutLine[] };
const OTHER = "Other items";
const qtyText = (n: number, uom: string) => `${n.toLocaleString("en-CA", { maximumFractionDigits: 2 })} ${uom}`;

/**
 * One price laid out the way the quote's display settings ask. The PDF and the client page both draw from this,
 * so they always agree. Optional and choose-one lines always appear with their own price: the client has to decide on them.
 */
export function layoutVersion(v: SnapVersion, display: QuoteDisplay, included: Set<string> = snapshotTotals(v, {}, { gstPct: 0, hstPct: 0 }).included): LayoutGroup[] {
  const groups = new Map<string, { lines: SnapLine[] }>();
  for (const s of v.sections) {
    for (const l of s.lines) {
      const key = display.groupBy === "material" ? (l.material ?? OTHER) : s.name;
      if (!groups.has(key)) groups.set(key, { lines: [] });
      groups.get(key)!.lines.push(l);
    }
  }
  const names = [...groups.keys()].sort((a, b) => (display.groupBy === "material" ? Number(a === OTHER) - Number(b === OTHER) : 0));
  return names.map((name) => {
    const all = groups.get(name)!.lines;
    const counted = all.filter((l) => included.has(l.id));
    const measured = counted.filter((l) => l.uom !== "LS");
    const sameUnit = measured.length > 0 && measured.length === counted.length && measured.every((l) => l.uom === measured[0]!.uom);
    return {
      name,
      quantity: display.groupBy === "material" && display.showQuantities && sameUnit ? qtyText(measured.reduce((n, l) => n + l.qty, 0), measured[0]!.uom) : null,
      subtotalCents: display.showGroupSubtotals ? counted.reduce((n, l) => n + l.sellCents, 0) : null,
      lines: all
        .filter((l) => display.showLines || l.selection !== "required")
        .map((l) => {
          const measuredLine = l.uom !== "LS";
          const qty = display.showQuantities && measuredLine ? ` · ${qtyText(l.qty, l.uom)}` : "";
          const unit = display.showUnitPrices && measuredLine ? (l.unitPriceExact === false ? ` about $${money(l.unitPriceCents)} per ${l.uom}` : ` @ $${money(l.unitPriceCents)}`) : "";
          const flags = [l.selection === "optional" ? "optional, not in the total" : null, l.selection === "choose_one" ? `choose one${l.group ? ` (${l.group})` : ""}` : null, l.allowance ? "allowance" : null, l.subjectToMeasure ? "subject to final measure" : null].filter(Boolean);
          return { line: l, text: `${l.description}${qty}${unit}`, amountCents: display.showLineAmounts || l.selection !== "required" ? l.sellCents : null, note: flags.length ? flags.join("; ") : null };
        }),
    };
  });
}
