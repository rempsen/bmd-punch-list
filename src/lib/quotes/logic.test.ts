import { describe, expect, test } from "bun:test";
import { simpleComponent } from "@/lib/estimating/assemble";
import type { EstLine, EstVersion } from "@/lib/estimating/data";
import { buildSnapshot, contractValue, issueQuoteFlow, quoteNumber, rollupByCostCode, snapshotTotals, unknownCostLabels, type IssueDeps } from "./logic";
import { renderQuotePdf } from "./pdf";

const rates = { pstPct: 7, gstPct: 5, hstPct: 13 };
const line = (id: string, o: Partial<EstLine>): EstLine => ({
  id, version_id: "v1", section: "Level 2", finish_id: null, kind: "lump_sum", description: "Line", driver_qty: 1, driver_uom: "LS", source: "manual", waste_pct: 0, markup_pct: 30,
  price_basis: "markup", margin_pct: null, fixed_sell_cents: null, cost_code: "01-05", tax_code: "GST", notes: "internal note: squeeze the installer", sort_order: 1, selection: "required",
  selection_group: null, is_allowance: false, subject_to_measure: false, takeoff_condition_id: null, detached: false, row_version: 1, components: [simpleComponent("Acme Flooring Supply plank", 471711, "LS")], ...o,
});
const version = (id: string, name: string, lines: EstLine[]): EstVersion => ({ id, project_id: "p", kind: "estimate", co_number: null, name, description: null, default_markup_pct: 30, sort_order: 1, is_base: id === "v1", locked: false, status: "draft", lines: lines.map((l) => ({ ...l, version_id: id })) });
// LVP 1000 SF: cost 4,717.11 → sell 6,132.24. Windows 40 EA: cost 15,548.00 at 35% → sell 20,989.80.
const base = version("v1", "Base", [
  line("a", { description: "LVP-1 – Guest room plank", driver_qty: 1000, driver_uom: "SF", components: [simpleComponent("Acme Flooring Supply plank", 471.711, "SF")].map((c) => ({ ...c, unit_cost_cents: 471711 / 1000 })) }),
  line("b", { section: "Window coverings", description: "W1 – Roller shade", driver_qty: 40, driver_uom: "EA", markup_pct: 35, cost_code: "02-100", components: [simpleComponent("Graber roller", 38870, "EA")] }),
]);
const head = { number: "Q-26-041-R0", date: "2026-11-22", validityDays: 30, presentation: "itemised" as const, preparedBy: { name: "Dan Rosenblat", email: "dan@bmdmaterials.com" }, project: { name: "Hyatt Centric", number: "26-041", address: "325 Broadway, Winnipeg, MB" }, client: { name: "Kothari Group", address: "141 Brunel Road, Mississauga, ON" }, inclusions: ["Supply and install as listed"], exclusions: ["Floor levelling beyond 1/8 in."], clarifications: [], deposit: null };

describe("quoteNumber", () => {
  test("quotes are Q-{project number}-R{revision}; change orders are CO-{n}", () => {
    expect(quoteNumber("quote", "26-001", null, 0)).toBe("Q-26-001-R0");
    expect(quoteNumber("quote", "26-001", null, 1)).toBe("Q-26-001-R1");
    expect(quoteNumber("change_order", "26-001", 1, 0)).toBe("CO-1");
    expect(quoteNumber("change_order", "26-001", 1, 2)).toBe("CO-1-R2");
  });
});

describe("buildSnapshot", () => {
  const snap = buildSnapshot({ ...head, versions: [base], rates });
  test("carries selling figures that match the worksheet", () => {
    const v = snap.versions[0]!;
    expect(v.subtotalCents).toBe(613224 + 2098980);
    expect(v.taxCents).toBe(135610);
    expect(v.totalCents).toBe(2847814);
    expect(v.sections.map((s) => [s.name, s.subtotalCents])).toEqual([["Level 2", 613224], ["Window coverings", 2098980]]);
    expect(v.sections[0]!.lines[0]).toMatchObject({ description: "LVP-1 – Guest room plank", qty: 1000, uom: "SF", sellCents: 613224, unitPriceCents: 613 });
  });
  test("contains nothing internal: no costs, markups, margins, suppliers or notes anywhere", () => {
    const text = JSON.stringify(snap);
    const keys: string[] = [];
    JSON.stringify(snap, (k, v) => (keys.push(k), v));
    expect(keys.filter((k) => /cost|markup|margin|supplier|internal|note/i.test(k))).toEqual([]);
    for (const secret of ["Acme", "Graber", "squeeze", "471711", "38870", "1554800", "4717"]) expect(text).not.toContain(secret);
  });
  test("lines with an unknown cost are named so the quote can be held back", () => {
    const v = version("v1", "Base", [line("x", { description: "Install", components: [simpleComponent("Install labour", null, "LS")] }), line("y", { description: "Not needed", components: [{ ...simpleComponent("Adhesive", null, "LS"), not_applicable: true }] })]);
    expect(unknownCostLabels([v], rates)).toEqual(["Base: Install (Install labour)"]);
  });
});

describe("snapshotTotals", () => {
  const v = version("v1", "Base", [
    line("r", { components: [simpleComponent("x", 100000, "LS")] }),
    line("o", { description: "Upgrade underlay", selection: "optional", components: [simpleComponent("x", 50000, "LS")] }),
    line("g1", { selection: "choose_one", selection_group: "base", description: "Rubber base", components: [simpleComponent("x", 10000, "LS")] }),
    line("g2", { selection: "choose_one", selection_group: "base", description: "Millwork base", components: [simpleComponent("x", 30000, "LS")] }),
  ]);
  const sv = buildSnapshot({ ...head, versions: [v], rates }).versions[0]!;
  test("the issued total counts required lines and the default pick of each choose-one group", () => {
    expect(sv.subtotalCents).toBe(130000 + 13000);
    expect(snapshotTotals(sv, {}, rates).subtotalCents).toBe(sv.subtotalCents);
  });
  test("yes adds an option, maybe is shown apart and not charged, and a group counts exactly one member", () => {
    expect(snapshotTotals(sv, { o: "yes", g2: "yes" }, rates).subtotalCents).toBe(130000 + 65000 + 39000);
    const maybe = snapshotTotals(sv, { o: "maybe" }, rates);
    expect(maybe.subtotalCents).toBe(143000);
    expect(maybe.maybeCents).toBe(65000);
    expect(snapshotTotals(sv, { g1: "yes", g2: "yes" }, rates).subtotalCents).toBe(143000);
  });
});

describe("rollupByCostCode", () => {
  test("each line posts whole under its own cost code; amounts sum to the subtotal", () => {
    const r = rollupByCostCode(base, rates);
    expect(r.lines).toEqual([{ costCode: "01-05", amountCents: 613224, taxCode: "GST" }, { costCode: "02-100", amountCents: 2098980, taxCode: "GST" }]);
    expect(r.subtotalCents).toBe(2712204);
    expect(r.totalCents).toBe(2847814);
  });
});

describe("contractValue", () => {
  test("original contract plus accepted change orders; pending and declined are listed but not counted", () => {
    const v = contractValue([
      { kind: "quote", status: "superseded", accepted_value_cents: null, number: "Q-26-041-R0" },
      { kind: "quote", status: "accepted", accepted_value_cents: 2847814, number: "Q-26-041-R1" },
      { kind: "change_order", status: "accepted", accepted_value_cents: 420000, number: "CO-1" },
      { kind: "change_order", status: "sent", accepted_value_cents: null, number: "CO-2", value_cents: 99900 },
      { kind: "change_order", status: "declined", accepted_value_cents: null, number: "CO-3", value_cents: 5000 },
      { kind: "change_order", status: "accepted", accepted_value_cents: -150000, number: "CO-4" },
    ]);
    expect(v).toEqual({ originalCents: 2847814, changeOrdersCents: 270000, currentCents: 3117814, pendingCents: 99900 });
  });
});

describe("issueQuoteFlow", () => {
  const make = (over: Partial<IssueDeps> = {}) => {
    const calls: string[] = [];
    const deps: IssueDeps = {
      check: async () => (calls.push("check"), null),
      sendMail: async () => (calls.push("send"), { ok: true }),
      fileDocument: async () => (calls.push("file"), "doc-1"),
      issue: async () => void calls.push("issue"),
      ...over,
    };
    return { deps, calls };
  };
  const input = { quoteId: "q1", pdf: new Uint8Array([37, 80, 68, 70]), fileName: "Q-26-041-R0 – Hyatt Centric – 2026-11-22.pdf", snapshot: {} as never, email: { to: ["gc@example.com"], cc: [], subject: "Quote", html: "<p>Attached</p>" } };

  test("sends, files the PDF, then records the quote as sent", async () => {
    const { deps, calls } = make();
    expect(await issueQuoteFlow(deps, input)).toEqual({ ok: true, documentId: "doc-1" });
    expect(calls).toEqual(["check", "send", "file", "issue"]);
  });
  test("when Outlook needs reconnecting nothing is filed and the quote stays a draft", async () => {
    const { deps, calls } = make({ sendMail: async () => ({ ok: false, reason: "reconnect", message: "Reconnect Outlook" }) });
    expect(await issueQuoteFlow(deps, input)).toEqual({ ok: false, reason: "reconnect", message: "Reconnect Outlook" });
    expect(calls).toEqual(["check"]);
  });
  test("a quote that cannot be issued is refused before any email goes out", async () => {
    const { deps, calls } = make({ check: async () => "Enter or mark not needed: Base: Install (Install labour)" });
    expect(await issueQuoteFlow(deps, input)).toEqual({ ok: false, reason: "error", message: "Enter or mark not needed: Base: Install (Install labour)" });
    expect(calls).toEqual([]);
  });
  test("without an email (download only) it files and records without sending", async () => {
    const { deps, calls } = make();
    await issueQuoteFlow(deps, { ...input, email: null });
    expect(calls).toEqual(["check", "file", "issue"]);
  });
  test("if recording fails after the email went out, the message says so plainly", async () => {
    const { deps } = make({ issue: async () => { throw new Error("db down"); } });
    const res = await issueQuoteFlow(deps, input);
    expect(res).toEqual({ ok: false, reason: "error", message: "The email was sent, but the quote could not be marked as sent (db down). Do not send it again; use Mark as sent." });
  });
});

describe("quote PDF", () => {
  const alt = version("v2", "Alternate 1 – porcelain", [line("c", { description: "PT-1 – Porcelain tile", driver_qty: 1000, driver_uom: "SF", components: [simpleComponent("Olympia porcelain", 900, "SF")] })]);
  const text = (presentation: "lump_sum" | "by_section" | "itemised", versions = [base]) =>
    renderQuotePdf(buildSnapshot({ ...head, presentation, versions, rates }), { compress: false }).output();

  test("shows the selling total and client details, and never cost, markup or supplier", () => {
    const pdf = text("itemised");
    for (const shown of ["Q-26-041-R0", "Kothari Group", "Hyatt Centric", "28,478.14", "27,122.04", "1,356.10", "6,132.24", "LVP-1", "Prepared by Dan Rosenblat", "office@bmdmaterials.com", "PO Box 69031"]) expect(pdf).toContain(shown);
    for (const hidden of ["20,265.11", "4,717.11", "15,548.00", "Acme", "Graber", "Markup", "markup", "35%", "30%", "Margin", "squeeze"]) expect(pdf).not.toContain(hidden);
  });
  test("lump sum shows one price with no line amounts; by section shows section subtotals", () => {
    const lump = text("lump_sum");
    expect(lump).toContain("28,478.14");
    expect(lump).not.toContain("6,132.24");
    const bySection = text("by_section");
    expect(bySection).toContain("20,989.80");
    expect(bySection).toContain("Window coverings");
  });
  test("standing terms are printed", () => {
    const pdf = text("lump_sum");
    expect(pdf).toContain("2% per month");
    expect(pdf).toContain("one year");
    expect(pdf).toContain("30 days");
  });
  test("several prices appear in one side-by-side options table", () => {
    const pdf = text("by_section", [base, alt]);
    expect(pdf).toContain("Options");
    expect(pdf).toContain("Alternate 1");
    expect(pdf).toContain("28,478.14");
    expect(pdf).toContain(((Math.round(Math.round(900 * 1000) * 1.3) * 1.05) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 }));
  });
});

import { quoteFileName, snapshotFingerprint } from "./load";
describe("quote file name and fingerprint", () => {
  test("the file name uses plain hyphens (browsers drop a name with a long dash) and no characters a folder refuses", () => {
    expect(quoteFileName("Q-26-041-R0", 'Hyatt: Centric / "Tower"', "2026-11-22")).toBe("Q-26-041-R0 - Hyatt Centric Tower - 2026-11-22.pdf");
  });
  test("the fingerprint changes when a price changes, so a stale preview cannot be sent", () => {
    const a = buildSnapshot({ ...head, versions: [base], rates });
    const b = buildSnapshot({ ...head, versions: [{ ...base, lines: base.lines.map((l) => ({ ...l, markup_pct: l.markup_pct + 1 })) }], rates });
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(buildSnapshot({ ...head, versions: [base], rates })));
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b));
  });
});

describe("review fixes: quotes", () => {
  test("a line with no margin or no selling price set is named as a blocker, not quoted at cost or at zero", () => {
    const v = version("v1", "Base", [line("m", { description: "Margin line", price_basis: "margin", margin_pct: null }), line("f", { description: "Fixed line", price_basis: "fixed_sell", fixed_sell_cents: null }), line("ok", {})]);
    expect(unknownCostLabels([v], rates)).toEqual(["Base: Margin line (no margin set)", "Base: Fixed line (no selling price set)"]);
  });
  test("the fingerprint changes when any client-visible wording changes, not only the totals", () => {
    const a = buildSnapshot({ ...head, exclusions: ["Floor levelling beyond 1/8 in."], versions: [base], rates });
    const b = buildSnapshot({ ...head, exclusions: ["Floor levelling beyond 1/4 in."], versions: [base], rates });
    const c = buildSnapshot({ ...head, versions: [{ ...base, lines: base.lines.map((l, i) => (i === 0 ? { ...l, description: "Different words" } : l)) }], rates });
    const d = buildSnapshot({ ...head, date: "2026-12-25", preparedBy: { name: "Brian", email: "b@x.y" }, versions: [base], rates });
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b));
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(c));
    expect(snapshotFingerprint(buildSnapshot({ ...head, versions: [base], rates }))).toBe(snapshotFingerprint(d));
  });
});

describe("polish: what prints", () => {
  test("a unit price is shown only when it multiplies out exactly; otherwise the line shows its amount alone", () => {
    const v = version("v1", "Base", [line("x", { description: "Three of something", driver_qty: 3, driver_uom: "EA", price_basis: "fixed_sell", fixed_sell_cents: 10000 }), line("y", { description: "Four of something", driver_qty: 4, driver_uom: "EA", price_basis: "fixed_sell", fixed_sell_cents: 10000 })]);
    const snap = buildSnapshot({ ...head, presentation: "itemised", versions: [v], rates });
    expect(snap.versions[0]!.sections[0]!.lines.map((l) => [l.unitPriceCents, l.unitPriceExact])).toEqual([[3333, false], [2500, true]]);
    const text = renderQuotePdf(snap, { compress: false }).output();
    expect(text).toContain("@ $25.00");
    expect(text).toContain("about $33.33 per EA");
    expect(text).not.toContain("@ $33.33");
  });
  test("an acceptance record shows the totals for what the client chose, not the default selection", () => {
    const v = version("v1", "Base", [line("a", { price_basis: "fixed_sell", fixed_sell_cents: 100000 }), line("opt", { description: "Optional extra", price_basis: "fixed_sell", fixed_sell_cents: 20000, selection: "optional" })]);
    const snap = buildSnapshot({ ...head, versions: [v], rates });
    const text = renderQuotePdf(snap, { compress: false, acceptance: { name: "Pat", email: "p@x.y", at: "2026-11-23T18:00:00Z", versionId: "v1", choices: { opt: "yes" }, totalCents: 126000 } }).output();
    expect(text).toContain("1,200.00"); // subtotal with the option taken
    expect(text).toContain("1,260.00");
    expect(text).not.toContain("1,050.00"); // the default total, without the option
  });
});

import { displayFor, layoutVersion, normalizeDisplay } from "./logic";
describe("what a quote shows", () => {
  const carpetA = line("c1", { section: "Level 2", description: "CPT-1 corridor carpet", driver_qty: 100, driver_uom: "SY", price_basis: "fixed_sell", fixed_sell_cents: 500000 });
  const carpetB = line("c2", { section: "Level 3", description: "CPT-1 corridor carpet", driver_qty: 50, driver_uom: "SY", price_basis: "fixed_sell", fixed_sell_cents: 250000 });
  const tile = line("t1", { section: "Level 2", description: "PT-1 lobby tile", driver_qty: 400, driver_uom: "SF", price_basis: "fixed_sell", fixed_sell_cents: 800000 });
  const prep = line("p1", { section: "Level 2", description: "Floor prep", driver_qty: 1, driver_uom: "LS", price_basis: "fixed_sell", fixed_sell_cents: 100000 });
  const opt = line("o1", { section: "Level 3", description: "Stair nosing", driver_qty: 20, driver_uom: "LF", price_basis: "fixed_sell", fixed_sell_cents: 40000, selection: "optional" });
  const v = version("v1", "Base", [carpetA, tile, prep, carpetB, opt]);
  const materialOf = { c1: "Carpet tile", c2: "Carpet tile", t1: "Floor tile" };
  const snap = (display: Parameters<typeof normalizeDisplay>[0]) => buildSnapshot({ ...head, display: normalizeDisplay(display, "by_section"), materialOf, versions: [v], rates });

  test("the three presets: one lump sum, a subtotal per section, every line priced", () => {
    expect(displayFor("lump_sum")).toEqual({ groupBy: "section", showLines: true, showQuantities: true, showUnitPrices: false, showLineAmounts: false, showGroupSubtotals: false, showAreas: false });
    expect(displayFor("by_section")).toMatchObject({ showGroupSubtotals: true, showLineAmounts: false });
    expect(displayFor("itemised")).toMatchObject({ showUnitPrices: true, showLineAmounts: true, showGroupSubtotals: true });
    expect(normalizeDisplay({ groupBy: "nonsense", showLines: "yes", extra: 1 } as never, "itemised")).toEqual(displayFor("itemised"));
    expect(normalizeDisplay(null, "lump_sum")).toEqual(displayFor("lump_sum"));
  });
  test("grouped by material: all the carpet together with its total quantity and price, tile separately, the rest under other items", () => {
    const s = snap({ groupBy: "material", showLines: true, showQuantities: true, showUnitPrices: false, showLineAmounts: false, showGroupSubtotals: true });
    expect(s.versions[0]!.sections[0]!.lines[0]!.material).toBe("Carpet tile");
    const groups = layoutVersion(s.versions[0]!, s.display);
    expect(groups.map((g) => [g.name, g.quantity, g.subtotalCents])).toEqual([["Carpet tile", "150 SY", 750000], ["Floor tile", "400 SF", 800000], ["Other items", null, 100000]]);
    expect(groups[0]!.lines.map((l) => [l.text, l.amountCents])).toEqual([["CPT-1 corridor carpet · 100 SY", null], ["CPT-1 corridor carpet · 50 SY", null]]);
    // The optional line is not in any subtotal, but always shows its own price so the client can decide.
    expect(groups[2]!.lines.map((l) => [l.text, l.amountCents, l.note])).toEqual([["Floor prep", null, null], ["Stair nosing · 20 LF", 40000, "optional, not in the total"]]);
  });
  test("descriptions only: no quantities, no prices, no subtotals, just the scope and one total", () => {
    const s = snap({ groupBy: "section", showLines: true, showQuantities: false, showUnitPrices: false, showLineAmounts: false, showGroupSubtotals: false });
    const groups = layoutVersion(s.versions[0]!, s.display);
    expect(groups.map((g) => [g.name, g.quantity, g.subtotalCents])).toEqual([["Level 2", null, null], ["Level 3", null, null]]);
    expect(groups[0]!.lines.map((l) => l.text)).toEqual(["CPT-1 corridor carpet", "PT-1 lobby tile", "Floor prep"]);
    const text = renderQuotePdf(s, { compress: false }).output();
    expect(text).not.toContain("100 SY");
    expect(text).not.toContain("5,000.00");
    expect(text).toContain("16,500.00"); // the one total before GST (the optional line is not in it)
  });
  test("totals only: group names and their prices with the lines hidden", () => {
    const s = snap({ groupBy: "material", showLines: false, showQuantities: true, showUnitPrices: false, showLineAmounts: false, showGroupSubtotals: true });
    const groups = layoutVersion(s.versions[0]!, s.display);
    expect(groups.map((g) => g.lines.map((l) => l.text))).toEqual([[], [], ["Stair nosing · 20 LF"]]);
    const text = renderQuotePdf(s, { compress: false }).output();
    expect(text).toContain("Carpet tile");
    expect(text).toContain("7,500.00");
    expect(text).not.toContain("CPT-1 corridor carpet");
  });
  test("fully detailed: quantity, unit price and amount on every line", () => {
    const s = snap(displayFor("itemised"));
    const l = layoutVersion(s.versions[0]!, s.display)[0]!.lines[0]!;
    expect([l.text, l.amountCents]).toEqual(["CPT-1 corridor carpet · 100 SY @ $50.00", 500000]);
  });
});

describe("colour-coded drawings on a quote", () => {
  const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
  test("when drawings are included they are named on the quote and each gets its own page; when they are not, nothing changes", () => {
    const plain = buildSnapshot({ ...head, versions: [base], rates });
    expect(plain.drawings).toEqual([]);
    expect(renderQuotePdf(plain, { compress: false }).getNumberOfPages()).toBe(1);
    const withDrawings = buildSnapshot({ ...head, drawings: ["ID-201 Level 2 Finish Plan", "ID-301"], versions: [base], rates });
    const doc = renderQuotePdf(withDrawings, { compress: false, drawings: [{ dataUrl: JPEG, width: 1800, height: 1200, title: "ID-201 Level 2 Finish Plan" }, { dataUrl: JPEG, width: 1200, height: 1800, title: "ID-301" }] });
    expect(doc.getNumberOfPages()).toBe(3);
    const text = doc.output();
    expect(text).toContain("Colour-coded drawings attached: ID-201 Level 2 Finish Plan, ID-301");
    expect(snapshotFingerprint(plain)).not.toBe(snapshotFingerprint(withDrawings));
  });
});

describe("base broken out by area on a quote", () => {
  const rb = line("rb", { section: "Level 2", description: "RB-1 rubber base", driver_qty: 3016, driver_uom: "LF", price_basis: "fixed_sell", fixed_sell_cents: 900000 });
  const cpt = line("cp", { section: "Level 2", description: "CPT-1 carpet", driver_qty: 100, driver_uom: "SY", price_basis: "fixed_sell", fixed_sell_cents: 500000 });
  const v = version("v1", "Base", [cpt, rb]);
  const areasOf = { rb: [{ label: "Suites", qty: 1248.5 }, { label: "Common areas", qty: 1622.4 }, { label: "Washrooms", qty: 145.1 }] };
  const snap = (showAreas: boolean | undefined, display: Record<string, unknown> = {}) => buildSnapshot({ ...head, presentation: "by_section", display: normalizeDisplay({ ...display, ...(showAreas === undefined ? {} : { showAreas }) }, "by_section"), areasOf, versions: [v], rates });
  const lineOf = (s: ReturnType<typeof snap>, id: string) => layoutVersion(s.versions[0]!, s.display).flatMap((g) => g.lines).find((l) => l.line.id === id)!;

  test("off unless it is switched on: an existing quote is unchanged", () => {
    expect(normalizeDisplay(null, "itemised").showAreas).toBe(false);
    expect(normalizeDisplay({ showAreas: "yes" as never }, "itemised").showAreas).toBe(false);
    const off = snap(undefined);
    expect(off.versions[0]!.sections[0]!.lines.every((l) => l.areas === undefined)).toBe(true);
    expect(lineOf(off, "rb").areas).toBeNull();
    expect(snapshotFingerprint(off)).toBe(snapshotFingerprint(snap(false)));
  });
  test("on: the base line carries its areas and the layout prints them; other lines are untouched", () => {
    const on = snap(true);
    expect(on.display.showAreas).toBe(true);
    expect(on.versions[0]!.sections[0]!.lines.find((l) => l.id === "rb")!.areas).toEqual(areasOf.rb);
    expect(lineOf(on, "rb").areas).toBe("Suites 1,248.5 LF · Common areas 1,622.4 LF · Washrooms 145.1 LF");
    expect(lineOf(on, "cp").areas).toBeNull();
    expect(snapshotFingerprint(on)).not.toBe(snapshotFingerprint(snap(false)));
  });
  test("the total never changes, and the breakdown still prints when quantities are hidden", () => {
    expect(snap(true).versions[0]!.totalCents).toBe(snap(false).versions[0]!.totalCents);
    expect(lineOf(snap(true, { showQuantities: false }), "rb").areas).toContain("Suites 1,248.5 LF");
  });
  test("the PDF prints the breakdown under the line only when it is on", () => {
    const pdf = (s: ReturnType<typeof snap>) => renderQuotePdf(s, { compress: false }).output();
    expect(pdf(snap(true))).toContain("Suites 1,248.5 LF");
    expect(pdf(snap(true))).toContain("Washrooms 145.1 LF");
    expect(pdf(snap(false))).not.toContain("Suites 1,248.5 LF");
  });
});
