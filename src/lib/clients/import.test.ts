import { describe, expect, it } from "bun:test";
import { parseQboCustomers, planClientImport } from "./import";

const rows = (names: string[]) => names.map((n) => ({ Customer: n }));

describe("parseQboCustomers", () => {
  const r = parseQboCustomers(
    rows(["Kothari Group", "Kothari Group:Broadway Hotels Inc:Hyatt Centric", "Towers Realty:321 McDermot - Towers", "kothari group "]),
  );
  it("groups jobs under their parent and de-duplicates parents ignoring case and spaces", () => {
    expect(r.parents.map((p) => p.name)).toEqual(["Kothari Group", "Towers Realty"]);
  });
  it("keeps jobs out of the client list", () => {
    expect(r.jobs.length).toBe(2);
    const hyatt = r.jobs.find((j) => j.name === "Hyatt Centric")!;
    expect(hyatt.parent).toBe("Kothari Group");
    expect(hyatt.path).toEqual(["Broadway Hotels Inc", "Hyatt Centric"]);
  });
  it("creates a parent that only appears as a prefix of a job", () => {
    expect(r.parents.find((p) => p.name === "Towers Realty")).toBeDefined();
  });
  it("reads common QuickBooks export column names and contact fields", () => {
    const p = parseQboCustomers([
      { "Customer full name": "Marrbeck Construction", Email: "ap@marrbeck.ca", "Phone numbers": "204-555-0101", "Billing address": "1 Main St, Winnipeg MB", "Full name": "Pat Lee" },
    ]).parents[0]!;
    expect(p).toMatchObject({ name: "Marrbeck Construction", email: "ap@marrbeck.ca", phone: "204-555-0101", billingAddress: "1 Main St, Winnipeg MB", contactName: "Pat Lee" });
  });
  it("skips blank rows and total rows", () => {
    expect(parseQboCustomers(rows(["", "  ", "TOTAL", "Total"])).parents.length).toBe(0);
  });
  it("reports unreadable files instead of returning nothing silently", () => {
    expect(() => parseQboCustomers([{ Foo: "bar" }])).toThrow(/customer name column/i);
  });
});

describe("planClientImport", () => {
  const parsed = parseQboCustomers(rows(["Kothari Group", "Towers Realty"])).parents;
  it("inserts only clients that do not exist yet", () => {
    const plan = planClientImport(parsed, [{ id: "1", name: "kothari group", qbo_customer_id: null }]);
    expect(plan.inserts.map((c) => c.name)).toEqual(["Towers Realty"]);
    expect(plan.unchanged).toBe(1);
  });
  it("a second import of the same file inserts nothing and deletes nothing", () => {
    const existing = parsed.map((p, i) => ({ id: String(i), name: p.name, qbo_customer_id: null }));
    const plan = planClientImport(parsed, existing);
    expect(plan.inserts.length).toBe(0);
    expect("deletes" in plan).toBe(false);
  });
});
