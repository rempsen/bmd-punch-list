// Progress-bill arithmetic: full amount for the period, less holdback, GST on the net.
export type BillTotals = { grossCents: number; holdbackCents: number; netCents: number; gstCents: number; totalCents: number };

export function billTotals(grossCents: number, holdbackPct: number, gstPct: number): BillTotals {
  if (!Number.isInteger(grossCents) || grossCents < 0) throw new Error("Amount must be a whole number of cents, zero or more");
  if (holdbackPct < 0 || holdbackPct >= 100) throw new Error("Holdback must be between 0 and 100 percent");
  const holdbackCents = Math.round((grossCents * holdbackPct) / 100);
  const netCents = grossCents - holdbackCents;
  const gstCents = Math.round((netCents * gstPct) / 100);
  return { grossCents, holdbackCents, netCents, gstCents, totalCents: netCents + gstCents };
}

/** Invoice that releases holdback retained on earlier bills. */
export function holdbackRelease(retainedCents: number, gstPct: number): BillTotals {
  const gstCents = Math.round((retainedCents * gstPct) / 100);
  return { grossCents: retainedCents, holdbackCents: 0, netCents: retainedCents, gstCents, totalCents: retainedCents + gstCents };
}

/** Amount still billable; never negative. */
export function remainingToBill(contractCents: number, billedToDateCents: number): number {
  return Math.max(0, contractCents - billedToDateCents);
}
