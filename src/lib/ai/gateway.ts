/**
 * Talking to the app's AI gateway. Gateways differ in which request form a given model accepts, so each qualifying
 * model is asked in the forms below until one answers. When none does, the gateway's own reason is kept for every
 * attempt, so a failure says why instead of only giving a number.
 */
export const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export type Ask = { system: string; prompt: string; maxTokens?: number };
export type Attempt = { model: string; form: string; status: number; detail: string };
export type GatewayResult = { ok: true; text: string; model: string; form: string; attempts: Attempt[] } | { ok: false; message: string; attempts: Attempt[] };
type Res = { ok: boolean; status: number; text: () => Promise<string> };
export type FetchFn = (url: string, init: { method: string; body: string }) => Promise<Res>;

const FORMS: { name: string; path: string; body: (model: string, a: Ask) => Record<string, unknown> }[] = [
  { name: "chat", path: "/chat/completions", body: (model, a) => ({ model, max_tokens: a.maxTokens ?? 8000, messages: [{ role: "system", content: a.system }, { role: "user", content: a.prompt }] }) },
  { name: "chat (newer token limit)", path: "/chat/completions", body: (model, a) => ({ model, max_completion_tokens: a.maxTokens ?? 8000, messages: [{ role: "system", content: a.system }, { role: "user", content: a.prompt }] }) },
  { name: "responses", path: "/responses", body: (model, a) => ({ model, instructions: a.system, input: a.prompt, max_output_tokens: Math.max(16, a.maxTokens ?? 8000) }) },
  { name: "chat (no token limit)", path: "/chat/completions", body: (model, a) => ({ model, messages: [{ role: "user", content: `${a.system}\n\n${a.prompt}` }] }) },
];

const partsText = (parts: unknown): string => (Array.isArray(parts) ? parts.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("") : "");

/** The text of a reply, whichever of the common shapes it came back in. */
export function replyText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as { choices?: { message?: { content?: unknown } }[]; output_text?: unknown; output?: { type?: string; content?: unknown }[]; content?: unknown };
  const chat = b.choices?.[0]?.message?.content;
  if (typeof chat === "string") return chat;
  if (Array.isArray(chat)) return partsText(chat);
  if (typeof b.output_text === "string") return b.output_text;
  if (Array.isArray(b.output)) return b.output.map((o) => (o?.type === "message" || o?.type === undefined ? partsText(o?.content) : "")).join("");
  return partsText(b.content);
}

/** Why the gateway refused, in its own words, kept short. */
export function gatewayError(raw: string): string {
  let reason = raw.trim();
  try {
    const j = JSON.parse(raw) as { error?: unknown; message?: unknown; detail?: unknown };
    const e = j.error;
    const found = typeof e === "string" ? e : e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : typeof j.message === "string" ? j.message : typeof j.detail === "string" ? j.detail : null;
    if (found) reason = found;
  } catch {
    /* not JSON: use the text as it came */
  }
  return reason.replace(/\s+/g, " ").slice(0, 300) || "no reason given";
}

export async function askGateway(fetchFn: FetchFn, models: string[], ask: Ask, opts: { maxModels?: number; /** A form already known to work for these models; asked first. */ preferForm?: string } = {}): Promise<GatewayResult> {
  const attempts: Attempt[] = [];
  const forms = [...FORMS].sort((a, b) => Number(b.name === opts.preferForm) - Number(a.name === opts.preferForm));
  for (const model of models.slice(0, opts.maxModels ?? 3)) {
    for (const form of forms) {
      let res: Res;
      try {
        res = await fetchFn(`${GATEWAY}${form.path}`, { method: "POST", body: JSON.stringify(form.body(model, ask)) });
      } catch (e) {
        attempts.push({ model, form: form.name, status: 0, detail: e instanceof Error ? e.message : String(e) });
        continue;
      }
      const raw = await res.text().catch(() => "");
      if (res.status === 402) return { ok: false, message: "AI credits have run out. Add credits in Lovable under Settings → Plans & credits.", attempts: [...attempts, { model, form: form.name, status: 402, detail: gatewayError(raw) }] };
      if (res.status === 429) return { ok: false, message: "AI is busy right now. Please try again in a minute.", attempts: [...attempts, { model, form: form.name, status: 429, detail: gatewayError(raw) }] };
      if (!res.ok) {
        attempts.push({ model, form: form.name, status: res.status, detail: gatewayError(raw) });
        continue;
      }
      let text = "";
      try {
        text = replyText(JSON.parse(raw)).trim();
      } catch {
        text = "";
      }
      if (text) return { ok: true, text, model, form: form.name, attempts };
      attempts.push({ model, form: form.name, status: res.status, detail: "the model replied with no text" });
    }
  }
  const first = attempts[0];
  const reasons = [...new Set(attempts.map((a) => `${a.status || "no connection"}: ${a.detail}`))].slice(0, 3).join(" | ");
  return { ok: false, message: first ? `The AI model did not answer. The AI service said: ${reasons}` : "There is no AI model to ask.", attempts };
}
