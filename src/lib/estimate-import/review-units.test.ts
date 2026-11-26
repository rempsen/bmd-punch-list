import { describe, expect, test } from "bun:test";
import { defaultUnit } from "@/lib/catalogue/logic";
import { simpleComponent, type CatalogueView } from "@/lib/estimating/assemble";
import { lineFromFinish } from "@/lib/estimating/lines";
import { offerUom } from "@/lib/takeoff/quantities";
import type { Template } from "@/lib/catalogue/data";
import { candidateLabel, convertPrice, guessCategory, type Candidate } from "./match";
import { payloadPrice, rowToPayload, type Decision } from "./commit";
import { changeReviewUnit, reviewedRow } from "./review-units";
import { productDefaults } from "./product-defaults";
import type { ParsedFields, ParsedRow } from "./types";

const fields: ParsedFields = { description: "Carpet Main Floor - Both bedrooms.", detail: null, qty: 34.45015, uom: "SY", material_unit_cost: 35, labour_unit_cost: 10, waste_pct: 0, markup_pct: 35, margin_pct: null, sell_unit: null, taxable: false, colour: null };
const row: ParsedRow = { row_no: 1, kind: "item", group_name: "Carpet", raw: { cells: [], sheet: "Estimate" }, parsed: fields };
const candidate: Candidate = { catalogue_item_id: "carpet", name: "Carpet (broadloom)", uom: "SF", material_unit_cost: 3.9, labour_unit_cost: null, score: 1, reason: "" };
const catalogue: CatalogueView = { materials: { carpet: { id: "carpet", name: "Carpet", cost_uom: "SF", purchase_uom: "SF", unit_cost_cents: 390, coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: false, default_waste_pct: 0 } }, labour: {} };
const context = { options: { gross_up_pst_pct: null, default_markup_pct: 35, category_strategy: "groups" as const }, category: "Carpet", catalogue, templates: [] };

describe("review unit rules", () => {
  test("SF price converts to SY, including the migration's $3.90 → $35.10", () => expect(convertPrice(3.9, "SF", "SY")).toBe(35.1));
  test("SY price converts back to SF", () => expect(convertPrice(35.1, "SY", "SF")).toBeCloseTo(3.9, 10));
  test("broadloom defaults to SY even with an SF fallback", () => expect(defaultUnit("carpet_broadloom", "SF")).toBe("SY"));
  test("carpet tile keeps its existing SF unit", () => expect(defaultUnit("carpet_tile", "SF")).toBe("SF"));
  test("scope-detected new broadloom gets SY and a converted cost", () => {
    const keywords = [{ id: "carpet", term: "carpet", group_key: "carpet", whole_word: false }];
    expect(guessCategory(fields.description, keywords)).toBe("carpet_broadloom");
    expect(productDefaults({ ...fields, uom: "SF", material_unit_cost: 3.9 }, keywords)).toMatchObject({ category: "carpet_broadloom", cost_uom: "SY", purchase_uom: "SY", unit_cost_cents: 3510 });
  });
  test("candidate label for Dan's SY row shows both the original and equivalent price", () => expect(candidateLabel(candidate, "SY")).toBe("Carpet (broadloom) · $3.90/SF = $35.10/SY"));
  test("labour-only assembly price is not reported missing", () => expect(candidateLabel({ ...candidate, material_unit_cost: null, labour_unit_cost: 5, uom: "SY" }, "SF")).toBe("Carpet (broadloom) · $5.00/SY = $0.56/SF (labour)"));
  test("unpriced candidate has no price, without a misleading unit", () => expect(candidateLabel({ ...candidate, material_unit_cost: null }, "SY")).toBe("Carpet (broadloom) · no price"));
  test("SY → SF converts quantity and both costs, and the saved decision resumes and commits SF", () => {
    const changed = changeReviewUnit(fields, "SF");
    expect(changed.needsConfirmation).toBe(false);
    expect(changed.fields.qty).toBeCloseTo(310.05135, 8);
    expect(changed.fields.material_unit_cost).toBeCloseTo(35 / 9, 10);
    expect(changed.fields.labour_unit_cost).toBeCloseTo(10 / 9, 10);
    expect(changed.note).toBe("Converted 34.45 SY → 310.05 SF");
    const saved: Decision = JSON.parse(JSON.stringify({ action: "keep_imported", reviewed: changed.fields, unitNote: changed.note }));
    expect(reviewedRow(row, saved).parsed?.uom).toBe("SF");
    const committed = rowToPayload(row, saved, context);
    expect(committed.line.driver_uom).toBe("SF");
    expect(committed.line.driver_qty).toBeCloseTo(310.05135, 8);
    expect(payloadPrice(committed, { pstPct: 7 }).costCents).toBe(payloadPrice(rowToPayload(row, { action: "keep_imported" }, context), { pstPct: 7 }).costCents);
    expect(row.parsed?.uom).toBe("SY");
  });
  test("SF → SY converts quantity, material, labour and sell while retaining extended totals", () => {
    const result = changeReviewUnit({ ...fields, qty: 90, uom: "SF", material_unit_cost: 3.9, labour_unit_cost: 1, sell_unit: 7, total_qty: 99, material_total: 386.1 }, "SY");
    expect(result.fields).toMatchObject({ qty: 10, uom: "SY", material_unit_cost: 35.1, labour_unit_cost: 9, sell_unit: 63, total_qty: 11, material_total: 386.1 });
  });
  test("LF ↔ ft is 1:1 and needs no confirmation", () => expect(changeReviewUnit({ ...fields, uom: "ft", qty: 20 }, "LF")).toMatchObject({ needsConfirmation: false, fields: { qty: 20, material_unit_cost: 35, uom: "LF" } }));
  test("no conversion does nothing until confirmed, then only relabels", () => {
    expect(changeReviewUnit(fields, "roll")).toMatchObject({ fields, needsConfirmation: true });
    expect(changeReviewUnit(fields, "roll", true)).toMatchObject({ needsConfirmation: false, fields: { qty: 34.45015, material_unit_cost: 35, labour_unit_cost: 10, uom: "roll" } });
  });
  test("Use catalogue keeps SY and translates SF material cost without changing the material", () => {
    const item = rowToPayload(row, { action: "catalogue", candidate }, context);
    expect(item.line.driver_uom).toBe("SY");
    expect(item.components?.[0]).toMatchObject({ cost_uom: "SY", unit_cost_cents: 3510 });
    expect(catalogue.materials["carpet"]?.unit_cost_cents).toBe(390);
    expect(catalogue.materials["carpet"]?.cost_uom).toBe("SF");
  });
  test("Catalogue item, imported price keeps SY and the exact file total", () => {
    const item = rowToPayload(row, { action: "catalogue", candidate, keepPrice: true }, context);
    expect(item.line.driver_uom).toBe("SY");
    expect(item.components?.[0]?.cost_uom).toBe("SY");
    expect(payloadPrice(item, { pstPct: 7 }).costCents).toBe(payloadPrice(rowToPayload(row, { action: "keep_imported" }, context), { pstPct: 7 }).costCents);
  });
  test("a stale SF broadloom template still takes the takeoff SY quantity and SY costs", () => {
    const template = { id: "t", name: "Broadloom", category: "carpet_broadloom", driver_uom: "SF", default_waste_pct: 0, cost_code: null, sort_order: 1, active: true, components: [{ ...simpleComponent("Carpet", null, "SF"), kind: "material", source: "finish_material" }] } as Template;
    const finish = { id: "f", tag: "CPT", description: "Broadloom", catalogue_material_id: "carpet" } as Parameters<typeof lineFromFinish>[0]["finish"];
    expect(offerUom({ sf: 90, sy: 10, lf: 0, ea: 0 }, "SF", "carpet_broadloom")).toBe("SY");
    const built = lineFromFinish({ versionId: "v", finish, template, catalogue, qty: 10, section: "Carpet", markupPct: 35 });
    expect(built.item.line).toMatchObject({ driver_qty: 10, driver_uom: "SY" });
    expect(built.item.components?.[0]).toMatchObject({ cost_uom: "SY", unit_cost_cents: 3510 });
  });
});