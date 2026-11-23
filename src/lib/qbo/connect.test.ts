import { describe, expect, test } from "bun:test";
import { decryptToken, encryptToken } from "@/lib/ms/core";
import { classifyItem, createQbo, qboAuthorizeUrl, stageItem, stageVendor, vendorEvidence, type QboStore } from "./connect";

const KEY = "test-key";
const env = { clientId: "cid", clientSecret: "secret" };
function harness(over: { conn?: { realm_id: string; refresh_token_enc: string } | null; responses: (url: string, init?: RequestInit) => { status?: number; body: unknown; tid?: string } }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const state = { conn: over.conn ?? null, saved: [] as string[], errors: [] as (string | null)[] };
  const store: QboStore = { get: async () => state.conn, saveToken: async (t) => void state.saved.push(t), setError: async (m) => void state.errors.push(m) };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = over.responses(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.tid ? { intuit_tid: r.tid } : {} });
  }) as unknown as typeof fetch;
  return { qbo: createQbo({ fetch: fetchFn, env, store, keyMaterial: KEY }), calls, state };
}

describe("connecting to QuickBooks", () => {
  test("the sign-in address asks for accounting access only and carries the state", () => {
    const u = new URL(qboAuthorizeUrl({ clientId: "cid", redirectUri: "https://x/api/qbo/callback", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(u.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x/api/qbo/callback");
  });
  test("the code is exchanged with the app's credentials in the header, and the refresh token is kept encrypted", async () => {
    const h = harness({ responses: () => ({ body: { access_token: "at", refresh_token: "rt-1" } }) });
    const out = await h.qbo.exchangeCode("code", "https://x/api/qbo/callback");
    expect(out.accessToken).toBe("at");
    expect(out.refreshTokenEnc).not.toContain("rt-1");
    expect(await decryptToken(out.refreshTokenEnc, KEY)).toBe("rt-1");
    expect((h.calls[0]!.init!.headers as Record<string, string>)["authorization"]).toBe(`Basic ${btoa("cid:secret")}`);
    expect(String(h.calls[0]!.init!.body)).not.toContain("secret");
  });
  test("QuickBooks replaces the refresh token on use, and the new one is saved", async () => {
    const h = harness({ conn: { realm_id: "9", refresh_token_enc: await encryptToken("rt-1", KEY) }, responses: () => ({ body: { access_token: "at2", refresh_token: "rt-2" } }) });
    expect(await h.qbo.getAccessToken()).toEqual({ accessToken: "at2", realmId: "9" });
    expect(await decryptToken(h.state.saved[0]!, KEY)).toBe("rt-2");
  });
  test("a refused refresh says to reconnect and records why", async () => {
    const h = harness({ conn: { realm_id: "9", refresh_token_enc: await encryptToken("rt-1", KEY) }, responses: () => ({ status: 400, body: { error: "invalid_grant" } }) });
    await expect(h.qbo.getAccessToken()).rejects.toThrow(/reconnect/i);
    expect(h.state.errors[0]).toContain("invalid_grant");
  });
  test("with no connection it says so", async () => {
    const h = harness({ responses: () => ({ body: {} }) });
    await expect(h.qbo.getAccessToken()).rejects.toThrow(/not connected/i);
  });
  test("a query reads every page", async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ Id: String(from + i) }));
    const h = harness({
      conn: { realm_id: "9", refresh_token_enc: await encryptToken("rt-1", KEY) },
      responses: (url) => (url.includes("oauth") ? { body: { access_token: "at", refresh_token: "rt-2" } } : { body: { QueryResponse: { Item: decodeURIComponent(url).includes("STARTPOSITION 1 ") ? page(1000, 1) : page(4, 1001) } } }),
    });
    const items = await h.qbo.queryAll("Item");
    expect(items).toHaveLength(1004);
    const q = h.calls.filter((c) => c.url.includes("/query"));
    expect(q).toHaveLength(2);
    expect(q[0]!.url).toContain("https://quickbooks.api.intuit.com/v3/company/9/query");
    expect((q[0]!.init!.headers as Record<string, string>)["authorization"]).toBe("Bearer at");
  });
});

describe("what each QuickBooks item is to BMD", () => {
  test("cost-code items are cost codes, not products", () => {
    expect(classifyItem({ Name: "01-04 - LVT", Type: "Service", PurchaseCost: 0 })).toEqual({ kind: "cost_code", code: "01-04" });
    expect(classifyItem({ Name: "02-600 - Install Window Coverings", Type: "Service" })).toEqual({ kind: "cost_code", code: "02-600" });
    expect(classifyItem({ Name: "03 - General Conditions", Type: "Service" })).toEqual({ kind: "cost_code", code: "03" });
  });
  test("products are materials, services with a cost are labour, categories are grouping", () => {
    expect(classifyItem({ Name: "MIPOLAM AFINITY", Type: "NonInventory", PurchaseCost: 17.95 }).kind).toBe("material");
    expect(classifyItem({ Name: "Install LVP/LVP", Type: "Service", PurchaseCost: 1.25 }).kind).toBe("labour");
    expect(classifyItem({ Name: "Construction Materials", Type: "Category" }).kind).toBe("category");
    expect(classifyItem({ Name: "Bad Debts", Type: "Service", PurchaseCost: 0 }).kind).toBe("other");
  });
  test("a staged item keeps its cost in cents, and a zero cost is unknown, never zero", () => {
    expect(stageItem({ Id: "95", Name: "MIPOLAM AFINITY", Type: "NonInventory", PurchaseCost: 17.95, UnitPrice: 24.24, Active: true, PrefVendorRef: { name: "Gerflor", value: "7" }, ParentRef: { name: "Construction Materials" } })).toEqual({
      external_id: "95", kind: "material", name: "MIPOLAM AFINITY",
      data: { type: "NonInventory", sku: null, cost_cents: 1795, sales_price_cents: 2424, vendor: "Gerflor", vendor_id: "7", category: "Construction Materials", active: true, code: null },
    });
    expect(stageItem({ Id: "91", Name: "DeckSmart", Type: "NonInventory", PurchaseCost: 0, UnitPrice: 0, Active: true }).data.cost_cents).toBeNull();
  });
  test("a vendor is staged as a supplier", () => {
    expect(stageVendor({ Id: "7", DisplayName: "Gerflor", Active: true, PrimaryEmailAddr: { Address: "a@b.c" }, PrimaryPhone: { FreeFormNumber: "204" }, AcctNum: "A1", GivenName: "Jo", FamilyName: "Lee" })).toEqual({
      external_id: "7", kind: "supplier", name: "Gerflor", data: { contact_name: "Jo Lee", email: "a@b.c", phone: "204", account_number: "A1", active: true },
    });
  });
  test("a refused request says why, with Intuit's trace id for their support team", async () => {
    const h = harness({
      conn: { realm_id: "9", refresh_token_enc: await encryptToken("rt-1", KEY) },
      responses: (url) =>
        url.includes("oauth")
          ? { body: { access_token: "at", refresh_token: "rt-1" } }
          : { status: 400, tid: "1-abc-123", body: { Fault: { Error: [{ Message: "Invalid query", Detail: "QueryParserError: Encountered \"FROMM\"", code: "4000" }], type: "ValidationFault" } } },
    });
    const err = await h.qbo.queryAll("Item").catch((e: Error) => e);
    expect(String((err as Error).message)).toContain("400: Invalid query");
    expect(String((err as Error).message)).toContain("QueryParserError");
    expect(String((err as Error).message)).toContain("intuit_tid 1-abc-123");
    expect(h.state.errors.at(-1)).toContain("intuit_tid 1-abc-123");
  });
  test("a failed token request keeps Intuit's trace id in the recorded reason", async () => {
    const h = harness({ conn: { realm_id: "9", refresh_token_enc: await encryptToken("rt-1", KEY) }, responses: () => ({ status: 400, tid: "1-def-456", body: { error: "invalid_grant" } }) });
    await expect(h.qbo.getAccessToken()).rejects.toThrow(/reconnect/i);
    expect(h.state.errors[0]).toContain("intuit_tid 1-def-456");
  });
});

describe("telling material suppliers from everyone else", () => {
  test("lines for products or supplies-and-materials accounts count as materials; subcontractors and freight do not", () => {
    const items = [{ Id: "95", Type: "NonInventory", Name: "Mipolam" }, { Id: "3", Type: "Service", Name: "01-26 - Install Flooring" }];
    const accounts = [{ Id: "50", AccountType: "Cost of Goods Sold", AccountSubType: "SuppliesMaterialsCogs" }, { Id: "60", AccountType: "Expense" }, { Id: "15", AccountType: "Cost of Goods Sold", AccountSubType: "CostOfLaborCos" }];
    const sub = vendorEvidence([{ VendorRef: { value: "4" }, Line: [{ AccountBasedExpenseLineDetail: { AccountRef: { value: "15" } } }, { ItemBasedExpenseLineDetail: { ItemRef: { value: "3" } } }] }], items, accounts);
    expect(sub.get("4")).toEqual({ material_lines: 0, other_lines: 2, last_purchase: null });
    const e = vendorEvidence(
      [
        { TxnDate: "2025-03-01", VendorRef: { value: "7" }, Line: [{ ItemBasedExpenseLineDetail: { ItemRef: { value: "95" } } }, { AccountBasedExpenseLineDetail: { AccountRef: { value: "50" } } }] },
        { TxnDate: "2026-02-01", EntityRef: { value: "8", type: "Vendor" }, Line: [{ AccountBasedExpenseLineDetail: { AccountRef: { value: "60" } } }] },
        { TxnDate: "2026-02-01", EntityRef: { value: "9", type: "Customer" }, Line: [{ AccountBasedExpenseLineDetail: { AccountRef: { value: "50" } } }] },
      ],
      items,
      accounts,
    );
    expect(e.get("7")).toEqual({ material_lines: 2, other_lines: 0, last_purchase: "2025-03-01" });
    expect(e.get("8")).toEqual({ material_lines: 0, other_lines: 1, last_purchase: "2026-02-01" });
    expect(e.has("9")).toBe(false);
  });
  test("a vendor with no purchases is staged with zero, and without evidence nothing is claimed", () => {
    expect(stageVendor({ Id: "7", DisplayName: "Shell" }, new Map()).data["purchases"]).toEqual({ material_lines: 0, other_lines: 0, last_purchase: null });
    expect(stageVendor({ Id: "7", DisplayName: "Shell" }).data["purchases"]).toBeUndefined();
  });
});
