import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  COMPANYCAM_SCOPES,
  newWebhookToken,
  verifySignature,
  WEBHOOK_SCOPES,
} from "./companycam.server";

describe("CompanyCam webhook registration", () => {
  test("every scope BMD asks for is one CompanyCam accepts", () => {
    for (const s of WEBHOOK_SCOPES) expect(COMPANYCAM_SCOPES.has(s)).toBe(true);
    expect(WEBHOOK_SCOPES).toContain("photo.created");
  });
  test("each registration gets a fresh, long, URL-safe signing token", () => {
    const a = newWebhookToken();
    const b = newWebhookToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  test("a delivery signed the way CompanyCam signs (base64 HMAC-SHA1 of the body) with that token passes; anything else fails", async () => {
    const token = newWebhookToken();
    const body = '{"event_type":"photo.created","payload":{"photo":{"id":1}}}';
    const sig = createHmac("sha1", token).update(body).digest("base64");
    expect(await verifySignature(body, sig, token)).toBe(true);
    expect(await verifySignature(body + " ", sig, token)).toBe(false);
    expect(await verifySignature(body, sig, newWebhookToken())).toBe(false);
    expect(await verifySignature(body, null, token)).toBe(false);
  });
});
