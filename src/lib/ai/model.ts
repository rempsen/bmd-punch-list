/**
 * Which AI model the app's reading and matching features use. BMD's standard is Claude Opus 5.5 or stronger:
 * if the AI connection offers nothing at that level, the feature says so instead of quietly using a weaker model.
 */
function rank(id: string): number | null {
  const m = /claude-(fable|opus)-(\d+)(?:[.-](\d{1,2}))?(?![\d])/i.exec(id);
  if (!m) return null;
  const version = Number(m[2]) + Number(m[3] ?? 0) / 100;
  // Fable sits above Opus of any version; within a family the higher version wins.
  return m[1]!.toLowerCase() === "fable" ? 1000 + version : version >= 5.05 ? version : null;
}
export const meetsMinimum = (id: string) => rank(id) != null;

export function chooseModel(available: string[]): string | null {
  const ranked = available.map((id) => ({ id, r: rank(id) })).filter((x): x is { id: string; r: number } => x.r != null);
  return ranked.sort((a, b) => b.r - a.r)[0]?.id ?? null;
}
export const MINIMUM_LABEL = "Claude Opus 5.5";
