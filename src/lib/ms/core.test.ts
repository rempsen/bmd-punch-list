import { describe, expect, test } from "bun:test";
import { SCOPES, authorizeUrl, createGraph, decryptToken, encryptToken, signState, verifyState, type MsStore } from "./core";

const env = { tenant: "t-1", clientId: "c-1", clientSecret: "s-1" };
const KEY = "key material for tests";

function fakeStore(initial: Record<string, { refresh_token_enc: string; account_email: string }> = {}) {
  const rows = { ...initial };
  const errors: Record<string, string | null> = {};
  const store: MsStore = {
    get: async (id) => rows[id] ?? null,
    saveToken: async (id, enc) => {
      rows[id] = { ...(rows[id] ?? { account_email: "" }), refresh_token_enc: enc };
    },
    setError: async (id, message) => {
      errors[id] = message;
    },
  };
  return { store, rows, errors };
}

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("state", () => {
  const now = 1_800_000_000_000;
  test("a signed state verifies and returns its payload", async () => {
    const s = await signState({ userId: "u1", kind: "mail", nonce: "n1", exp: now + 60_000 }, "secret");
    expect(await verifyState(s, "secret", now)).toEqual({ userId: "u1", kind: "mail", nonce: "n1", exp: now + 60_000 });
  });
  test("a tampered state is rejected", async () => {
    const s = await signState({ userId: "u1", kind: "mail", nonce: "n1", exp: now + 60_000 }, "secret");
    const forged = btoa(JSON.stringify({ userId: "attacker", kind: "mail", nonce: "n1", exp: now + 60_000 })).replace(/=+$/, "") + "." + s.split(".")[1];
    expect(await verifyState(forged, "secret", now)).toBeNull();
    expect(await verifyState(s, "other secret", now)).toBeNull();
    expect(await verifyState("garbage", "secret", now)).toBeNull();
  });
  test("an expired state is rejected", async () => {
    const s = await signState({ userId: "u1", kind: "mail", nonce: "n1", exp: now - 1 }, "secret");
    expect(await verifyState(s, "secret", now)).toBeNull();
  });
});

describe("token encryption", () => {
  test("round-trips and does not contain the plain token", async () => {
    const enc = await encryptToken("refresh-token-value", KEY);
    expect(enc).not.toContain("refresh-token-value");
    expect(await decryptToken(enc, KEY)).toBe("refresh-token-value");
  });
  test("two encryptions of the same token differ", async () => {
    expect(await encryptToken("x", KEY)).not.toBe(await encryptToken("x", KEY));
  });
  test("the wrong key cannot decrypt", async () => {
    const enc = await encryptToken("refresh-token-value", KEY);
    expect(decryptToken(enc, "another key")).rejects.toThrow();
  });
});

describe("authorizeUrl", () => {
  test("asks for the four delegated scopes and carries the state", () => {
    const u = new URL(authorizeUrl({ ...env, redirectUri: "https://app.example/api/ms/callback", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/t-1/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("offline_access User.Read Mail.Send Files.ReadWrite.All");
    expect(SCOPES).toEqual(["offline_access", "User.Read", "Mail.Send", "Files.ReadWrite.All"]);
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.example/api/ms/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("login_hint")).toBeNull();
  });
  test("asks for other scopes and hints the account only when told to (the calendar opt-in)", () => {
    const u = new URL(authorizeUrl({ ...env, redirectUri: "https://app.example/api/ms/callback", state: "st", scopes: ["offline_access", "User.Read", "Calendars.ReadWrite"], loginHint: "fred@bmd.test" }));
    expect(u.searchParams.get("scope")).toBe("offline_access User.Read Calendars.ReadWrite");
    expect(u.searchParams.get("login_hint")).toBe("fred@bmd.test");
  });
});

describe("getAccessToken", () => {
  test("exchanges the stored refresh token and stores the rotated one", async () => {
    const { store, rows, errors } = fakeStore({ u1: { refresh_token_enc: await encryptToken("old-rt", KEY), account_email: "dan@x" } });
    const { f, calls } = fakeFetch(() => json({ access_token: "at-1", refresh_token: "new-rt", expires_in: 3600 }));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    expect(await g.getAccessToken("u1")).toBe("at-1");
    expect(calls[0]!.url).toBe("https://login.microsoftonline.com/t-1/oauth2/v2.0/token");
    expect(String(calls[0]!.init.body)).toContain("refresh_token=old-rt");
    expect(await decryptToken(rows["u1"]!.refresh_token_enc, KEY)).toBe("new-rt");
    expect(errors["u1"]).toBeNull();
  });
  test("asks for the usual scopes unless given others", async () => {
    const { store } = fakeStore({ u1: { refresh_token_enc: await encryptToken("rt", KEY), account_email: "dan@x" } });
    const { f, calls } = fakeFetch(() => json({ access_token: "at", refresh_token: "rt2" }));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    await g.getAccessToken("u1");
    await g.getAccessToken("u1", ["offline_access", "Calendars.ReadWrite"]);
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("scope")).toBe(SCOPES.join(" "));
    expect(new URLSearchParams(String(calls[1]!.init.body)).get("scope")).toBe("offline_access Calendars.ReadWrite");
  });
  test("with no connection it asks the user to connect", async () => {
    const { store } = fakeStore();
    const g = createGraph({ fetch: fakeFetch(() => json({})).f, env, store, keyMaterial: KEY });
    expect(g.getAccessToken("nobody")).rejects.toThrow("not connected");
  });
});

describe("sendMailAs", () => {
  const msg = { to: ["gc@example.com"], cc: ["pm@example.com"], subject: "Quote 26-041", html: "<p>Hello</p>" };

  test("a revoked refresh token returns reconnect and records the reason", async () => {
    const { store, errors } = fakeStore({ u1: { refresh_token_enc: await encryptToken("revoked", KEY), account_email: "dan@x" } });
    const { f, calls } = fakeFetch(() => json({ error: "invalid_grant", error_description: "AADSTS70000: The refresh token has been revoked." }, 400));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    const res = await g.sendMailAs("u1", msg);
    expect(res).toEqual({ ok: false, reason: "reconnect", message: "Your Outlook connection has expired. Reconnect Outlook in Settings and send again." });
    expect(errors["u1"]).toContain("invalid_grant");
    expect(calls).toHaveLength(1); // never reached Graph
  });

  test("a refresh token that cannot be decrypted is treated the same way", async () => {
    const { store, errors } = fakeStore({ u1: { refresh_token_enc: "not-a-valid-ciphertext", account_email: "dan@x" } });
    const g = createGraph({ fetch: fakeFetch(() => json({})).f, env, store, keyMaterial: KEY });
    expect((await g.sendMailAs("u1", msg)).ok).toBe(false);
    expect(errors["u1"]).toBeTruthy();
  });

  test("no connection returns reconnect", async () => {
    const { store } = fakeStore();
    const g = createGraph({ fetch: fakeFetch(() => json({})).f, env, store, keyMaterial: KEY });
    const res = await g.sendMailAs("nobody", msg);
    expect(res.ok === false && res.reason).toBe("reconnect");
  });

  test("sends through the user's mailbox and saves to Sent Items", async () => {
    const { store } = fakeStore({ u1: { refresh_token_enc: await encryptToken("rt", KEY), account_email: "dan@x" } });
    const { f, calls } = fakeFetch((url) => (url.includes("/token") ? json({ access_token: "at-1", expires_in: 3600 }) : new Response(null, { status: 202 })));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    const res = await g.sendMailAs("u1", { ...msg, attachments: [{ name: "Quote.pdf", contentType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) }] });
    expect(res).toEqual({ ok: true });
    const send = calls[1]!;
    expect(send.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect((send.init.headers as Record<string, string>)["authorization"]).toBe("Bearer at-1");
    const body = JSON.parse(String(send.init.body));
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe("Quote 26-041");
    expect(body.message.body).toEqual({ contentType: "HTML", content: "<p>Hello</p>" });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "gc@example.com" } }]);
    expect(body.message.ccRecipients).toEqual([{ emailAddress: { address: "pm@example.com" } }]);
    expect(body.message.attachments).toEqual([{ "@odata.type": "#microsoft.graph.fileAttachment", name: "Quote.pdf", contentType: "application/pdf", contentBytes: "JVBERg==" }]);
  });

  test("a Graph failure returns error with Graph's message", async () => {
    const { store } = fakeStore({ u1: { refresh_token_enc: await encryptToken("rt", KEY), account_email: "dan@x" } });
    const { f } = fakeFetch((url) => (url.includes("/token") ? json({ access_token: "at-1" }) : json({ error: { code: "ErrorInvalidRecipients", message: "At least one recipient is not valid." } }, 400)));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    expect(await g.sendMailAs("u1", msg)).toEqual({ ok: false, reason: "error", message: "At least one recipient is not valid." });
  });

  test("a 401 from Graph asks for a reconnect", async () => {
    const { store } = fakeStore({ u1: { refresh_token_enc: await encryptToken("rt", KEY), account_email: "dan@x" } });
    const { f } = fakeFetch((url) => (url.includes("/token") ? json({ access_token: "at-1" }) : json({ error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } }, 401)));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    const res = await g.sendMailAs("u1", msg);
    expect(res.ok === false && res.reason).toBe("reconnect");
  });

  test("no recipients or oversized attachments are refused before anything is sent", async () => {
    const { store } = fakeStore({ u1: { refresh_token_enc: await encryptToken("rt", KEY), account_email: "dan@x" } });
    const { f, calls } = fakeFetch(() => json({ access_token: "at-1" }));
    const g = createGraph({ fetch: f, env, store, keyMaterial: KEY });
    expect(await g.sendMailAs("u1", { ...msg, to: [] })).toEqual({ ok: false, reason: "error", message: "Add at least one recipient." });
    const big = { name: "big.pdf", contentType: "application/pdf", bytes: new Uint8Array(3 * 1024 * 1024 + 1) };
    const res = await g.sendMailAs("u1", { ...msg, attachments: [big] });
    expect(res).toEqual({ ok: false, reason: "error", message: "Attachments are over 3 MB in total. Send a link to the file instead." });
    expect(calls).toHaveLength(0);
  });
});
