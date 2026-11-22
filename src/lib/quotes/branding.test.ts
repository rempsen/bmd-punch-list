import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicQuote } from "@/components/quotes/PublicQuote";
import { simpleComponent } from "@/lib/estimating/assemble";
import type { EstLine, EstVersion } from "@/lib/estimating/data";
import { brandingFrom, checkLogo, companyLines, DEFAULT_BRANDING, fitLogo, isHeadingLine } from "./branding";
import { snapshotFingerprint } from "./load";
import { buildSnapshot } from "./logic";
import { renderQuotePdf } from "./pdf";
import { publicView } from "./public";

const rates = { pstPct: 7, gstPct: 5, hstPct: 13 };
const line = (id: string, sell: number): EstLine => ({
  id, version_id: "v1", section: "Level 2", finish_id: null, kind: "lump_sum", description: `Line ${id}`, driver_qty: 1, driver_uom: "LS", source: "manual", waste_pct: 0, markup_pct: 30,
  price_basis: "fixed_sell", margin_pct: null, fixed_sell_cents: sell, cost_code: "01-05", tax_code: "GST", notes: "internal note", sort_order: 1, selection: "required",
  selection_group: null, is_allowance: false, subject_to_measure: false, takeoff_condition_id: null, detached: false, row_version: 1, components: [simpleComponent("Acme Supply cost", 1000, "LS")],
});
const base: EstVersion = { id: "v1", project_id: "p", kind: "estimate", co_number: null, name: "Base", description: null, default_markup_pct: 30, sort_order: 1, is_base: true, locked: false, status: "draft", lines: [line("a", 100000)] };
const head = { number: "Q-26-041-R0", date: "2026-11-22", validityDays: 30, presentation: "by_section" as const, preparedBy: { name: "Dan Rosenblat", email: "dan@example.test" }, project: { name: "Hyatt Centric", number: "26-041", address: null }, client: { name: "Kothari Group", address: "141 Brunel Road" }, inclusions: [], exclusions: [], clarifications: [], deposit: null, versions: [base], rates };
const branding = brandingFrom({
  company_name: "Test Flooring Co", office_address: "10 Office Street, Winnipeg, MB", mailing_address: "PO Box 1, Winnipeg, MB", phone: "204-555-0100", email: "office@example.test", website: "example.test", gst_number: "123456789 RT0001",
  footer_text: "Thank you for the opportunity to quote.", default_notes: "", short_terms: ["Net 30 days."], terms_title: "Standard Terms and Conditions", terms_text: "1. PAYMENT\nInvoices are due on receipt.\n\n2. WARRANTY\nWorkmanship is warranted as stated.",
});
const pdfText = (snap: ReturnType<typeof buildSnapshot>, opts = {}) => renderQuotePdf(snap, { compress: false, ...opts });

describe("company details on a quote", () => {
  test("with nothing set up, a quote carries BMD's name, mailing address and email, the usual short terms and no conditions page", () => {
    const s = buildSnapshot(head);
    expect(s.company).toMatchObject({ name: "BMD Materials", mailing: DEFAULT_BRANDING.mailingAddress, email: "office@bmdmaterials.com", office: "" });
    expect(s.terms[0]).toBe("This quotation is valid for 30 days from its date.");
    expect(s.terms).toContain("Overdue accounts are charged interest at 2% per month.");
    expect(s.conditions).toBeNull();
    expect(pdfText(s).getNumberOfPages()).toBe(1);
  });
  test("the saved company details, notes, attention line and short terms are frozen into the quote", () => {
    const s = buildSnapshot({ ...head, deposit: "50% on order", branding, attention: "Pat Lee", remarks: "Night work only.\nElevator booked by others." });
    expect(s.company).toEqual({ name: "Test Flooring Co", office: "10 Office Street, Winnipeg, MB", mailing: "PO Box 1, Winnipeg, MB", phone: "204-555-0100", email: "office@example.test", website: "example.test", gstNumber: "123456789 RT0001" });
    expect(s.attention).toBe("Pat Lee");
    expect(s.remarks).toBe("Night work only.\nElevator booked by others.");
    expect(s.footer).toBe("Thank you for the opportunity to quote.");
    expect(s.terms).toEqual(["This quotation is valid for 30 days from its date.", "Deposit: 50% on order", "Net 30 days."]);
    expect(s.conditions).toEqual({ title: "Standard Terms and Conditions", text: branding.termsText });
  });
  test("office and mailing addresses are labelled when both are given, and one address stands alone", () => {
    expect(companyLines({ name: "X", office: "10 Office Street", mailing: "PO Box 1", phone: "204-555-0100", email: "a@b.c", website: "", gstNumber: "123 RT0001" })).toEqual(["Office: 10 Office Street", "Mailing: PO Box 1", "204-555-0100 · a@b.c", "GST No. 123 RT0001"]);
    expect(companyLines({ name: "X", office: "", mailing: "PO Box 1", phone: "", email: "a@b.c", website: "", gstNumber: "" })).toEqual(["PO Box 1", "a@b.c"]);
  });
  test("blank or missing settings fall back to the defaults field by field", () => {
    const b = brandingFrom({ company_name: "  ", office_address: " 10 Office Street ", short_terms: ["", " Net 30. "], terms_text: null });
    expect(b.companyName).toBe("BMD Materials");
    expect(b.officeAddress).toBe("10 Office Street");
    expect(b.shortTerms).toEqual(["Net 30."]);
    expect(b.termsText).toBe("");
    expect(brandingFrom(null)).toEqual(DEFAULT_BRANDING);
  });
});

describe("the printed quote", () => {
  const snap = buildSnapshot({ ...head, branding, attention: "Pat Lee", remarks: "Night work only." });
  test("prints both addresses, phone, GST number, the attention line and the notes", () => {
    const text = pdfText(snap).output();
    for (const want of ["Office: 10 Office Street, Winnipeg, MB", "Mailing: PO Box 1, Winnipeg, MB", "204-555-0100", "GST No. 123456789 RT0001", "Attention: Pat Lee", "Night work only.", "Net 30 days."]) expect(text).toContain(want);
  });
  test("the standard terms and conditions print on their own page straight after the quote, with their title and the client's name", () => {
    const doc = pdfText(snap);
    expect(doc.getNumberOfPages()).toBe(2);
    const pages = doc.output().split("/Type /Page\n").length;
    expect(pages).toBeGreaterThan(2);
    const text = doc.output();
    expect(text).toContain("Standard Terms and Conditions");
    expect(text).toContain("Invoices are due on receipt.");
    expect(text).toContain("2. WARRANTY");
    expect(text).toContain("attached Standard Terms and Conditions");
    expect(text.indexOf("Standard Terms and Conditions", text.indexOf("Signature"))).toBeGreaterThan(-1);
  });
  test("the footer wording is on every page of the quote and its conditions", () => {
    const text = pdfText(snap).output();
    expect(text.split("Thank you for the opportunity to quote.").length - 1).toBe(2);
    expect(text).toContain("Page 2 of 2");
    expect(text).toContain("Q-26-041-R0 · Test Flooring Co");
  });
  test("drawings still follow the conditions page", () => {
    const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
    expect(pdfText(snap, { drawings: [{ dataUrl: JPEG, width: 1800, height: 1200, title: "ID-201" }] }).getNumberOfPages()).toBe(3);
  });
  test("changing the conditions or the company details changes the fingerprint, so a stale preview cannot be sent", () => {
    const other = buildSnapshot({ ...head, branding: { ...branding, termsText: "Different." }, attention: "Pat Lee", remarks: "Night work only." });
    expect(snapshotFingerprint(other)).not.toBe(snapshotFingerprint(snap));
    expect(snapshotFingerprint(buildSnapshot({ ...head, branding: { ...branding, phone: "204-555-0199" }, attention: "Pat Lee", remarks: "Night work only." }))).not.toBe(snapshotFingerprint(snap));
  });
  test("a quote sent before these settings existed still prints", () => {
    const { company: _c, footer: _f, remarks: _n, attention: _a, conditions: _t, ...old } = snap;
    const text = renderQuotePdf(old as never, { compress: false }).output();
    expect(text).toContain("office@bmdmaterials.com");
  });
});

describe("logo", () => {
  test("a logo keeps its shape inside the space allowed", () => {
    expect(fitLogo(800, 200, 170, 54)).toEqual({ width: 170, height: 42.5 });
    expect(fitLogo(200, 400, 170, 54)).toEqual({ width: 27, height: 54 });
    expect(fitLogo(0, 0, 170, 54)).toEqual({ width: 110, height: 40 });
  });
  test("only a PNG or JPEG of a sensible size is accepted", () => {
    expect(checkLogo("data:image/png;base64,AAAA")).toBeNull();
    expect(checkLogo("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(checkLogo("data:image/svg+xml;base64,AAAA")).toMatch(/PNG or JPEG/);
    expect(checkLogo(`data:image/png;base64,${"A".repeat(300_001)}`)).toMatch(/too large/);
  });
});

describe("conditions text", () => {
  test("a line in capitals, numbered or not, is a heading; ordinary sentences are not", () => {
    expect(isHeadingLine("1. PAYMENT")).toBe(true);
    expect(isHeadingLine("LIMITATION OF LIABILITY")).toBe(true);
    expect(isHeadingLine("Invoices are due on receipt.")).toBe(false);
    expect(isHeadingLine("GST")).toBe(true);
    expect(isHeadingLine("")).toBe(false);
  });
});

describe("the client's page", () => {
  test("shows the company details, the notes, the conditions and the footer, with the uploaded logo", () => {
    const snap = buildSnapshot({ ...head, branding, attention: "Pat Lee", remarks: "Night work only." });
    const view = publicView({ number: snap.number, status: "sent", revision: 0, snapshot: snap }, { choices: {} }, null, "2026-11-23");
    const html = renderToStaticMarkup(createElement(PublicQuote, { view, logo: "data:image/png;base64,AAAA", onSave: () => undefined, onAccept: async () => ({ ok: true as const }) }));
    for (const want of ["Office: 10 Office Street, Winnipeg, MB", "GST No. 123456789 RT0001", "Attention: Pat Lee", "Night work only.", "Standard Terms and Conditions", "Invoices are due on receipt.", "Thank you for the opportunity to quote.", "data:image/png;base64,AAAA", "Test Flooring Co"]) expect(html).toContain(want);
    expect(html).not.toContain("/bmd-logo.png");
  });
});
