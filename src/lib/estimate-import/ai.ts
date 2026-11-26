import { MAPPING_FIELDS, type Mapping, type MappingField } from "./types";

/** Asks the model; injected in tests. Defaults to the app's strongest-model rule (Opus 5.5 or better). */
export type AskFn = (a: { system: string; prompt: string; maxTokens?: number }) => Promise<string>;
const defaultAsk: AskFn = async (a) => (await (await import("@/lib/ai/model.server")).askStrongModel(a)).text;

function jsonFrom(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/**
 * Names columns the parser could not. Returns only additions for fields that are still unmapped and columns
 * still unused — never numbers, never a change to a mapped field. Best-effort: any failure returns {}.
 */
export async function nameUnknownColumns(headerCells: string[], sampleRows: string[][], current: Mapping = {}, ask: AskFn = defaultAsk): Promise<Mapping> {
  const used = new Set(Object.values(current));
  const unknown = headerCells.map((h, i) => ({ i, h })).filter((c) => !used.has(c.i) && c.h.trim());
  const open = MAPPING_FIELDS.filter((f) => current[f] === undefined);
  if (!unknown.length || !open.length) return {};
  try {
    const reply = await ask({
      system: "You map estimate spreadsheet columns to fields. Reply with JSON only: {\"<field>\": <column index>}. Use only the listed fields and columns. Omit anything unsure.",
      prompt: `Fields: ${open.join(", ")}\nColumns:\n${unknown.map((c) => `${c.i}: ${c.h} — e.g. ${sampleRows.slice(0, 3).map((r) => r[c.i] ?? "").join(" | ")}`).join("\n")}`,
      maxTokens: 400,
    });
    const body = jsonFrom(reply);
    if (!body || typeof body !== "object") return {};
    const delta: Mapping = {};
    const taken = new Set<number>();
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (!open.includes(k as MappingField) || typeof v !== "number" || !unknown.some((c) => c.i === v) || taken.has(v)) continue;
      delta[k as MappingField] = v; taken.add(v);
    }
    return delta;
  } catch { return {}; }
}

export type DescriptionHints = { finish_hint?: string; scope_hint?: string; area_hint?: string };
/** Splits a description like "Carpet- Basement - Both bedrooms." into hints. Best-effort; never blocks. */
export async function splitDescription(text: string, ask: AskFn = defaultAsk): Promise<DescriptionHints> {
  if (!text.trim()) return {};
  try {
    const body = jsonFrom(await ask({
      system: "Split a flooring estimate line description. Reply JSON only with optional string keys finish_hint (material/finish), scope_hint (work), area_hint (room/area).",
      prompt: text.slice(0, 500), maxTokens: 200,
    })) as Record<string, unknown> | null;
    const out: DescriptionHints = {};
    for (const k of ["finish_hint", "scope_hint", "area_hint"] as const) if (typeof body?.[k] === "string" && body[k]) out[k] = (body[k] as string).slice(0, 200);
    return out;
  } catch { return {}; }
}
