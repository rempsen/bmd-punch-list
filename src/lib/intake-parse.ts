import type { Parsed } from "./intake.server";

const FIELDS = ["job", "floor", "location", "area", "material", "issue_type", "assessment", "description", "due_date", "urgency"] as const;

/** Reads the deficiency record out of the model's reply. Anything not a string is null; no JSON at all is an error. */
export function parseIntakeReply(text: string): Parsed {
  const m = text.match(/\{[\s\S]*\}/);
  let body: Record<string, unknown>;
  try {
    body = m ? (JSON.parse(m[0]) as Record<string, unknown>) : (null as never);
  } catch {
    body = null as never;
  }
  if (!body || typeof body !== "object") throw new Error("The AI reply had no record in it.");
  const out = Object.fromEntries(FIELDS.map((f) => [f, typeof body[f] === "string" && (body[f] as string).trim() ? (body[f] as string).trim() : null])) as Omit<Parsed, "confidence">;
  const c = (body["confidence"] ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof c[k] === "number" && Number.isFinite(c[k]) ? Math.max(0, Math.min(1, c[k] as number)) : 0);
  return { ...out, confidence: { job: n("job"), location: n("location"), material: n("material"), issue_type: n("issue_type") } };
}
