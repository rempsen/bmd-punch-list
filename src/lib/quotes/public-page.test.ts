import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicQuote } from "@/components/quotes/PublicQuote";
import { simpleComponent } from "@/lib/estimating/assemble";
import type { EstLine, EstVersion } from "@/lib/estimating/data";
import { buildSnapshot } from "./logic";
import { renderQuotePdf } from "./pdf";
import { publicView } from "./public";

const rates = { pstPct: 7, gstPct: 5, hstPct: 13 };
const line = (id: string, sell: number, o: Partial<EstLine> = {}): EstLine => ({
  id, version_id: "v1", section: "Level 2", finish_id: null, kind: "lump_sum", description: `Line ${id}`, driver_qty: 1, driver_uom: "LS", source: "manual", waste_pct: 0, markup_pct: 30,
  price_basis: "fixed_sell", margin_pct: null, fixed_sell_cents: sell, cost_code: "01-05", tax_code: "GST", notes: "internal note", sort_order: 1, selection: "required",
  selection_group: null, is_allowance: false, subject_to_measure: false, takeoff_condition_id: null, detached: false, row_version: 1, components: [simpleComponent("Acme Supply cost", 1000, "LS")], ...o,
});
const base: EstVersion = { id: "v1", project_id: "p", kind: "estimate", co_number: null, name: "Base", description: null, default_markup_pct: 30, sort_order: 1, is_base: true, locked: true, status: "sent", lines: [line("a", 100000), line("opt", 20000, { selection: "optional" })] };
const snapshot = buildSnapshot({ number: "Q-26-041-R1", date: "2026-11-22", validityDays: 30, presentation: "by_section", preparedBy: { name: "Dan Rosenblat", email: "dan@bmdmaterials.com" }, project: { name: "Hyatt Centric", number: "26-041", address: null }, client: { name: "Kothari Group", address: null }, inclusions: ["Supply and install"], exclusions: [], clarifications: [], deposit: null, versions: [base], rates });
const quote = { number: "Q-26-041-R1", status: "sent" as const, revision: 1, snapshot };
const noop = { onSave: () => undefined, onAccept: async () => ({ ok: true as const }) };

describe("the client's quote page", () => {
  test("shows the price, the choices and the acceptance form, and nothing internal", () => {
    const html = renderToStaticMarkup(createElement(PublicQuote, { view: publicView(quote, { choices: { opt: "maybe" } }, null), ...noop }));
    expect(html).toContain("Q-26-041-R1");
    expect(html).toContain("Kothari Group");
    expect(html).toContain("$1,050.00"); // 1,000 + GST; the Maybe item is left out
    expect(html).toContain("Items marked Maybe ($200.00 before GST) are not in this total.");
    expect(html).toContain("Accept quotation");
    expect(html).not.toMatch(/Acme|internal note|markup|margin/i);
  });
  test("an accepted quote shows who accepted and offers nothing more to do", () => {
    const html = renderToStaticMarkup(createElement(PublicQuote, { view: publicView({ ...quote, status: "accepted" }, { choices: { opt: "no" } }, { name: "Pat Client", accepted_at: "2026-11-23T18:00:00Z", version_id: "v1", total_cents: 10500000 }), ...noop }));
    expect(html).toContain("Accepted by Pat Client");
    expect(html).not.toContain("Accept quotation");
  });
  test("a replaced quote shows a notice and no prices", () => {
    const html = renderToStaticMarkup(createElement(PublicQuote, { view: publicView({ ...quote, status: "superseded" }, { choices: {} }, null), ...noop }));
    expect(html).toContain("replaced by a newer one");
    expect(html).not.toContain("$");
  });
});

describe("acceptance record PDF", () => {
  test("names who accepted, when, which option and the total, on the frozen quote", () => {
    const text = renderQuotePdf(snapshot, { compress: false, acceptance: { name: "Pat Client", email: "pat@example.com", at: "2026-11-23T18:00:00Z", versionId: "v1", choices: { opt: "yes" }, totalCents: 126000 } }).output();
    expect(text).toContain("Accepted electronically by Pat Client");
    expect(text).toContain("pat@example.com");
    expect(text).toContain("November 23, 2026");
    expect(text).toContain("1,260.00");
    expect(text).toContain("Line opt: Yes");
    expect(text).not.toContain("Signature");
  });
});
