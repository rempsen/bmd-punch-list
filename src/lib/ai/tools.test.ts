import { describe, expect, test } from "bun:test";
import { toolForm, toolReply, toolRequest, type ToolAsk } from "./tools";

const ask: ToolAsk = {
  system: "Be brief.",
  tools: [{ name: "search_clients", description: "Find clients", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }],
  turns: [
    { role: "user", text: "Who is ABC's contact?" },
    { role: "assistant", text: "", calls: [{ id: "c1", name: "search_clients", args: { q: "ABC" } }] },
    { role: "tool", results: [{ id: "c1", name: "search_clients", content: '[{"name":"ABC Ltd"}]' }] },
  ],
};

describe("tool requests", () => {
  test("gateway form names map to the three shapes", () => {
    expect(toolForm("chat (newer token limit)")).toBe("chat");
    expect(toolForm("responses")).toBe("responses");
    expect(toolForm("messages")).toBe("messages");
  });
  test("the chat shape carries tool calls and tool results as the gateway expects", () => {
    const body = toolRequest("chat", "m", ask) as { messages: Record<string, unknown>[]; tools: unknown[] };
    expect(body.messages[0]).toEqual({ role: "system", content: "Be brief." });
    expect(body.messages[2]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_clients", arguments: '{"q":"ABC"}' } }] });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '[{"name":"ABC Ltd"}]' });
    expect(body.tools).toHaveLength(1);
  });
  test("the responses shape uses function_call and function_call_output items", () => {
    const body = toolRequest("responses", "m", ask) as { input: Record<string, unknown>[]; instructions: string };
    expect(body.instructions).toBe("Be brief.");
    expect(body.input[1]).toEqual({ type: "function_call", call_id: "c1", name: "search_clients", arguments: '{"q":"ABC"}' });
    expect(body.input[2]).toEqual({ type: "function_call_output", call_id: "c1", output: '[{"name":"ABC Ltd"}]' });
  });
  test("the messages shape uses tool_use and tool_result blocks", () => {
    const body = toolRequest("messages", "m", ask) as { messages: { role: string; content: unknown }[]; tools: { input_schema: unknown }[] };
    expect(body.messages[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "search_clients", input: { q: "ABC" } }] });
    expect(body.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: '[{"name":"ABC Ltd"}]' }] });
    expect(body.tools[0]!.input_schema).toBeDefined();
  });
});

describe("tool replies", () => {
  test("chat replies: text, and tool calls with JSON-string arguments", () => {
    expect(toolReply({ choices: [{ message: { content: "Hi" } }] })).toEqual({ text: "Hi", calls: [] });
    expect(toolReply({ choices: [{ message: { content: null, tool_calls: [{ id: "x", function: { name: "search_clients", arguments: '{"q":"ABC"}' } }] } }] })).toEqual({ text: "", calls: [{ id: "x", name: "search_clients", args: { q: "ABC" } }] });
  });
  test("responses replies", () => {
    const r = toolReply({ output: [{ type: "function_call", call_id: "y", name: "search_clients", arguments: "{}" }, { type: "message", content: [{ type: "output_text", text: "done" }] }] });
    expect(r).toEqual({ text: "done", calls: [{ id: "y", name: "search_clients", args: {} }] });
  });
  test("messages replies", () => {
    const r = toolReply({ content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "z", name: "search_clients", input: { q: "ABC" } }] });
    expect(r).toEqual({ text: "Looking.", calls: [{ id: "z", name: "search_clients", args: { q: "ABC" } }] });
  });
  test("broken argument JSON becomes empty arguments rather than a crash", () => {
    expect(toolReply({ choices: [{ message: { tool_calls: [{ id: "x", function: { name: "f", arguments: "{oops" } }] } }] }).calls[0]!.args).toEqual({});
  });
});
