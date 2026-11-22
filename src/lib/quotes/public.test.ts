import { describe, expect, test } from "bun:test";
import { simpleComponent } from "@/lib/estimating/assemble";
import type { EstLine, EstVersion } from "@/lib/estimating/data";
import { buildSnapshot } from "./logic";
import { checkAcceptance, cleanChoices, hashToken, newToken, publicView } from "./public";

const rates = { pstPct: 7, gstPct: 5, hstPct: 13 };
const line = (id: string, sell: number, o: Partial<EstLine> = {}): EstLine => ({
  id, version_id: "v1", section: "Level 2", finish_id: null, kind: "lump_sum", description: `Line ${id}`, driver_qty: 1, driver_uom: "LS", source: "manual", waste_pct: 0, markup_pct: 30,
  price_basis: "fixed_sell", margin_pct: null, fixed_sell_cents: sell, cost_code: "01-05", tax_code: "GST", notes: "internal note", sort_order: 1, selection: "required",
  selection_group: null, is_allowance: false, subject_to_measure: false, takeoff_condition_id: null, detached: false, row_version: 1, components: [simpleComponent("Acme Supply cost", 1000, "LS")], ...o,
});
const v = (id: string, name: string, lines: EstLine[]): EstVersion => ({ id, project_id: "p", kind: "estimate", co_number: null, name, description: null, default_markup_pct: 30, sort_order: 1, is_base: id === "v1", locked: true, status: "sent", lines });
const base = v("v1", "Base", [line("a", 100000), line("opt", 20000, { selection: "optional" }), line("g1", 30000, { selection: "choose_one", selection_group: "Stair nosing" }), line("g2", 45000, { selection: "choose_one", selection_group: "Stair nosing" })]);
const alt = v("v2", "Alternate 1", [line("b", 150000)]);
const snapshot = buildSnapshot({ number: "Q-26-041-R1", date: "2026-11-22", validityDays: 30, presentation: "itemised", preparedBy: { name: "Dan", email: "dan@bmdmaterials.com" }, project: { name: "Hyatt", number: "26-041", address: null }, client: { name: "Kothari Group", address: null }, inclusions: [], exclusions: [], clarifications: [], deposit: null, versions: [base, alt], rates });
const quote = { id: "q1", number: "Q-26-041-R1", kind: "quote" as const, status: "sent" as const, revision: 1, snapshot };
const good = { versionId: "v1", choices: { opt: "no", g1: "no", g2: "yes" } as const, revision: 1, name: "Pat Client", email: "pat@example.com" };
// Base with nosing g2 and no option: 100000 + 45000 = 145000, GST 7250.
const total = 152250;

describe("publicView", () => {
  test("what the client's browser receives carries no cost, markup, margin, supplier or internal field", () => {
    const view = publicView(quote, { choices: { opt: "maybe" } }, null);
    const keys: string[] = [];
    const walk = (o: unknown) => {
      if (o && typeof o === "object") for (const [k, val] of Object.entries(o)) (keys.push(k), walk(val));
    };
    walk(view);
    expect(keys.filter((k) => /cost|markup|margin|supplier|internal|note|rollup/i.test(k))).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/Acme|internal note/);
    expect(view).toMatchObject({ state: "open", number: "Q-26-041-R1", revision: 1, choices: { opt: "maybe" } });
  });
  test("a replaced, declined or draft quote shows a notice and no prices", () => {
    expect(publicView({ ...quote, status: "superseded" }, { choices: {} }, null)).toEqual({ state: "replaced", number: "Q-26-041-R1" });
    expect(publicView({ ...quote, status: "declined" }, { choices: {} }, null)).toEqual({ state: "closed", number: "Q-26-041-R1" });
    expect(publicView({ ...quote, status: "draft" }, { choices: {} }, null)).toEqual({ state: "closed", number: "Q-26-041-R1" });
  });
  test("an accepted quote shows who accepted and what, and can no longer be changed", () => {
    const view = publicView({ ...quote, status: "accepted" }, { choices: good.choices }, { name: "Pat Client", accepted_at: "2026-11-23T15:00:00Z", version_id: "v1", total_cents: total });
    expect(view).toMatchObject({ state: "accepted", accepted: { name: "Pat Client", at: "2026-11-23T15:00:00Z", versionId: "v1", totalCents: total } });
  });
});

describe("cleanChoices", () => {
  test("keeps only yes, no or maybe for lines the client is allowed to decide", () => {
    expect(cleanChoices(snapshot, { opt: "maybe", g1: "yes", a: "no", ghost: "yes", g2: "perhaps", b: "no" })).toEqual({ opt: "maybe", g1: "yes" });
  });
});

describe("checkAcceptance", () => {
  test("accepts resolved choices and returns the price before GST and the total the client saw", () => {
    expect(checkAcceptance(quote, { ...good, expectedTotalCents: total })).toEqual({ ok: true, versionId: "v1", valueCents: 145000, totalCents: total, choices: { opt: "no", g1: "no", g2: "yes" } });
  });
  test("a Maybe item is left out of the total and must be decided before accepting", () => {
    const r = checkAcceptance(quote, { ...good, choices: { ...good.choices, opt: "maybe" }, expectedTotalCents: total });
    expect(r).toEqual({ ok: false, message: "Please choose Yes or No for: Line opt." });
    expect(checkAcceptance(quote, { ...good, choices: { g2: "yes" }, expectedTotalCents: total })).toEqual({ ok: false, message: "Please choose Yes or No for: Line opt." });
  });
  test("a choose-one group needs exactly one choice and counts exactly one", () => {
    expect(checkAcceptance(quote, { ...good, choices: { opt: "no" }, expectedTotalCents: total })).toEqual({ ok: false, message: "Please choose one option for: Stair nosing." });
    expect(checkAcceptance(quote, { ...good, choices: { opt: "no", g1: "yes", g2: "yes" }, expectedTotalCents: total })).toEqual({ ok: false, message: "Please choose one option for: Stair nosing." });
    expect(checkAcceptance(quote, { ...good, choices: { opt: "yes", g1: "yes", g2: "no" }, expectedTotalCents: 157500 })).toMatchObject({ ok: true, valueCents: 150000 });
  });
  test("a total that differs from the stored quote is refused with a reload", () => {
    expect(checkAcceptance(quote, { ...good, expectedTotalCents: total - 1 })).toEqual({ ok: false, reload: true, message: "The price on this page is out of date. Reload the page and review it again." });
  });
  test("a superseded revision, an already answered quote or an unknown option is refused", () => {
    expect(checkAcceptance({ ...quote, status: "superseded" }, { ...good, expectedTotalCents: total })).toMatchObject({ ok: false, reload: true });
    expect(checkAcceptance(quote, { ...good, revision: 0, expectedTotalCents: total })).toMatchObject({ ok: false, reload: true });
    expect(checkAcceptance({ ...quote, status: "accepted" }, { ...good, expectedTotalCents: total })).toMatchObject({ ok: false, reload: true });
    expect(checkAcceptance(quote, { ...good, versionId: "nope", expectedTotalCents: total })).toEqual({ ok: false, message: "Choose which option you are accepting." });
  });
  test("a name and a real email address are required", () => {
    expect(checkAcceptance(quote, { ...good, name: " ", expectedTotalCents: total })).toEqual({ ok: false, message: "Type your full name to accept." });
    expect(checkAcceptance(quote, { ...good, email: "pat@", expectedTotalCents: total })).toEqual({ ok: false, message: "Enter your email address." });
  });
  test("the second option has nothing to choose and accepts as it stands", () => {
    expect(checkAcceptance(quote, { ...good, versionId: "v2", choices: {}, expectedTotalCents: 157500 })).toMatchObject({ ok: true, valueCents: 150000, totalCents: 157500 });
  });
});

describe("tokens", () => {
  test("a link token is long and random, and only its hash is stored", async () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
    expect(await hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(a)).toBe(await hashToken(a));
    expect(await hashToken(a)).not.toContain(a);
  });
});

describe("review fixes: expiry", () => {
  test("a quote past its validity cannot be accepted online and the page says so", () => {
    // Dated 2026-11-22, valid 30 days: the last day is 2026-12-22.
    expect(checkAcceptance(quote, { ...good, expectedTotalCents: total }, "2026-12-22")).toMatchObject({ ok: true });
    expect(checkAcceptance(quote, { ...good, expectedTotalCents: total }, "2026-12-23")).toEqual({ ok: false, message: "This quotation expired on December 22, 2026. Please contact us for a current price." });
    expect(publicView(quote, { choices: {} }, null, "2026-12-23")).toMatchObject({ state: "open", expired: true });
    expect(publicView(quote, { choices: {} }, null, "2026-11-30")).toMatchObject({ expired: false });
  });
});
