/**
 * The QuickBooks estimate for a quote: one line per cost code, each carrying its whole selling amount.
 * It is built from the roll-up saved when the quote was sent, and must add up to that quote to the cent.
 * Nothing here posts on its own: a person previews the lines and presses Post.
 */
import type { TaxCode } from "@/lib/estimating/calc";
import { money } from "@/lib/quotes/logic";

export type Rollup = { versionId: string; lines: { costCode: string; amountCents: number; taxCode: TaxCode }[]; subtotalCents: number; taxCents: number; totalCents: number };
export type CostCodeRef = { code: string; name: string; qbo_item_id: string | null };
export type QboEstimate = { customerRef: string; docNumber: string; lines: { itemId: string; costCode: string; description: string; amountCents: number; taxCode: TaxCode }[]; subtotalCents: number; expectedTotalCents: number };

export function buildQboEstimate(a: { number: string; projectName: string; customerQboId: string | null; rollup: Rollup; version: { id: string; subtotalCents: number; totalCents: number }; costCodes: CostCodeRef[] }): { ok: true; estimate: QboEstimate } | { ok: false; message: string } {
  if (!a.customerQboId) return { ok: false, message: "This client is not linked to a QuickBooks customer." };
  const byCode = new Map(a.costCodes.map((c) => [c.code, c]));
  const unlinked = a.rollup.lines.filter((l) => !byCode.get(l.costCode)?.qbo_item_id).map((l) => l.costCode || "(no cost code)");
  if (unlinked.length) return { ok: false, message: `These cost codes are not linked to a QuickBooks item: ${[...new Set(unlinked)].join(", ")}.` };
  const sum = a.rollup.lines.reduce((s, l) => s + l.amountCents, 0);
  if (sum !== a.version.subtotalCents) return { ok: false, message: `The QuickBooks lines add up to $${money(sum)} but the quote is $${money(a.version.subtotalCents)}. Nothing was posted.` };
  if (a.rollup.totalCents !== a.version.totalCents) return { ok: false, message: `The QuickBooks total would be $${money(a.rollup.totalCents)} but the quote total is $${money(a.version.totalCents)}. Nothing was posted.` };
  return {
    ok: true,
    estimate: {
      customerRef: a.customerQboId,
      docNumber: a.number,
      lines: a.rollup.lines.map((l) => ({ itemId: byCode.get(l.costCode)!.qbo_item_id!, costCode: l.costCode, description: byCode.get(l.costCode)!.name, amountCents: l.amountCents, taxCode: l.taxCode })),
      subtotalCents: sum,
      expectedTotalCents: a.version.totalCents,
    },
  };
}

export type PostDeps = {
  /** The QuickBooks estimate already recorded against this quote, if any. */
  storedId: (quoteId: string) => Promise<string | null>;
  create: (estimate: QboEstimate) => Promise<string>;
  store: (quoteId: string, qboEstimateId: string) => Promise<void>;
};

/** Posting twice never makes two estimates: a quote that already has one returns it. */
export async function postEstimateFlow(deps: PostDeps, quoteId: string, estimate: QboEstimate): Promise<{ ok: true; qboEstimateId: string; created: boolean } | { ok: false; message: string }> {
  const existing = await deps.storedId(quoteId);
  if (existing) return { ok: true, qboEstimateId: existing, created: false };
  let id: string;
  try {
    id = await deps.create(estimate);
  } catch (e) {
    return { ok: false, message: `QuickBooks did not accept the estimate: ${e instanceof Error ? e.message : String(e)}` };
  }
  await deps.store(quoteId, id);
  return { ok: true, qboEstimateId: id, created: true };
}
