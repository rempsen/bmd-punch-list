/**
 * Tool calls through the app's AI gateway. The gateway speaks three shapes (OpenAI chat, OpenAI responses, Anthropic
 * messages), and gateway.ts already finds out which one a model answers in. This file encodes a conversation with tools
 * in each of those shapes and reads back the model's text and the tools it asks for, so the assistant can run its
 * lookups and reply with the results. Pure: nothing here talks to the network.
 */
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ToolResult = { id: string; name: string; content: string };
/** One step of a conversation: what was said, what the model asked for, and what the lookups answered. */
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };
export type ToolAsk = { system: string; turns: Turn[]; tools: ToolDef[]; maxTokens?: number };
export type ToolReply = { text: string; calls: ToolCall[] };
export type ToolForm = "chat" | "responses" | "messages";

/** Which of the three shapes a gateway form name belongs to. */
export function toolForm(formName: string): ToolForm {
  if (formName.startsWith("responses")) return "responses";
  if (formName.startsWith("messages")) return "messages";
  return "chat";
}

const argsOf = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** The request body for a conversation with tools, in the given shape. */
export function toolRequest(form: ToolForm, model: string, ask: ToolAsk): Record<string, unknown> {
  const max = ask.maxTokens ?? 4000;
  if (form === "chat") {
    const messages: unknown[] = [{ role: "system", content: ask.system }];
    for (const t of ask.turns) {
      if (t.role === "user") messages.push({ role: "user", content: t.text });
      else if (t.role === "assistant")
        messages.push({
          role: "assistant",
          content: t.text || null,
          ...(t.calls.length ? { tool_calls: t.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
        });
      else for (const r of t.results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
    }
    return { model, max_tokens: max, messages, tools: ask.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) };
  }
  if (form === "responses") {
    const input: unknown[] = [];
    for (const t of ask.turns) {
      if (t.role === "user") input.push({ role: "user", content: t.text });
      else if (t.role === "assistant") {
        if (t.text) input.push({ role: "assistant", content: t.text });
        for (const c of t.calls) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) });
      } else for (const r of t.results) input.push({ type: "function_call_output", call_id: r.id, output: r.content });
    }
    return { model, instructions: ask.system, input, max_output_tokens: Math.max(16, max), tools: ask.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })) };
  }
  const messages: unknown[] = [];
  for (const t of ask.turns) {
    if (t.role === "user") messages.push({ role: "user", content: t.text });
    else if (t.role === "assistant")
      messages.push({ role: "assistant", content: [...(t.text ? [{ type: "text", text: t.text }] : []), ...t.calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args }))] });
    else messages.push({ role: "user", content: t.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content })) });
  }
  return { model, max_tokens: max, system: ask.system, messages, tools: ask.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) };
}

const partsText = (parts: unknown): string => (Array.isArray(parts) ? parts.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("") : "");

/** The model's text and the tools it asked for, whichever shape the reply came back in. */
export function toolReply(body: unknown): ToolReply {
  const none: ToolReply = { text: "", calls: [] };
  if (!body || typeof body !== "object") return none;
  const b = body as {
    choices?: { message?: { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[];
    output?: { type?: string; content?: unknown; call_id?: string; id?: string; name?: string; arguments?: unknown }[];
    output_text?: unknown;
    content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
  };
  const msg = b.choices?.[0]?.message;
  if (msg) {
    const text = typeof msg.content === "string" ? msg.content : partsText(msg.content);
    const calls = (msg.tool_calls ?? []).filter((c) => c.function?.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function!.name!, args: argsOf(c.function!.arguments) }));
    return { text: text.trim(), calls };
  }
  if (Array.isArray(b.output)) {
    const text = typeof b.output_text === "string" ? b.output_text : b.output.map((o) => (o?.type === "message" ? partsText(o.content) : "")).join("");
    const calls = b.output.filter((o) => o?.type === "function_call" && o.name).map((o, i) => ({ id: o.call_id || o.id || `call_${i}`, name: o.name!, args: argsOf(o.arguments) }));
    return { text: text.trim(), calls };
  }
  if (Array.isArray(b.content)) {
    const text = b.content.map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : "")).join("");
    const calls = b.content.filter((c) => c?.type === "tool_use" && c.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name!, args: argsOf(c.input) }));
    return { text: text.trim(), calls };
  }
  return none;
}
