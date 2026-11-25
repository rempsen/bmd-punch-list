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

const MAX_HEIGHT_FT = 100;
/**
 * How high tile goes up a wall, as feet. A marked value is read as marked: 18", "18 in", "6'", "6 ft", "6' 6\"".
 * A bare number takes `unit` ("in" unless feet is chosen). NaN for nothing, zero, or anything else.
 */
export function parseHeight(text, unit = "in") {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return NaN;
  let ft = NaN;
  const inches = /^(\d+(?:\.\d+)?)\s*(?:"|''|in|in\.|inch|inches)$/.exec(s);
  if (inches) ft = Number(inches[1]) / 12;
  else if (/^\d+(?:\.\d+)?$/.test(s)) ft = unit === "ft" ? Number(s) : Number(s) / 12;
  else ft = parseFeet(s);
  return Number.isFinite(ft) && ft > 0 && ft <= MAX_HEIGHT_FT ? Math.round(ft * 10000) / 10000 : NaN;
}

/** A length or height the way an installer says it: "18 in", "6 ft", "6 ft 6 in". Under 3 ft is given in inches. */
export function heightText(ft) {
  const total = Math.round((Number(ft) || 0) * 12 * 10) / 10;   // to a tenth of an inch
  if (total < 36) return `${total} in`;
  const f = Math.floor(total / 12), i = Math.round((total - f * 12) * 10) / 10;
  return i ? `${f} ft ${i} in` : `${f} ft`;
}
