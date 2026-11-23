/**
 * BMD Projects' own connection to QuickBooks Online (Intuit OAuth 2 and the Accounting API).
 * No environment access here: callers pass fetch, the app's credentials and a store, so this runs on the server and under test.
 * One connection serves the whole company. Reading is all this file does; nothing here writes to QuickBooks.
 */
import { decryptToken, encryptToken } from "@/lib/ms/core";

export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const PAGE = 1000;

export type QboEnv = { clientId: string; clientSecret: string; sandbox?: boolean };
export type QboStore = {
  get: () => Promise<{ realm_id: string; refresh_token_enc: string } | null>;
  saveToken: (refreshTokenEnc: string) => Promise<void>;
  setError: (message: string | null) => Promise<void>;
};
export class QboReconnectError extends Error {}

export function qboAuthorizeUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  return `https://appcenter.intuit.com/connect/oauth2?${new URLSearchParams({ client_id: o.clientId, response_type: "code", scope: QBO_SCOPE, redirect_uri: o.redirectUri, state: o.state })}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; error?: string; error_description?: string };

/** Intuit's trace id for a response, which their support team asks for. Empty when the header is missing. */
const tidOf = (res: Response): string => {
  const tid = res.headers.get("intuit_tid") ?? "";
  return /^[\w.-]{1,100}$/.test(tid) ? ` (intuit_tid ${tid})` : "";
};

export function createQbo(deps: { fetch: typeof fetch; env: QboEnv; store: QboStore; keyMaterial: string }) {
  const { env, store, keyMaterial } = deps;
  const api = env.sandbox ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";

  // Intuit wants the app's credentials in the Authorization header, never in the body.
  const token = async (params: Record<string, string>): Promise<{ status: number; body: TokenResponse; tid: string }> => {
    const res = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${env.clientId}:${env.clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenResponse, tid: tidOf(res) };
  };

  /** First connection: trade the authorization code for tokens. */
  async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshTokenEnc: string }> {
    const { body, tid } = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (!body.access_token || !body.refresh_token) throw new Error(`${body.error_description ?? body.error ?? "QuickBooks did not return a token"}${tid}`);
    return { accessToken: body.access_token, refreshTokenEnc: await encryptToken(body.refresh_token, keyMaterial) };
  }

  /** A fresh access token. QuickBooks issues a new refresh token as it goes, so the newest is always saved. */
  async function getAccessToken(): Promise<{ accessToken: string; realmId: string }> {
    const row = await store.get();
    if (!row) throw new QboReconnectError("QuickBooks is not connected.");
    let refresh: string;
    try {
      refresh = await decryptToken(row.refresh_token_enc, keyMaterial);
    } catch {
      await store.setError("Stored token could not be read");
      throw new QboReconnectError("The stored QuickBooks sign-in could not be read. Reconnect QuickBooks.");
    }
    const { status, body, tid } = await token({ grant_type: "refresh_token", refresh_token: refresh });
    if (!body.access_token) {
      const reason = `${body.error ?? `HTTP ${status}`}${body.error_description ? `: ${body.error_description}` : ""}${tid}`;
      await store.setError(reason);
      if (status >= 500) throw new Error(`QuickBooks is not answering (${reason}). Try again shortly.`);
      throw new QboReconnectError(`QuickBooks needs to be reconnected (${reason}).`);
    }
    if (body.refresh_token && body.refresh_token !== refresh) await store.saveToken(await encryptToken(body.refresh_token, keyMaterial));
    await store.setError(null);
    return { accessToken: body.access_token, realmId: row.realm_id };
  }

  async function get(path: string, auth?: { accessToken: string; realmId: string }): Promise<Record<string, unknown>> {
    const a = auth ?? (await getAccessToken());
    const res = await deps.fetch(`${api}/v3/company/${encodeURIComponent(a.realmId)}/${path}`, { headers: { authorization: `Bearer ${a.accessToken}`, accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const fault = (body["Fault"] as { Error?: { Message?: string; Detail?: string }[] } | undefined)?.Error?.[0];
      const detail = fault?.Detail ? ` — ${fault.Detail.slice(0, 200)}` : "";
      const message = `QuickBooks refused the request (${res.status}${fault?.Message ? `: ${fault.Message}` : ""})${detail}${tidOf(res)}.`;
      // Kept in the server log too, so a failure can be traced with Intuit support afterwards.
      console.error(`[qbo] ${path.split("?")[0]}: ${message}`);
      // …and on the connection, so Settings shows it until the next call that succeeds.
      await store.setError(message.slice(0, 500)).catch(() => {});
      throw new Error(message);
    }
    return body;
  }

  /** Every record of one kind (Item, Vendor, Customer…), read a page at a time. `where` narrows it, e.g. "TxnDate >= '2024-01-01'". */
  async function queryAll(entity: string, auth?: { accessToken: string; realmId: string }, where?: string): Promise<Record<string, unknown>[]> {
    const a = auth ?? (await getAccessToken());
    const out: Record<string, unknown>[] = [];
    for (let start = 1; start < 200_000; start += PAGE) {
      const sql = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ""} STARTPOSITION ${start} MAXRESULTS ${PAGE}`;
      const body = await get(`query?query=${encodeURIComponent(sql)}&minorversion=75`, a);
      const rows = ((body["QueryResponse"] as Record<string, unknown> | undefined)?.[entity] ?? []) as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async function companyName(auth: { accessToken: string; realmId: string }): Promise<string | null> {
    const body = await get(`companyinfo/${encodeURIComponent(auth.realmId)}?minorversion=75`, auth);
    return ((body["CompanyInfo"] as { CompanyName?: string } | undefined)?.CompanyName ?? null) || null;
  }

  return { exchangeCode, getAccessToken, queryAll, companyName };
}

// ── What a QuickBooks record is to BMD ──────────────────────────────────────────────────────────────────────────
type Ref = { name?: string; value?: string };
type QboItem = { Id?: string; Name?: string; Type?: string; Sku?: string; PurchaseCost?: number; UnitPrice?: number; Active?: boolean; PrefVendorRef?: Ref; ParentRef?: Ref };
export type ItemKind = "cost_code" | "material" | "labour" | "category" | "other";
export type Staged = { external_id: string; kind: ItemKind | "supplier"; name: string; data: Record<string, unknown> };

const cents = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null);

/**
 * BMD's cost codes live in QuickBooks as items named "01-04 - LVT". Those link to cost codes and are never products.
 * A product is a material; a service with a purchase cost is labour; anything else (fees, holdback, bad debts) is left for billing.
 */
export function classifyItem(item: QboItem): { kind: ItemKind; code?: string } {
  const name = String(item.Name ?? "").trim();
  const code = /^(\d{2}(?:-\d{2,4})?)\s+-\s+\S/.exec(name)?.[1];
  if (code) return { kind: "cost_code", code };
  if (item.Type === "Category") return { kind: "category" };
  if (item.Type === "NonInventory" || item.Type === "Inventory") return { kind: "material" };
  if (item.Type === "Service" && cents(item.PurchaseCost) != null) return { kind: "labour" };
  return { kind: "other" };
}

/** A QuickBooks item as it is held in staging. A cost of zero in QuickBooks is "unknown" here, never zero. */
export function stageItem(item: QboItem): Staged {
  const c = classifyItem(item);
  return {
    external_id: String(item.Id ?? ""),
    kind: c.kind,
    name: String(item.Name ?? "").trim(),
    data: { type: item.Type ?? null, sku: item.Sku?.trim() || null, cost_cents: cents(item.PurchaseCost), sales_price_cents: cents(item.UnitPrice), vendor: item.PrefVendorRef?.name ?? null, vendor_id: item.PrefVendorRef?.value ?? null, category: item.ParentRef?.name ?? null, active: item.Active !== false, code: c.code ?? null },
  };
}

/** What BMD's purchases from one vendor show: lines for materials, for labour (installers, subcontractors), and for anything else. */
export type VendorEvidence = { material_lines: number; labour_lines: number; other_lines: number; last_purchase: string | null };
type QboLine = { DetailType?: string; ItemBasedExpenseLineDetail?: { ItemRef?: Ref }; AccountBasedExpenseLineDetail?: { AccountRef?: Ref } };
type QboTxn = { TxnDate?: string; VendorRef?: Ref; EntityRef?: Ref & { type?: string }; Line?: QboLine[] };
type QboAccount = { Id?: string; Name?: string; FullyQualifiedName?: string; AccountType?: string; AccountSubType?: string };

const LABOUR_NAME = /install|subcontract|labou?r/i;

/**
 * Reads bills and expenses to tell a material supplier and an installer from a restaurant or a software subscription.
 * Materials: a product line, or a supplies-and-materials cost account.
 * Labour: a labour item or an install cost-code item, or a cost-of-labour, subcontractor or installation cost account.
 * Freight and other costs count as neither.
 */
export function vendorEvidence(txns: QboTxn[], items: { Id?: string; Type?: string; Name?: string; PurchaseCost?: number }[], accounts: QboAccount[]): Map<string, VendorEvidence> {
  const materialItems = new Set<string>();
  const labourItems = new Set<string>();
  for (const i of items) {
    const k = classifyItem(i as QboItem).kind;
    if (k === "material") materialItems.add(String(i.Id));
    else if (k === "labour" || (k === "cost_code" && LABOUR_NAME.test(String(i.Name ?? "")))) labourItems.add(String(i.Id));
  }
  const materialAccounts = new Set(accounts.filter((a) => a.AccountSubType === "SuppliesMaterialsCogs").map((a) => String(a.Id)));
  const labourAccounts = new Set(accounts.filter((a) => a.AccountType === "Cost of Goods Sold" && (a.AccountSubType === "CostOfLaborCos" || LABOUR_NAME.test(a.FullyQualifiedName ?? a.Name ?? ""))).map((a) => String(a.Id)));
  const out = new Map<string, VendorEvidence>();
  for (const t of txns) {
    const ref = t.VendorRef ?? (t.EntityRef && (!t.EntityRef.type || t.EntityRef.type === "Vendor") ? t.EntityRef : undefined);
    if (!ref?.value) continue;
    const e = out.get(ref.value) ?? { material_lines: 0, labour_lines: 0, other_lines: 0, last_purchase: null };
    for (const l of t.Line ?? []) {
      const item = l.ItemBasedExpenseLineDetail?.ItemRef?.value;
      const account = l.AccountBasedExpenseLineDetail?.AccountRef?.value;
      if (item == null && account == null) continue;
      if ((item != null && materialItems.has(item)) || (account != null && materialAccounts.has(account))) e.material_lines++;
      else if ((item != null && labourItems.has(item)) || (account != null && labourAccounts.has(account))) e.labour_lines++;
      else e.other_lines++;
    }
    if (t.TxnDate && (!e.last_purchase || t.TxnDate > e.last_purchase)) e.last_purchase = t.TxnDate;
    out.set(ref.value, e);
  }
  return out;
}

type QboVendor = { Id?: string; DisplayName?: string; Active?: boolean; PrimaryEmailAddr?: { Address?: string }; PrimaryPhone?: { FreeFormNumber?: string }; AcctNum?: string; GivenName?: string; FamilyName?: string };
export function stageVendor(v: QboVendor, evidence?: Map<string, VendorEvidence>): Staged {
  const e = evidence ? (evidence.get(String(v.Id ?? "")) ?? { material_lines: 0, labour_lines: 0, other_lines: 0, last_purchase: null }) : null;
  return {
    external_id: String(v.Id ?? ""),
    kind: "supplier",
    name: String(v.DisplayName ?? "").trim(),
    data: { contact_name: [v.GivenName, v.FamilyName].filter(Boolean).join(" ") || null, email: v.PrimaryEmailAddr?.Address ?? null, phone: v.PrimaryPhone?.FreeFormNumber ?? null, account_number: v.AcctNum ?? null, active: v.Active !== false, ...(e ? { purchases: e } : {}) },
  };
}
