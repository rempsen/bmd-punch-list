/**
 * Microsoft 365 (Entra + Graph) core. No environment access here: callers pass fetch, credentials and a store,
 * so the same code runs on the server and under test.
 */

export const SCOPES = ["offline_access", "User.Read", "Mail.Send", "Files.ReadWrite.All"];
export const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_ATTACH_BYTES = 3 * 1024 * 1024;

export type MsEnv = { tenant: string; clientId: string; clientSecret: string };
export type MsStore = {
  get: (userId: string) => Promise<{ refresh_token_enc: string; account_email: string } | null>;
  saveToken: (userId: string, refreshTokenEnc: string) => Promise<void>;
  setError: (userId: string, message: string | null) => Promise<void>;
};
export type MailMessage = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: { name: string; contentType: string; bytes: Uint8Array }[];
};
export type SendResult = { ok: true } | { ok: false; reason: "reconnect" | "error"; message: string };
/** `scopes` is set only for kind "calendar": the permissions that sign-in asked for (the person's existing ones plus their calendar). */
export type StatePayload = { userId: string; kind: "mail" | "library" | "quickbooks" | "calendar"; nonce: string; exp: number; scopes?: string[] };

export class ReconnectError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signState(payload: StatePayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(body, secret))}`;
}

export async function verifyState(state: string, secret: string, now: number = Date.now()): Promise<StatePayload | null> {
  try {
    const [body, sig] = state.split(".");
    if (!body || !sig) return null;
    const expected = await hmac(body, secret);
    const given = unb64url(sig);
    if (given.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ given[i]!;
    if (diff !== 0) return null;
    const p = JSON.parse(dec.decode(unb64url(body))) as StatePayload;
    if (typeof p.userId !== "string" || typeof p.nonce !== "string" || typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}

async function aesKey(keyMaterial: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(keyMaterial));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM. Output is "v1.<iv>.<ciphertext>", base64url. */
export async function encryptToken(plain: string, keyMaterial: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyMaterial), enc.encode(plain)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decryptToken(value: string, keyMaterial: string): Promise<string> {
  const [v, iv, ct] = value.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unreadable token");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await aesKey(keyMaterial), unb64url(ct));
  return dec.decode(plain);
}

export function authorizeUrl(o: { tenant: string; clientId: string; redirectUri: string; state: string; scopes?: readonly string[]; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    response_type: "code",
    redirect_uri: o.redirectUri,
    response_mode: "query",
    scope: (o.scopes ?? SCOPES).join(" "),
    state: o.state,
    prompt: "select_account",
    ...(o.loginHint ? { login_hint: o.loginHint } : {}),
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(o.tenant)}/oauth2/v2.0/authorize?${q}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; error?: string; error_description?: string };

export function createGraph(deps: { fetch: typeof fetch; env: MsEnv; store: MsStore; keyMaterial: string }) {
  const { env, store, keyMaterial } = deps;
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(env.tenant)}/oauth2/v2.0/token`;

  const token = async (params: Record<string, string>): Promise<{ status: number; body: TokenResponse }> => {
    const res = await deps.fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, scope: SCOPES.join(" "), ...params }).toString(),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenResponse };
  };

  /** First connection: trade the authorization code for tokens. Returns the access token and the encrypted refresh token. */
  async function exchangeCode(code: string, redirectUri: string, scopes?: readonly string[]): Promise<{ accessToken: string; refreshTokenEnc: string }> {
    const { body } = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, ...(scopes ? { scope: scopes.join(" ") } : {}) });
    if (!body.access_token || !body.refresh_token) {
      throw new Error(body.error_description?.split("\n")[0] ?? body.error ?? "Microsoft did not return a token");
    }
    return { accessToken: body.access_token, refreshTokenEnc: await encryptToken(body.refresh_token, keyMaterial) };
  }

  /** `scopes` asks for a token with exactly those permissions; leave it out for the usual mail and files ones. */
  async function getAccessToken(userId: string, scopes?: readonly string[]): Promise<string> {
    const row = await store.get(userId);
    if (!row) throw new ReconnectError("Outlook is not connected for this account.");
    let refresh: string;
    try {
      refresh = await decryptToken(row.refresh_token_enc, keyMaterial);
    } catch {
      await store.setError(userId, "Stored token could not be read");
      throw new ReconnectError("Stored token could not be read");
    }
    const { status, body } = await token({ grant_type: "refresh_token", refresh_token: refresh, ...(scopes ? { scope: scopes.join(" ") } : {}) });
    if (!body.access_token) {
      const reason = `${body.error ?? `HTTP ${status}`}: ${body.error_description?.split("\n")[0] ?? "token refresh failed"}`;
      await store.setError(userId, reason);
      // invalid_grant, interaction_required and the like need the user; anything else is a plain failure.
      if (status >= 500) throw new Error(reason);
      throw new ReconnectError(reason);
    }
    if (body.refresh_token) await store.saveToken(userId, await encryptToken(body.refresh_token, keyMaterial));
    await store.setError(userId, null);
    return body.access_token;
  }

  async function graph(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
    return deps.fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
  }

  async function sendMailAs(userId: string, msg: MailMessage): Promise<SendResult> {
    const fail = (message: string): SendResult => ({ ok: false, reason: "error", message });
    if (msg.to.length === 0) return fail("Add at least one recipient.");
    const attachBytes = (msg.attachments ?? []).reduce((n, a) => n + a.bytes.length, 0);
    if (attachBytes > MAX_ATTACH_BYTES) return fail("Attachments are over 3 MB in total. Send a link to the file instead.");

    const reconnect: SendResult = {
      ok: false,
      reason: "reconnect",
      message: "Your Outlook connection has expired. Reconnect Outlook in Settings and send again.",
    };
    let accessToken: string;
    try {
      accessToken = await getAccessToken(userId);
    } catch (e) {
      if (e instanceof ReconnectError) return (await store.get(userId)) ? reconnect : { ...reconnect, message: "Connect Outlook in Settings before sending." };
      return fail("Microsoft could not be reached. Try again in a minute.");
    }

    const addr = (a: string) => ({ emailAddress: { address: a } });
    const res = await graph(accessToken, "/me/sendMail", {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: msg.subject,
          body: { contentType: "HTML", content: msg.html },
          toRecipients: msg.to.map(addr),
          ...(msg.cc?.length ? { ccRecipients: msg.cc.map(addr) } : {}),
          ...(msg.attachments?.length
            ? {
                attachments: msg.attachments.map((a) => ({
                  "@odata.type": "#microsoft.graph.fileAttachment",
                  name: a.name,
                  contentType: a.contentType,
                  contentBytes: b64(a.bytes),
                })),
              }
            : {}),
        },
        saveToSentItems: true,
      }),
    });
    if (res.status === 202 || res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (res.status === 401) {
      await store.setError(userId, body.error?.message ?? "Unauthorized");
      return reconnect;
    }
    return fail(body.error?.message ?? `Microsoft returned ${res.status}`);
  }

  return { exchangeCode, getAccessToken, sendMailAs, graph };
}
