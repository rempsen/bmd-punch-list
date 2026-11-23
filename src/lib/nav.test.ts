import { describe, expect, test } from "bun:test";
import { isPriceListFile, jobMenuOpen } from "./nav";

describe("the job menu in the sidebar", () => {
  test("starts hidden", () => {
    expect(jobMenuOpen(null)).toBe(false);
    expect(jobMenuOpen("nonsense")).toBe(false);
  });
  test("stays the way the person left it", () => {
    expect(jobMenuOpen("open")).toBe(true);
    expect(jobMenuOpen("closed")).toBe(false);
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
