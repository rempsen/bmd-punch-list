import type { Template } from "@/lib/catalogue/data";
import { buildComponents, extraQuestion as question, simpleComponent, type CatalogueView, type CatMaterial as CatM, type SnapComponent, type TemplateInput as TplIn } from "./assemble";
import { ownQty as own, type Uom } from "./calc";
import type { Finish, LineKind, SaveItem } from "./data";

/** Whether a part's waste is in its cost: materials always, labour and plain costs only when paid on the wasted quantity. */
export const wasteApplies = (c: SnapComponent): boolean => c.kind === "material" || (c.kind === "fixed" && c.pst_applies) || c.on_gross;

/**
 * The part a line's waste belongs to: its finish material, or failing that the first part that is not labour,
 * or the only part there is. -1 when it cannot be told (several labour rows and nothing else).
 */
export function mainPart(components: SnapComponent[]): number {
  const live = components.map((c, i) => ({ c, i })).filter((x) => !x.c.not_applicable);
  const pool = live.length > 0 ? live : components.map((c, i) => ({ c, i }));
  const found = pool.find((x) => x.c.source === "finish_material") ?? pool.find((x) => x.c.kind !== "labour") ?? (pool.length === 1 ? pool[0] : undefined);
  return found?.i ?? -1;
}

/** One part with its waste typed. Labour and plain costs are paid on the wasted quantity exactly when there is waste to pay on. */
const withWaste = (c: SnapComponent, wastePct: number): SnapComponent => (c.kind === "material" ? { ...c, waste_pct: wastePct } : { ...c, waste_pct: wastePct, on_gross: wastePct > 0 });

/** A line's waste drives its main part, and labour that is paid on the wasted quantity. It is kept on the line and never changes the catalogue. */
export function setLineWaste(components: SnapComponent[], wastePct: number): SnapComponent[] {
  const main = mainPart(components);
  return components.map((c, i) => (i === main ? withWaste(c, wastePct) : c.kind === "labour" && c.on_gross ? { ...c, waste_pct: wastePct } : c));
}

/**
 * Waste typed on one part of a line. On the main part it is the line's waste (returned as `lineWastePct`, to save on the line);
 * on any other part it changes that part alone.
 */
export function setPartWaste(components: SnapComponent[], index: number, wastePct: number): { components: SnapComponent[]; lineWastePct?: number } {
  if (index === mainPart(components)) return { components: setLineWaste(components, wastePct), lineWastePct: wastePct };
  return { components: components.map((c, i) => (i === index ? withWaste(c, wastePct) : c)) };
}

/** The waste a line's cost really includes: its main part's. Only when there is no main part is the stored figure all there is to show. */
export function lineWasteShown(storedPct: number, components: SnapComponent[]): number {
  const main = components[mainPart(components)];
  return main ? (wasteApplies(main) ? main.waste_pct : 0) : storedPct;
}

/** How much of the line one purchase unit of a part covers (SF per pail, say), typed on the line. Kept on the line. */
export const setPartCoverage = (components: SnapComponent[], index: number, coverage: number): SnapComponent[] => components.map((c, i) => (i === index ? { ...c, coverage_per_purchase_unit: coverage } : c));

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

const AREA = (u: Uom) => u === "SF" || u === "SY";
const ALL_UNITS: Uom[] = ["SF", "SY", "LF", "EA", "carton", "roll", "pail", "hour", "LS"];
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The units a line can be switched to: any for a line made of one thing; square feet or yards for an assembly measured by area. */
export const unitChoices = (current: Uom, partCount: number): Uom[] => (partCount <= 1 ? ALL_UNITS : AREA(current) ? ["SF", "SY"] : [current]);

/**
 * Changes the unit a line is measured in.
 * Square feet and square yards convert: the quantity and (for a line made of one thing) the unit cost are converted, so the line's cost stays the same.
 * Any other change keeps the numbers as typed and changes only the unit, because there is no fixed conversion (SF to LF, say).
 */
export function changeLineUnit(line: { driver_qty: number; driver_uom: Uom }, components: SnapComponent[], to: Uom): { line: { driver_qty: number; driver_uom: Uom }; components: SnapComponent[]; converted: boolean } {
  const from = line.driver_uom;
  if (from === to) return { line: { driver_qty: line.driver_qty, driver_uom: to }, components, converted: false };
  const area = AREA(from) && AREA(to);
  const perNew = area ? (to === "SY" ? 9 : 1 / 9) : 1;   // how many old units make one new unit
  const qty = area ? round4(line.driver_qty / perNew) : line.driver_qty;
  if (components.length > 1) {
    if (!area) throw new Error("This line is an assembly of several parts priced per " + from + ". It can only be switched between SF and SY.");
    // Parts keep their own cost units; only what one purchase unit covers is stated in the line's unit, so that is converted.
    return { line: { driver_qty: qty, driver_uom: to }, converted: true, components: components.map((c) => (c.coverage_per_purchase_unit ? { ...c, coverage_per_purchase_unit: round4(c.coverage_per_purchase_unit / perNew) } : c)) };
  }
  return {
    line: { driver_qty: qty, driver_uom: to },
    converted: area,
    components: components.map((c) => ({
      ...c,
      cost_uom: c.cost_uom === from ? to : c.cost_uom,
      purchase_uom: c.purchase_uom === from ? to : c.purchase_uom,
      unit_cost_cents: area && c.cost_uom === from && c.unit_cost_cents != null ? Math.round(c.unit_cost_cents * perNew) : c.unit_cost_cents,
      coverage_per_purchase_unit: c.coverage_per_purchase_unit && area ? round4(c.coverage_per_purchase_unit / perNew) : c.coverage_per_purchase_unit,
    })),
  };
}

/** A unit cost restated in another unit: SF and SY convert, any other pair cannot be (null). */
export function costInUnit(cents: number, from: Uom, to: Uom): number | null {
  if (from === to) return cents;
  if (!AREA(from) || !AREA(to)) return null;
  return Math.round(from === "SY" ? cents / 9 : cents * 9);
}

export type PartKind = "install" | "adhesive" | "prep";
export type PartChoice = { type: "labour" | "material"; id: string; name: string };
const sameMeasure = (a: Uom, b: Uom) => a === b || (AREA(a) && AREA(b));
const PART_LABEL: Record<PartKind, string> = { install: "Install", adhesive: "Adhesive", prep: "Prep" };

/** What the catalogue offers for an extra part of a line: install rates, adhesives, or prep, limited to what fits the line's unit. */
export function partChoices(kind: PartKind, materials: { id: string; name: string; category: string; active: boolean }[], labour: { id: string; name: string; uom: Uom; active: boolean }[], driver: Uom): PartChoice[] {
  const rate = (re: RegExp) => labour.filter((l) => l.active && re.test(l.name) && sameMeasure(l.uom, driver)).map((l): PartChoice => ({ type: "labour", id: l.id, name: l.name }));
  const mats = (category: string) => materials.filter((m) => m.active && m.category === category).map((m): PartChoice => ({ type: "material", id: m.id, name: m.name }));
  if (kind === "install") return rate(/install/i);
  if (kind === "adhesive") return mats("adhesive");
  return [...rate(/prep|patch|level/i), ...mats("prep")];
}

/**
 * One more part for a line: install labour, adhesive or prep. Chosen from the catalogue it comes in at the catalogue's cost;
 * with nothing chosen it comes in with its cost unknown, to be typed on the line.
 */
export function partFor(kind: PartKind, pick: PartChoice | null, driver: Uom, catalogue: CatalogueView, sortOrder: number): SnapComponent {
  const material = pick ? pick.type === "material" : kind === "adhesive";
  const { components } = buildComponents({
    template: {
      driver_uom: driver,
      default_waste_pct: 0,
      components: [{ kind: material ? "material" : "labour", label: pick?.name ?? PART_LABEL[kind], source: material ? "catalogue" : "labour_rate", catalogue_material_id: material ? (pick?.id ?? null) : null, labour_rate_id: material ? null : (pick?.id ?? null), unit_cost_cents: null, cost_uom: null, qty_per_driver: 1, waste_pct: 0, round_up: true, pst_applies: false, on_gross: false, sort_order: 1 }],
    },
    finishMaterialId: null,
    catalogue,
  });
  return { ...components[0]!, sort_order: sortOrder };
}

const USUAL_SECTIONS = ["Flooring", "Window coverings", "Prep", "General"];
/** Sections a line can be moved to: the ones already on this price, then the usual ones. */
export const sectionChoices = (inUse: string[]): string[] => [...new Set([...inUse, ...USUAL_SECTIONS])];

// ── Extras asked about on each line (a Schluter edge on wall tile) ─────────────────────────────────────
export { extraQuestion } from "./assemble";

/** The yes-or-no extras on a line, with where each stands. */
export function extrasOf(components: SnapComponent[], driver: Uom): { index: number; label: string; uom: Uom; state: "ask" | "yes" | "no"; qty: number; unitCostCents: number | null }[] {
  return components.flatMap((c, index) => {
    const state = question(c, driver);
    return state ? [{ index, label: c.label, uom: c.cost_uom, state, qty: c.qty_per_driver, unitCostCents: c.unit_cost_cents }] : [];
  });
}

/** Answers an extra: Yes with how much of it there is (in its own unit), or No. */
export function answerExtra(components: SnapComponent[], index: number, yes: boolean, qty = 0): SnapComponent[] {
  if (yes && !(qty > 0)) throw new Error(`Type how many ${components[index]?.cost_uom ?? "units"} there are.`);
  return components.map((c, i) => (i !== index ? c : yes ? { ...c, not_applicable: false, qty_per_driver: Math.round(qty * 100) / 100 } : { ...c, not_applicable: true }));
}

const WALLS = /(^|\s)walls$/i;
/** True for the sections the takeoff gives wall tile: "Walls", "Suite Type B walls". */
export const isWallSection = (section: string): boolean => WALLS.test(section.trim());

/**
 * The assembly a line added from the takeoff is priced with. Walls take the wall tile assembly (wall install labour,
 * and its Schluter question) whatever the finish is set up as; everything else keeps the finish's own.
 */
export function templateForOffer<T extends { category: string; active: boolean }>(finishTemplate: T | null, section: string, templates: T[]): T | null {
  if (!isWallSection(section)) return finishTemplate;
  return templates.find((t) => t.active && t.category === "wall_tile") ?? finishTemplate;
}

// ── Choosing the item for an extra, and repairing lines built before it was asked about ───────────────────

/** Tile trims a person can choose for an extra priced in `uom`: active items of the Tile trim category in that unit. */
export function trimChoices<T extends { category: string; cost_uom: string; active: boolean }>(materials: T[], uom: string): T[] {
  return materials.filter((m) => m.active && m.category === "tile_trim" && m.cost_uom === uom);
}

/** Puts a catalogue item (one Schluter SKU) on an extra. Its price, waste and PST come from the catalogue; the answer is kept. */
export function pickExtraSku(components: SnapComponent[], index: number, m: CatM): SnapComponent[] {
  const c = components[index];
  if (!c) return components;
  if (m.cost_uom !== c.cost_uom) throw new Error(`${m.name} is priced per ${m.cost_uom}. Choose one priced per ${c.cost_uom}.`);
  return components.map((x, i) =>
    i !== index ? x : { ...x, kind: "material", source: "catalogue", catalogue_material_id: m.id, unit_cost_cents: m.unit_cost_cents, purchase_uom: m.purchase_uom === m.cost_uom ? m.purchase_uom : m.cost_uom, waste_pct: m.default_waste_pct, pst_applies: m.pst_applies, cost_overridden: false, overridden_by: null, overridden_at: null },
  );
}

/**
 * A line built before its assembly's extra was asked about carries that part in the line's own unit, with nothing to
 * answer. It is rebuilt from the assembly as a question; a part someone already gave a quantity, or answered, is left.
 */
export function repairExtras(components: SnapComponent[], template: TplIn, finishMaterialId: string | null, catalogue: CatalogueView, driver: Uom): { components: SnapComponent[]; fixed: number } {
  const fresh = buildComponents({ template, finishMaterialId, catalogue }).components;
  let fixed = 0;
  const next = components.map((c) => {
    if (c.kind === "labour" || c.qty_per_driver !== 0 || c.not_applicable || own(driver, c.cost_uom, c.coverage_per_purchase_unit)) return c;
    const want = fresh.find((f) => f.sort_order === c.sort_order && (f.label === c.label || (!!f.catalogue_material_id && f.catalogue_material_id === c.catalogue_material_id)) && own(driver, f.cost_uom));
    if (!want) return c;
    fixed++;
    return { ...want, unit_cost_cents: c.cost_overridden ? c.unit_cost_cents : want.unit_cost_cents, cost_overridden: c.cost_overridden && c.unit_cost_cents != null };
  });
  return fixed ? { components: next, fixed } : { components, fixed: 0 };
}
