import { describe, expect, test } from "bun:test";
import { isPriceListFile, navGroupOpen } from "./nav";

describe("sidebar accordions", () => {
  test("stay open when left open", () => {
    expect(navGroupOpen("open", false)).toBe(true);
  });
  test("stay closed when left closed", () => {
    expect(navGroupOpen("closed", true)).toBe(false);
  });
  test("use their default when nothing is remembered", () => {
    expect(navGroupOpen(null, false)).toBe(false);
    expect(navGroupOpen(null, true)).toBe(true);
  });
});

describe("files accepted as a price list", () => {
  test("Excel and CSV, whatever the letter case", () => {
    for (const n of ["prices.xlsx", "Prices.XLS", "list.csv"]) expect(isPriceListFile(n)).toBe(true);
  });
  test("anything else is refused", () => {
    for (const n of ["quote.pdf", "photo.jpg", "xlsx", ""]) expect(isPriceListFile(n)).toBe(false);
  });
});
