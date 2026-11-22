import { describe, expect, it } from "bun:test";
import { billTotals, holdbackRelease, remainingToBill } from "./calc";

describe("progress billing", () => {
  it("$100,000 bill with 7.5% holdback", () => {
    expect(billTotals(10000000, 7.5, 5)).toEqual({ grossCents: 10000000, holdbackCents: 750000, netCents: 9250000, gstCents: 462500, totalCents: 9712500 });
  });
  it("no holdback on small jobs", () => expect(billTotals(500000, 0, 5).totalCents).toBe(525000));
  it("holdback release invoice", () => expect(holdbackRelease(750000, 5)).toEqual({ grossCents: 750000, holdbackCents: 0, netCents: 750000, gstCents: 37500, totalCents: 787500 }));
  it("cannot bill past the contract", () => expect(remainingToBill(10000000, 12000000)).toBe(0));
  it("rejects bad input", () => { expect(() => billTotals(-1, 7.5, 5)).toThrow(); expect(() => billTotals(100, 100, 5)).toThrow(); });
});
