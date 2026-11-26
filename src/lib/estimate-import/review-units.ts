import { convertPrice, normaliseUom } from "./match";
import type { Decision } from "./commit";
import type { ParsedFields, ParsedRow } from "./types";

export const REVIEW_UNITS = ["SF", "SY", "LF", "EA", "carton", "roll", "bag"] as const;

/** Keep source cells untouched. All edited numbers travel inside the saved row decision. */
export function reviewedRow<T extends ParsedRow>(row: T, decision: Decision | undefined): T {
  return decision?.reviewed ? { ...row, parsed: decision.reviewed } : row;
}

export function changeReviewUnit(fields: ParsedFields, to: string, confirmed = false): { fields: ParsedFields; note: string; needsConfirmation: boolean } {
  const from = fields.uom;
  if (from === to) return { fields, note: "", needsConfirmation: false };
  const factor = convertPrice(1, from, to);
  if (factor == null && !confirmed) return { fields, note: "", needsConfirmation: true };
  const scale = factor ?? 1;
  const qty = fields.qty == null ? null : fields.qty / scale;
  const price = (n: number | null) => n == null ? null : n * scale;
  const changed: ParsedFields = {
    ...fields, uom: normaliseUom(to) ?? to, qty,
    ...(fields.total_qty != null ? { total_qty: fields.total_qty / scale } : {}),
    material_unit_cost: price(fields.material_unit_cost), labour_unit_cost: price(fields.labour_unit_cost), sell_unit: price(fields.sell_unit),
  };
  const display = (n: number | null) => n == null ? "?" : n.toFixed(2);
  return { fields: changed, needsConfirmation: false, note: factor == null ? `Relabelled ${from ?? "?"} → ${to}; numbers unchanged` : `Converted ${display(fields.qty)} ${from} → ${display(qty)} ${to}` };
}