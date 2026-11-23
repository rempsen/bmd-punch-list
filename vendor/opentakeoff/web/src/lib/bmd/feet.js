// BMD change (new file): reads a length a person typed, as feet.

/** "12.5", "12 ft", "12' 6\"", "12 ft 6 in" or "12-6" as feet; NaN for anything else. */
export function parseFeet(text) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return NaN;
  const m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|-)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/.exec(s);
  if (m) {
    const inches = m[2] ? Number(m[2]) : 0;
    return inches < 12 ? Number(m[1]) + inches / 12 : NaN;
  }
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
}
