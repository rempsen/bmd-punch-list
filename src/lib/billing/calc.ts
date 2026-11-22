/**
 * Progress billing. Each bill is an amount of the contract (before GST); 7.5% of it is held back and
 * billed later on its own release invoice. GST is charged on what is actually billed.
 */
import { money } from "@/lib/quotes/logic";

export type BillKind = "progress" | "holdback_release";
export type BillTotals = { grossCents: number; holdbackCents: number; netCents: number; gstCents: number; totalCents: number };

export function billTotals(grossCents: number, holdbackPct: number, gstPct: number): BillTotals {
  const holdbackCents = Math.round((grossCents * holdbackPct) / 100);
  const netCents = grossCents - holdbackCents;
  const gstCents = Math.round((netCents * gstPct) / 100);
  return { grossCents, holdbackCents, netCents, gstCents, totalCents: netCents + gstCents };
}
export const releaseTotals = (retainedCents: number, gstPct: number): BillTotals => billTotals(retainedCents, 0, gstPct);

type BillLike = { kind: BillKind; status: "draft" | "issued" | "void"; gross_cents: number; holdback_cents: number };
export type Position = { contractCents: number; billedCents: number; remainingCents: number; heldCents: number; releasedCents: number; holdbackOwingCents: number };

/** Counts every bill that has not been voided, drafts included, so two drafts cannot together overbill. */
export function billingPosition(contractCents: number, bills: BillLike[]): Position {
  const live = bills.filter((b) => b.status !== "void");
  const progress = live.filter((b) => b.kind === "progress");
  const billedCents = progress.reduce((s, b) => s + b.gross_cents, 0);
  const heldCents = progress.reduce((s, b) => s + b.holdback_cents, 0);
  const releasedCents = live.filter((b) => b.kind === "holdback_release").reduce((s, b) => s + b.gross_cents, 0);
  return { contractCents, billedCents, remainingCents: contractCents - billedCents, heldCents, releasedCents, holdbackOwingCents: heldCents - releasedCents };
}

/** Why a new bill of this size is not allowed, or null when it is. */
export function checkNewBill(pos: Position, kind: BillKind, grossCents: number): string | null {
  if (!(grossCents > 0)) return "Enter an amount to bill.";
  if (kind === "holdback_release") return grossCents > pos.holdbackOwingCents ? `Only $${money(Math.max(0, pos.holdbackOwingCents))} of holdback is being held.` : null;
  if (pos.contractCents <= 0) return "There is no accepted quote yet, so there is nothing to bill against.";
  if (grossCents > pos.remainingCents) return `That would bill $${money(pos.billedCents + grossCents)} against a contract of $${money(pos.contractCents)}. Add a change order first, or bill $${money(Math.max(0, pos.remainingCents))} or less.`;
  return null;
}

export const billNumber = (projectNumber: string | null, n: number) => `${projectNumber ? `${projectNumber}-` : ""}B${String(n).padStart(2, "0")}`;
