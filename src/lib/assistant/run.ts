/**
 * The conversation loop: ask the model, run the lookups it asks for, give it the results, and stop when it answers in
 * words or when it has had its rounds. Pure apart from the two functions it is handed (the model and the lookups), so
 * it can be tested without either.
 */
import type { ToolCall, ToolDef, ToolReply, Turn } from "@/lib/ai/tools";
import { lookupRecord, MAX_ROUNDS, resultText, sourcesFrom, type LookupRecord, type Source } from "./prompt";

export type Lookup = (args: Record<string, unknown>) => Promise<unknown>;
export type Lookups = Record<string, Lookup>;
export type ModelFn = (ask: { system: string; turns: Turn[]; tools: ToolDef[] }) => Promise<{ reply: ToolReply; model: string }>;

export type RunResult = { answer: string; lookups: LookupRecord[]; sources: Source[]; model: string | null; rounds: number };

export async function runConversation(a: { system: string; history: Turn[]; message: string; tools: ToolDef[]; lookups: Lookups; model: ModelFn; maxRounds?: number }): Promise<RunResult> {
  const turns: Turn[] = [...a.history, { role: "user", text: a.message }];
  const record: LookupRecord[] = [];
  const results: { name: string; value: unknown }[] = [];
  let model: string | null = null;
  const max = a.maxRounds ?? MAX_ROUNDS;
  let lastText = "";
  for (let round = 1; round <= max; round += 1) {
    const out = await a.model({ system: a.system, turns, tools: a.tools });
    model = out.model;
    const { text, calls } = out.reply;
    if (text) lastText = text;
    if (calls.length === 0) return { answer: text || "I couldn't work out an answer to that.", lookups: record, sources: sourcesFrom(results), model, rounds: round };
    turns.push({ role: "assistant", text, calls });
    record.push(...lookupRecord(calls));
    const answered = await Promise.all(calls.map((c) => runLookup(c, a.lookups)));
    for (const r of answered) if (r.value !== undefined) results.push({ name: r.name, value: r.value });
    turns.push({ role: "tool", results: answered.map((r) => ({ id: r.id, name: r.name, content: r.content })) });
  }
  // Out of rounds: answer with what has been said, and be plain that the search was cut short.
  return {
    answer: lastText ? `${lastText}\n\n(I stopped looking after ${max} rounds of lookups; ask a narrower question to go further.)` : `I looked ${max} times without reaching an answer. Try a narrower question, or name the project or document.`,
    lookups: record,
    sources: sourcesFrom(results),
    model,
    rounds: max,
  };
}

async function runLookup(call: ToolCall, lookups: Lookups): Promise<{ id: string; name: string; content: string; value?: unknown }> {
  const fn = lookups[call.name];
  if (!fn) return { id: call.id, name: call.name, content: `Error: there is no lookup called "${call.name}".` };
  try {
    const value = await fn(call.args);
    return { id: call.id, name: call.name, content: resultText(value), value };
  } catch (e) {
    return { id: call.id, name: call.name, content: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
