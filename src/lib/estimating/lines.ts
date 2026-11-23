import type { Template } from "@/lib/catalogue/data";
import { buildComponents, simpleComponent, type CatalogueView, type SnapComponent } from "./assemble";
import type { Uom } from "./calc";
import type { Finish, LineKind, SaveItem } from "./data";

/** A line's waste drives its finish material, and labour that is paid on the wasted quantity. */
export function setLineWaste(components: SnapComponent[], wastePct: number): SnapComponent[] {
  return components.map((c) => (c.source === "finish_material" || (c.kind === "labour" && c.on_gross) ? { ...c, waste_pct: wastePct } : c));
}

/** A new estimate line for a finish tag, with its assembly snapshotted from the catalogue as it is now. */
export function lineFromFinish(a: { versionId: string; finish: Finish; template: Template; catalogue: CatalogueView; qty: number; section: string; markupPct: number; source?: "manual" | "import" | "takeoff" }): { item: SaveItem; issues: string[] } {
  const { components, issues } = buildComponents({ template: a.template, finishMaterialId: a.finish.catalogue_material_id, catalogue: a.catalogue });
  const main = components.find((c) => c.source === "finish_material");
  return {
    issues,
    item: {
      version_id: a.versionId,
      line: {
        section: a.section || "General",
        finish_id: a.finish.id,
        kind: "assembly",
        description: [a.finish.tag, a.finish.description ?? main?.label].filter(Boolean).join(" – "),
        driver_qty: a.qty,
        driver_uom: a.template.driver_uom,
        waste_pct: main?.waste_pct ?? a.template.default_waste_pct,
        markup_pct: a.markupPct,
        cost_code: a.template.cost_code,
        tax_code: "GST",
        source: a.source ?? "manual",
      },
      components,
    },
  };
}

/** Prep, delivery, subcontract, allowance or lump sum: one cost times a quantity. */
export function simpleLine(a: { versionId: string; kind: Exclude<LineKind, "assembly">; section: string; description: string; qty: number; uom: Uom; unitCostCents: number | null; pst: boolean; markupPct: number; costCode: string | null }): SaveItem {
  return {
    version_id: a.versionId,
    line: { section: a.section || "General", kind: a.kind, description: a.description, driver_qty: a.qty, driver_uom: a.uom, waste_pct: 0, markup_pct: a.markupPct, cost_code: a.costCode, tax_code: "GST", is_allowance: a.kind === "allowance" },
    components: [simpleComponent(a.description || "Cost", a.unitCostCents, a.uom, a.pst)],
  };
}

/** Window coverings are priced per piece: vendor price (PST added), BMD install, and a per-piece delivery and staging charge. */
export function windowLine(a: { versionId: string; section: string; type: string; product: string; qty: number; vendorCents: number | null; installCents: number | null; miscCents: number | null; markupPct: number }): SaveItem {
  const piece = (label: string, cents: number | null, kind: SnapComponent["kind"], pst: boolean, n: number): SnapComponent => ({ ...simpleComponent(label, cents, "EA", pst), kind, cost_overridden: cents != null, sort_order: n });
  return {
    version_id: a.versionId,
    line: { section: a.section || "General", kind: "assembly", description: [a.type.trim(), a.product.trim()].filter(Boolean).join(" – "), driver_qty: a.qty, driver_uom: "EA", waste_pct: 0, markup_pct: a.markupPct, cost_code: "02-100", tax_code: "GST" },
    components: [piece("Vendor price", a.vendorCents, "material", true, 1), piece("Install", a.installCents, "labour", false, 2), piece("Delivery and staging", a.miscCents, "fixed", false, 3)],
  };
}

const TAG_CATEGORY: [RegExp, string][] = [
  [/^cpt\b|carpet tile/i, "carpet_tile"],
  [/^lvt\b/i, "lvt"],
  [/^lvp\b/i, "lvp"],
  [/^rb\b|\bbase\b/i, "wall_base"],
  [/^sv\b|sheet vinyl/i, "sheet_vinyl"],
  [/^ct\b|floor tile/i, "floor_tile"],
  [/^wt\b|wall tile/i, "wall_tile"],
  [/^tr\b|transition/i, "transitions"],
];
/** The catalogue category a finish tag most likely belongs to; "other" when it cannot be told. It can be changed in the catalogue. */
export const guessCategory = (tagOrName: string): string => TAG_CATEGORY.find(([re]) => re.test(tagOrName.trim()))?.[1] ?? "other";

export type CostTarget = { kind: "material"; id: string } | { kind: "labour"; id: string } | { kind: "new_material"; name: string; category: string; uom: Uom } | { kind: "line_only" };

/**
 * Where a cost typed on an estimate line belongs. A cost for a catalogue material, a labour rate or a finish becomes
 * the catalogue's price, so the next estimate starts from it and it is sent on to QuickBooks. A one-off (delivery, an
 * allowance, an unlinked part of an assembly) stays on the line.
 */
export function costTarget(c: SnapComponent, finish: Pick<Finish, "id" | "tag" | "description" | "catalogue_material_id"> | null, componentCount: number): CostTarget {
  if (c.catalogue_material_id) return { kind: "material", id: c.catalogue_material_id };
  if (c.labour_rate_id) return { kind: "labour", id: c.labour_rate_id };
  if (!finish || componentCount !== 1) return { kind: "line_only" };
  if (finish.catalogue_material_id) return { kind: "material", id: finish.catalogue_material_id };
  return { kind: "new_material", name: [finish.tag, finish.description].filter(Boolean).join(" – "), category: guessCategory(finish.description ? `${finish.tag} ${finish.description}` : finish.tag), uom: c.cost_uom };
}
