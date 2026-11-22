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
