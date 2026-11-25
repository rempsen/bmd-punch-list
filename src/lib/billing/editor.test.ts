import { describe, expect, test } from "bun:test";
import { editorTotals, invoiceTotals, shapeBillLine, validateBill, requiresOverbillConfirmation, progressHelper, mayEditBill } from "./editor";
describe("bill editor", () => {
  const lines = [shapeBillLine({ description: "Tile", quantity: 3.5, unit: "SF", unitPriceCents: 10001, amountCents: 0 })];
  test("editor and PDF totals agree at the job's 7.5% holdback", () => {
    const totals = editorTotals(lines, "progress", 7.5, 5);
    expect(totals).toEqual({ grossCents: 35004, holdbackCents: 2625, netCents: 32379, gstCents: 1619, totalCents: 33998 });
    expect(invoiceTotals({ lines, kind: "progress", holdback_pct: 7.5, gst_pct: 5, gross_cents: 35004, holdback_cents: 2625, net_cents: 32379, gst_cents: 1619, total_cents: 33998 })).toEqual(totals);
  });
  test("holdback release does not retain holdback again", () => { expect(editorTotals(lines, "holdback_release", 7.5, 5).holdbackCents).toBe(0); });
  test("bill-only override changes totals without changing the job default", () => { expect(editorTotals(lines, "progress", 10, 5).holdbackCents).toBe(3500); expect(editorTotals(lines, "progress", 7.5, 5).holdbackCents).toBe(2625); });
  test("amount must be above zero", () => { expect(validateBill([{ ...lines[0], description: "Tile", quantity: 1, unit: "SF", unitPriceCents: 0, amountCents: 0 }], "2026-11-25", "", 7.5)).not.toBeNull(); });
  test("due date cannot precede bill date", () => { expect(validateBill(lines, "2026-11-25", "2026-11-24", 7.5)).not.toBeNull(); expect(validateBill(lines, "2026-11-25", "2026-11-25", 7.5)).toBeNull(); });
  test("over-billing compares net to Left to bill", () => { expect(requiresOverbillConfirmation(10001, 10000, "progress", false)).toBe(true); expect(requiresOverbillConfirmation(10000, 10000, "progress", false)).toBe(false); });
  test("open-book jobs do not have a fixed-contract cap", () => { expect(requiresOverbillConfirmation(10001, 0, "progress", true)).toBe(false); });
  test("progress helper uses this bill's percentage of contract", () => { expect(progressHelper(10000000, 25).amountCents).toBe(2500000); });
  test("editing requires both job management and pricing", () => { expect(mayEditBill(true, true)).toBe(true); expect(mayEditBill(true, false)).toBe(false); expect(mayEditBill(false, true)).toBe(false); });
});