import { describe, expect, test } from "bun:test";
import { askGateway, gatewayError, replyText } from "./gateway";

type Call = { url: string; body: Record<string, unknown> };
const fake = (answer: (c: Call) => { status: number; json?: unknown; text?: string }) => {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: { body: string }) => {
    const call = { url, body: JSON.parse(init.body) as Record<string, unknown> };
    calls.push(call);
    const a = answer(call);
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => a.text ?? JSON.stringify(a.json ?? {}) };
  };
  return { calls, fetchFn };
};
const ask = { system: "S", prompt: "P", maxTokens: 100 };
const chatOk = { status: 200, json: { choices: [{ message: { content: "hello" } }] } };

describe("asking the AI gateway", () => {
  test("the first form that works is used and nothing else is tried", async () => {
    const f = fake(() => chatOk);
    const r = await askGateway(f.fetchFn, ["anthropic/claude-fable-5.1"], ask);
    expect(r).toMatchObject({ ok: true, text: "hello", model: "anthropic/claude-fable-5.1" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toMatch(/\/chat\/completions$/);
  });
  test("when the gateway rejects one way of asking, the other ways are tried before giving up on the model", async () => {
    const f = fake((c) => (c.url.endsWith("/responses") ? { status: 200, json: { output: [{ type: "message", content: [{ type: "output_text", text: "from responses" }] }] } } : { status: 400, json: { error: { message: "Unsupported parameter: max_tokens" } } }));
    const r = await askGateway(f.fetchFn, ["anthropic/claude-fable-5.1"], ask);
    expect(r).toMatchObject({ ok: true, text: "from responses" });
    expect(f.calls.map((c) => c.url.split("/v1")[1])).toEqual(["/chat/completions", "/chat/completions", "/responses"]);
    expect(f.calls[1]!.body).toHaveProperty("max_completion_tokens", 100);
  });
  test("when the strongest model cannot be used, the next model that still meets the standard is asked", async () => {
    const f = fake((c) => (c.body["model"] === "anthropic/claude-opus-5.5" ? chatOk : { status: 400, json: { error: { message: "model not available for chat" } } }));
    const r = await askGateway(f.fetchFn, ["anthropic/claude-fable-5.1", "anthropic/claude-opus-5.5"], ask);
    expect(r).toMatchObject({ ok: true, model: "anthropic/claude-opus-5.5" });
  });
  test("when nothing works, the gateway's own reason is reported for every attempt", async () => {
    const f = fake(() => ({ status: 400, json: { error: { message: "prompt is too long: 250000 tokens" } } }));
    const r = await askGateway(f.fetchFn, ["anthropic/claude-fable-5.1"], ask);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("prompt is too long: 250000 tokens");
      expect(r.message).toContain("400");
      expect(r.attempts.length).toBeGreaterThanOrEqual(3);
      expect(r.attempts[0]).toMatchObject({ model: "anthropic/claude-fable-5.1", status: 400, detail: "prompt is too long: 250000 tokens" });
    }
  });
  test("out of credits or too busy stops at once with a plain message, without trying other models", async () => {
    for (const [status, words] of [[402, /credits/i], [429, /busy/i]] as const) {
      const f = fake(() => ({ status }));
      const r = await askGateway(f.fetchFn, ["a/claude-fable-5.1", "a/claude-opus-5.5"], ask);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(words);
      expect(f.calls).toHaveLength(1);
    }
  });
  test("a gateway that only speaks the Anthropic message form is still reached", async () => {
    const f = fake((c) => (c.url.endsWith("/messages") ? { status: 200, json: { content: [{ type: "text", text: "native" }] } } : { status: 404, text: "Not found" }));
    const r = await askGateway(f.fetchFn, ["a/claude-fable-5.1"], ask);
    expect(r).toMatchObject({ ok: true, text: "native", form: "messages" });
    expect(f.calls.at(-1)!.body).toMatchObject({ system: "S", max_tokens: 100, messages: [{ role: "user", content: "P" }] });
  });
  test("a form already known to work is asked first", async () => {
    const f = fake((c) => (c.url.endsWith("/responses") ? { status: 200, json: { output_text: "ok" } } : { status: 400 }));
    const r = await askGateway(f.fetchFn, ["a/claude-fable-5.1"], ask, { preferForm: "responses" });
    expect(r.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
  });
  test("an empty reply counts as a failure, not an answer", async () => {
    const f = fake(() => ({ status: 200, json: { choices: [{ message: { content: "" } }] } }));
    const r = await askGateway(f.fetchFn, ["a/claude-fable-5.1"], ask);
    expect(r.ok).toBe(false);
  });
  test("a connection that drops is reported, not thrown", async () => {
    const r = await askGateway(async () => { throw new Error("network down"); }, ["a/claude-fable-5.1"], ask);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("network down");
  });
});

describe("reading gateway replies", () => {
  test("text is found in chat replies, in parts, and in responses-style replies", () => {
    expect(replyText({ choices: [{ message: { content: "a" } }] })).toBe("a");
    expect(replyText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })).toBe("ab");
    expect(replyText({ output_text: "c" })).toBe("c");
    expect(replyText({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "d" }] }] })).toBe("d");
    expect(replyText({ content: [{ type: "text", text: "e" }] })).toBe("e");
    expect(replyText({})).toBe("");
  });
  test("the reason for a refusal is taken from whatever shape the gateway sends, and kept short", () => {
    expect(gatewayError('{"error":{"message":"bad model"}}')).toBe("bad model");
    expect(gatewayError('{"error":"plain"}')).toBe("plain");
    expect(gatewayError('{"message":"m"}')).toBe("m");
    expect(gatewayError("<html>Bad gateway</html>")).toBe("<html>Bad gateway</html>");
    expect(gatewayError("x".repeat(900)).length).toBeLessThanOrEqual(300);
    expect(gatewayError("")).toBe("no reason given");
  });
});
