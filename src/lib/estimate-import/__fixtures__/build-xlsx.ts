import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { parseCsv } from "../parse";

export const FIXTURE_CSV = readFileSync(new URL("./estimate-4811643.csv", import.meta.url), "utf8");

/** The fixture as a workbook: two identical estimate sheets plus a Summary with the materials tax line. */
export function fixtureXlsx(): Uint8Array {
  const rows = parseCsv(FIXTURE_CSV).map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Estimate");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Full Estimate");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Summary"], ["Subtotal", 38007.10254882375], ["Materials tax", 7, 1741.267370378025], ["Total", 39748.37]]), "Summary");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
