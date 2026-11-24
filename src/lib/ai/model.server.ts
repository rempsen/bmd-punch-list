import { askGateway, GATEWAY, gatewayError, type Ask, type Attempt, type FetchFn } from "./gateway";
import { MINIMUM_LABEL, rankModels } from "./model";
import { toolForm, toolReply, toolRequest, type ToolAsk, type ToolForm, type ToolReply } from "./tools";

let cached: { at: number; ids: string[] } | null = null;
/** The model and request form that last answered, so a long document is not sent several times while finding out. */
let working: { model: string; form: string } | null = null;

const headers = (key: string) => ({ Authorization: `Bearer ${key}`, "Lovable-API-Key": key, "Content-Type": "application/json" });

/** The model ids the app's AI connection offers right now (remembered for ten minutes). */
export async function availableModels(key: string): Promise<string[]> {
  if (cached && Date.now() - cached.at < 600_000) return cached.ids;
  const res = await fetch(`${GATEWAY}/models`, { headers: headers(key) });
  if (!res.ok) throw new Error(`The AI connection would not list its models (${res.status}).`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  cached = { at: Date.now(), ids };
  return ids;
}

export class ModelStandardError extends Error {}
export class ModelAnswerError extends Error {
  constructor(message: string, readonly attempts: Attempt[]) {
    super(message);
  }
}

/** Asks the strongest model that meets BMD's standard and answers. Never falls back to a weaker one. */
export async function askStrongModel(input: Ask): Promise<{ text: string; model: string; attempts: Attempt[] }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not set up for this app.");
  const models = rankModels(await availableModels(key));
  if (models.length === 0) throw new ModelStandardError(`This app's AI connection does not offer ${MINIMUM_LABEL} or stronger, so this feature is switched off rather than use a weaker model.`);
  const fetchFn: FetchFn = (url, init) => fetch(url, { ...init, headers: headers(key) });
  // Find out with a few words which model and request form answer, before sending anything long.
  if (!working || !models.includes(working.model)) {
    const probe = await askGateway(fetchFn, models, { system: "Reply with the single word OK.", prompt: "Reply OK.", maxTokens: 32 });
    if (!probe.ok) throw new ModelAnswerError(probe.message, probe.attempts);
    working = { model: probe.model, form: probe.form };
  }
  const known = working;
  const res = await askGateway(fetchFn, [known.model, ...models.filter((m) => m !== known.model)], input, { preferForm: known.form, maxModels: 2 });
  if (!res.ok) {
    working = null;
    throw new ModelAnswerError(res.message, res.attempts);
  }
  working = { model: res.model, form: res.form };
  return { text: res.text, model: res.model, attempts: res.attempts };
}

/**
 * One round of a conversation with tools, to the strongest model that answers. The request shape follows the form that
 * last answered a plain question; if the gateway refuses tools in that shape, the other shapes are tried in turn.
 */
export async function askStrongModelWithTools(ask: ToolAsk): Promise<{ reply: ToolReply; model: string; form: ToolForm }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not set up for this app.");
  const models = rankModels(await availableModels(key));
  if (models.length === 0) throw new ModelStandardError(`This app's AI connection does not offer ${MINIMUM_LABEL} or stronger, so the assistant is switched off rather than use a weaker model.`);
  const fetchFn: FetchFn = (url, init) => fetch(url, { ...init, headers: headers(key) });
  if (!working || !models.includes(working.model)) {
    const probe = await askGateway(fetchFn, models, { system: "Reply with the single word OK.", prompt: "Reply OK.", maxTokens: 32 });
    if (!probe.ok) throw new ModelAnswerError(probe.message, probe.attempts);
    working = { model: probe.model, form: probe.form };
  }
  const first = toolForm(working.form);
  const forms: ToolForm[] = [first, ...(["chat", "responses", "messages"] as ToolForm[]).filter((f) => f !== first)];
  const paths: Record<ToolForm, string> = { chat: "/chat/completions", responses: "/responses", messages: "/messages" };
  const attempts: Attempt[] = [];
  for (const model of [working.model, ...models.filter((m) => m !== working!.model)].slice(0, 2)) {
    for (const form of forms) {
      let res: { ok: boolean; status: number; text: () => Promise<string> };
      try {
        res = await fetchFn(`${GATEWAY}${paths[form]}`, { method: "POST", body: JSON.stringify(toolRequest(form, model, ask)) });
      } catch (e) {
        attempts.push({ model, form, status: 0, detail: e instanceof Error ? e.message : String(e) });
        continue;
      }
      const raw = await res.text().catch(() => "");
      if (res.status === 402) throw new ModelAnswerError("AI credits have run out. Add credits in Lovable under Settings → Plans & credits.", attempts);
      if (res.status === 429) throw new ModelAnswerError("AI is busy right now. Please try again in a minute.", attempts);
      if (!res.ok) {
        attempts.push({ model, form, status: res.status, detail: gatewayError(raw) });
        continue;
      }
      let reply: ToolReply = { text: "", calls: [] };
      try {
        reply = toolReply(JSON.parse(raw));
      } catch {
        /* not JSON */
      }
      if (reply.text || reply.calls.length) return { reply, model, form };
      attempts.push({ model, form, status: res.status, detail: "the model replied with nothing" });
    }
  }
  const reasons = [...new Set(attempts.map((a) => `${a.status || "no connection"}: ${a.detail}`))].slice(0, 3).join(" | ");
  throw new ModelAnswerError(`The AI model did not answer. The AI service said: ${reasons}`, attempts);
}
