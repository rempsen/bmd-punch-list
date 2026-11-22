import { chooseModel, MINIMUM_LABEL } from "./model";

const BASE = "https://ai.gateway.lovable.dev/v1";
let cached: { at: number; ids: string[] } | null = null;

const headers = (key: string) => ({ Authorization: `Bearer ${key}`, "Lovable-API-Key": key, "Content-Type": "application/json" });

/** The model ids the app's AI connection offers right now (remembered for ten minutes). */
export async function availableModels(key: string): Promise<string[]> {
  if (cached && Date.now() - cached.at < 600_000) return cached.ids;
  const res = await fetch(`${BASE}/models`, { headers: headers(key) });
  if (!res.ok) throw new Error(`The AI connection would not list its models (${res.status}).`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
  cached = { at: Date.now(), ids };
  return ids;
}

export class ModelStandardError extends Error {}

/** Asks the strongest model that meets BMD's standard. Refuses rather than fall back to a weaker one. */
export async function askStrongModel(input: { system: string; prompt: string; maxTokens?: number }): Promise<{ text: string; model: string }> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not set up for this app.");
  const model = chooseModel(await availableModels(key));
  if (!model) throw new ModelStandardError(`This app's AI connection does not offer ${MINIMUM_LABEL} or stronger, so this feature is switched off rather than use a weaker model.`);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ model, max_tokens: input.maxTokens ?? 8000, messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }] }),
  });
  if (res.status === 402) throw new Error("AI credits have run out. Add credits in Settings → Plans & credits.");
  if (res.status === 429) throw new Error("AI is busy right now. Please try again in a minute.");
  if (!res.ok) throw new Error(`The AI model did not answer (${res.status}). Please try again.`);
  const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : "";
  return { text, model };
}
