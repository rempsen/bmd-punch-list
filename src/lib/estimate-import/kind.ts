import type { SourceKind } from "./types";
export function sourceKindOf(fileName: string): SourceKind {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "xlsx";
  throw new Error("Estimate files must be Excel (.xlsx/.xls), CSV or PDF.");
}
