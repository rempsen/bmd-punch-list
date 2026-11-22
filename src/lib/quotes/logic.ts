/**
 * Quotes: what the client is shown. The snapshot built here is the only thing the PDF and the client link read,
 * and it is assembled field by field from selling figures, so costs, markups, suppliers and notes cannot leak into it.
 */
import { priceEstimateLine } from "@/lib/estimating/assemble";
import { totals, type TaxCode, type Uom } from "@/lib/estimating/calc";
import type { EstVersion } from "@/lib/estimating/data";
import { includedIds, type ClientChoice, type Rates, type Selection } from "@/lib/estimating/worksheet";

export type Presentation = "lump_sum" | "by_section" | "itemised";
export type QuoteKind = "quote" | "change_order";

export const BMD = {
  name: "BMD Materials",
  mailing: "PO Box 69031, Winnipeg RPO Tuxedo Park, MB R3P 2G9",
  email: "office@bmdmaterials.com",
};

export const standingTerms = (validityDays: number, deposit: string | null) => [
  `This quotation is valid for ${validityDays} days from its date.`,
  deposit ? `Deposit: ${deposit}` : "No deposit is required unless stated above.",
  "Overdue accounts are charged interest at 2% per month.",
  "Workmanship is warranted for one year from completion. Materials carry their manufacturer's warranty.",
  "Prices are in Canadian dollars. GST is shown separately.",
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
  sellCents: number;
  taxCode: TaxCode;
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
  preparedBy: { name: string; email: string };
  project: { name: string; number: string | null; address: string | null };
  client: { name: string; address: string | null };
  inclusions: string[];
  exclusions: string[];
  clarifications: string[];
  deposit: string | null;
  terms: string[];
  gstPct: number;
  hstPct: number;
  versions: SnapVersion[];
};

export type SnapshotInput = Omit<QuoteSnapshot, "versions" | "terms" | "gstPct" | "hstPct"> & { versions: EstVersion[]; rates: Rates };

export function buildSnapshot(input: SnapshotInput): QuoteSnapshot {
  const { versions, rates, ...head } = input;
  return {
    number: head.number,
    date: head.date,
    validityDays: head.validityDays,
    presentation: head.presentation,
    preparedBy: { name: head.preparedBy.name, email: head.preparedBy.email },
    project: { name: head.project.name, number: head.project.number, address: head.project.address },
    client: { name: head.client.name, address: head.client.address },
    inclusions: [...head.inclusions],
    exclusions: [...head.exclusions],
    clarifications: [...head.clarifications],
    deposit: head.deposit,
    terms: standingTerms(head.validityDays, head.deposit),
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
          sellCents: sell,
          taxCode: l.tax_code,
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
