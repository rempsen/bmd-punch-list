import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";
import { extractDocx, extractStoredText, extractWorkbook, splitSections } from "./office.server";
import { needsIndex, indexStatus } from "./index-status";

describe("shared Office extraction", () => {
  test("Word headings and two tables retain document order and flatten cells", async () => {
    const result = await extractDocx(await Bun.file(new URL("./fixtures/two-tables.docx", import.meta.url)).arrayBuffer());
    expect(result.pages).toEqual(["Flooring specifications\nMaterial | Area\nCarpet | Lobby\nBetween tables\nRubber base | Corridor\nFinal notes"]);
    expect(result.labels).toEqual(["section 1 of 1"]);
  });
  test("Word sections are bounded at 3000 characters without losing text", () => {
    const text = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const result = splitSections(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((p) => p.length <= 3000)).toBe(true);
    expect(result.join(" ")).toBe(text);
    expect(splitSections("a".repeat(7000)).map((p) => p.length)).toEqual([3000, 3000, 1000]);
  });
  test("Excel has one page per named sheet with header and no empty rows", async () => {
    const result = extractWorkbook(await Bun.file(new URL("./fixtures/two-sheets.xlsx", import.meta.url)).arrayBuffer());
    expect(result.labels).toEqual(["sheet Finishes", "sheet Schedule"]);
    expect(result.pages).toEqual(["Material | Qty\nCarpet | 12\nTile | 8", "Task | Date\nInstall | 2026-12-01"]);
  });
  test("legacy XLS uses the same sheet extraction", () => {
    const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([["Material"], ["Vinyl"]]), "Legacy");
    const result = extractWorkbook(XLSX.write(w, { type: "array", bookType: "biff8" }) as ArrayBuffer);
    expect(result.pages).toEqual(["Material\nVinyl"]);
    expect(result.labels).toEqual(["sheet Legacy"]);
  });
  test("CSV preserves quoted commas and flattens cells on one page", async () => {
    const result = await extractStoredText(new Blob(['Material,Qty\n"Tile, blue",8\n\n']), "csv");
    expect(result.pages).toEqual(["Material | Qty\nTile, blue | 8"]);
  });
  test("large sheets stop at 5000 rows with an explicit note", () => {
    const w = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([["Header"], ...Array.from({ length: 5005 }, (_, i) => [i + 1])]), "Large");
    const result = extractWorkbook(XLSX.write(w, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    expect(result.pages[0]).toContain("\n4999\n[Sheet limited to 5000 rows.]");
    expect(result.pages[0]).not.toContain("\n5000\n");
  });
  test("previously deferred Office and failed files are retryable; images are not", () => {
    expect(needsIndex({ file_name: "old.docx", mime: null, text_status: "no_text" })).toBe(true);
    expect(needsIndex({ file_name: "old.xlsx", mime: null, text_status: "failed" })).toBe(true);
    expect(needsIndex({ file_name: "image.png", mime: null, text_status: "pending" })).toBe(false);
    expect(indexStatus({ file_name: "image.png", mime: null })).toBe("Not searchable");
  });
});
