import type { Material } from "@/lib/catalogue/data";
import { defaultUnit, UOMS } from "@/lib/catalogue/logic";
import type { Uom } from "@/lib/estimating/calc";
import { convertPrice, guessCategory, normaliseUom, type ImportedLine } from "./match";

export function productDefaults(line: ImportedLine, keywords: Parameters<typeof guessCategory>[1]): Partial<Material> {
  const normal = normaliseUom(line.uom);
  const fallback: Uom = UOMS.find((u) => u === normal) ?? "SF";
  const category = guessCategory(`${line.description} ${line.detail ?? ""}`, keywords);
  const unit = defaultUnit(category, fallback);
  const price = line.material_unit_cost == null ? null : convertPrice(line.material_unit_cost, line.uom, unit);
  return { name: line.description.trim(), category, cost_uom: unit, purchase_uom: unit, unit_cost_cents: price == null ? null : Math.round(price * 100), supplier_id: null, price_source: "Imported estimate", pst_applies: true, active: true };
}