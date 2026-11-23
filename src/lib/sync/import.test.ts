import { describe, expect, test } from "bun:test";
import { chosenActions, planImport, planSummary, suggestPicks, type Existing, type StagedRow } from "./import";

const item = (id: string, kind: string, name: string, data: Record<string, unknown> = {}): StagedRow => ({ entity: "Item", external_id: id, kind, name, data: { sku: null, cost_cents: null, sales_price_cents: null, vendor: null, vendor_id: null, category: null, active: true, code: null, ...data } });
const vendor = (id: string, name: string, data: Record<string, unknown> = {}): StagedRow => ({ entity: "Vendor", external_id: id, kind: "supplier", name, data: { contact_name: null, email: null, phone: null, account_number: null, active: true, ...data } });
const none: Existing = { materials: [], labour: [], suppliers: [], costCodes: [], links: [] };

describe("planning the first load from QuickBooks", () => {
  test("a vendor BMD does not have becomes a supplier", () => {
    const p = planImport([vendor("7", "Gerflor", { email: "a@b.c" })], none);
    expect(p).toEqual([{ op: "create", kind: "supplier", external_id: "7", name: "Gerflor", bmd_id: null, fields: { name: "Gerflor", contact_name: null, email: "a@b.c", phone: null, account_number: null, active: true } }]);
  });
  test("a vendor BMD already has, by name, is linked and only its blanks are filled", () => {
    const p = planImport([vendor("7", "gerflor ", { email: "a@b.c", phone: "204" })], { ...none, suppliers: [{ id: "s1", name: "Gerflor", contact_name: null, email: "own@bmd.ca", phone: null, account_number: null, active: true }] });
    expect(p).toEqual([{ op: "link", kind: "supplier", external_id: "7", name: "Gerflor", bmd_id: "s1", fields: { phone: "204" }, kept: ["email"] }]);
  });
  test("a product becomes a material with its cost, its vendor, and its unit still to confirm", () => {
    const p = planImport([vendor("7", "Gerflor"), item("95", "material", "MIPOLAM AFINITY", { cost_cents: 1795, vendor_id: "7", vendor: "Gerflor", sku: "MIP" })], none);
    expect(p[1]).toEqual({ op: "create", kind: "material", external_id: "95", name: "MIPOLAM AFINITY", bmd_id: null, fields: { name: "MIPOLAM AFINITY", sku: "MIP", unit_cost_cents: 1795, supplier_external_id: "7", category: "other", active: true } });
  });
  test("a product with no cost in QuickBooks arrives with its cost unknown, never zero", () => {
    expect(planImport([item("91", "material", "DeckSmart")], none)[0]!.fields["unit_cost_cents"]).toBeNull();
  });
  test("a product BMD already has is matched by SKU first, then by name", () => {
    const ex = { ...none, materials: [{ id: "m1", name: "Dante Pro", sku: "DP2", unit_cost_cents: null, active: true }, { id: "m2", name: "Eco 373 15L", sku: null, unit_cost_cents: 14000, active: true }] };
    const p = planImport([item("1", "material", "Dante Pro 2.0 Glue Down", { sku: "dp2", cost_cents: 129 }), item("2", "material", "eco 373 15l", { cost_cents: 13581 })], ex);
    expect(p[0]).toMatchObject({ op: "link", bmd_id: "m1", fields: { unit_cost_cents: 129 } });           // BMD had no cost: it receives QuickBooks'
    expect(p[1]).toMatchObject({ op: "link", bmd_id: "m2", fields: {}, kept: ["unit_cost_cents"] });      // BMD had a cost: BMD's stays
  });
  test("a service with a cost becomes a labour rate, matched to one BMD already has by name", () => {
    const p = planImport([item("82", "labour", "Install LVT", { cost_cents: 125 }), item("81", "labour", "Install - Carpet Tile", { cost_cents: 500 })], { ...none, labour: [{ id: "l1", name: "Install LVT", unit_cost_cents: null, active: true }] });
    expect(p[0]).toMatchObject({ op: "link", kind: "labour", bmd_id: "l1", fields: { unit_cost_cents: 125 } });
    expect(p[1]).toMatchObject({ op: "create", kind: "labour", fields: { name: "Install - Carpet Tile", unit_cost_cents: 500, active: true } });
  });
  test("cost-code items link to BMD's cost codes and never become products", () => {
    const p = planImport([item("132", "cost_code", "01-04 - LVT", { code: "01-04" }), item("999", "cost_code", "09-01 - New thing", { code: "09-01" })], { ...none, costCodes: [{ code: "01-04", name: "LVT", qbo_item_id: null }] });
    expect(p[0]).toEqual({ op: "link", kind: "cost_code", external_id: "132", name: "LVT", bmd_id: "01-04", fields: { qbo_item_id: "132" } });
    expect(p[1]).toEqual({ op: "create", kind: "cost_code", external_id: "999", name: "New thing", bmd_id: "09-01", fields: { code: "09-01", name: "New thing", qbo_item_id: "999" } });
  });
  test("categories and accounting items are left in QuickBooks", () => {
    const p = planImport([item("18", "category", "Construction Materials"), item("171", "other", "Holdback")], none);
    expect(p.map((a) => a.op)).toEqual(["skip", "skip"]);
  });
  test("something already linked is not imported twice", () => {
    const p = planImport([item("95", "material", "MIPOLAM AFINITY", { cost_cents: 1795 })], { ...none, materials: [{ id: "m1", name: "Mipolam", sku: null, unit_cost_cents: 1795, active: true }], links: [{ kind: "material", bmd_id: "m1", external_id: "95" }] });
    expect(p).toEqual([{ op: "linked", kind: "material", external_id: "95", name: "MIPOLAM AFINITY", bmd_id: "m1", fields: {} }]);
  });
  test("an inactive QuickBooks record comes in inactive", () => {
    expect(planImport([item("5", "material", "Old tile", { active: false })], none)[0]!.fields["active"]).toBe(false);
  });
  test("two QuickBooks products that would match the same BMD material: the first links, the second is created", () => {
    const p = planImport([item("1", "material", "Feather Finish - Bag"), item("2", "material", "Feather Finish - Bag ")], { ...none, materials: [{ id: "m1", name: "Feather Finish - Bag", sku: null, unit_cost_cents: null, active: true }] });
    expect(p.map((a) => a.op)).toEqual(["link", "create"]);
  });
});

describe("the dry-run summary", () => {
  test("counts what would happen, by kind, and lists likely duplicates", () => {
    const plan = planImport([vendor("7", "Gerflor"), item("1", "material", "4in Standard Rubber Base", { cost_cents: 90 }), item("2", "material", "4in Standard Rubber Base - Black D40-4-R", { cost_cents: 81 }), item("3", "labour", "Install LVT", { cost_cents: 125 }), item("4", "other", "Holdback"), item("5", "cost_code", "01-04 - LVT", { code: "01-04" })], { ...none, costCodes: [{ code: "01-04", name: "LVT", qbo_item_id: "132" }] });
    const s = planSummary(plan);
    expect(s.byKind).toEqual({ supplier: { create: 1, link: 0, linked: 0 }, material: { create: 2, link: 0, linked: 0 }, labour: { create: 1, link: 0, linked: 0 }, cost_code: { create: 0, link: 1, linked: 0 } });
    expect(s.skipped).toBe(1);
    expect(s.unknownCosts).toBe(0);
    expect(s.duplicates).toEqual([["4in Standard Rubber Base", "4in Standard Rubber Base - Black D40-4-R"]]);
    expect(s.writes).toBe(5);
  });
});

describe("choosing what comes in", () => {
  const purchases = (material_lines: number, other_lines: number) => ({ purchases: { material_lines, other_lines, last_purchase: "2026-01-01" } });
  test("suppliers start ticked only when BMD has bought materials from them or a product names them", () => {
    const staged = [vendor("1", "Interface", purchases(12, 0)), vendor("2", "Olive Garden", purchases(0, 4)), vendor("3", "Shell Gas", purchases(0, 0)), vendor("4", "Gerflor", purchases(0, 0)), vendor("5", "Old Co"), item("9", "material", "Mipolam", { vendor_id: "4" })];
    const picks = suggestPicks(planImport(staged, none), staged);
    expect(picks.get("supplier|1")).toEqual({ on: true, why: "12 material purchase lines" });
    expect(picks.get("supplier|2")).toEqual({ on: false, why: "bought from, but never materials" });
    expect(picks.get("supplier|3")).toEqual({ on: false, why: "never bought from in 3 years" });
    expect(picks.get("supplier|4")).toEqual({ on: true, why: "a product names it as its vendor" });
    expect(picks.get("supplier|5")).toEqual({ on: false, why: "no purchase history read yet" });
  });
  test("tax, billing and one-job lines start unticked; real products and matches start ticked", () => {
    const staged = [item("1", "material", "Tax"), item("2", "material", "Tile - Supply"), item("3", "material", "Grand Pacific Gardens - Window Coverings - Gimli A Suite 2 Window Coverings"), item("4", "material", "Dante Pro 2.0 - Glue Down - Acacia Sereno"), item("5", "material", "Old tile", { active: false }), item("6", "cost_code", "01-04 - LVT", { code: "01-04" })];
    const picks = suggestPicks(planImport(staged, none), staged);
    expect([1, 2, 3, 4, 5].map((i) => picks.get(`material|${i}`)?.on)).toEqual([false, false, false, true, false]);
    expect(picks.get("material|3")?.why).toBe("looks like one job's line");
    expect(picks.get("cost_code|6")?.on).toBe(true);
    const charges = [item("7", "material", "Change Order"), item("8", "material", "Fuel Surcharge"), item("9", "material", "Installer Pay", { category: "Fees" }), item("10", "material", "Surron Ultra Bee", { category: "Samples" }), item("11", "material", "Prep Materials")];
    const cp = suggestPicks(planImport(charges, none), charges);
    expect([7, 8, 9, 10, 11].map((i) => cp.get(`material|${i}`)?.on)).toEqual([false, false, false, false, true]);
  });
  test("a ticked product brings its supplier even when the supplier was unticked", () => {
    const staged = [vendor("4", "Gerflor"), vendor("8", "Shell Gas"), item("9", "material", "Mipolam", { vendor_id: "4" })];
    const plan = planImport(staged, none);
    const r = chosenActions(plan, (k) => k === "material|9");
    expect(r.actions.map((a) => `${a.kind}|${a.external_id}`)).toEqual(["supplier|4", "material|9"]);
    expect(r.addedSuppliers).toEqual(["Gerflor"]);
  });
});
