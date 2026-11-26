/** Unit names as the estimate uses them. Unknown units keep their text, upper-cased. */
const TABLE: Record<string, string> = {
  "sq ft": "SF", sqft: "SF", sf: "SF", ft2: "SF", "square feet": "SF", "square foot": "SF", "sq. ft.": "SF", "sq.ft": "SF",
  "sq yd": "SY", sqyd: "SY", sy: "SY", yd2: "SY", "square yards": "SY", "square yard": "SY", "sq. yd.": "SY",
  ft: "LF", lf: "LF", "lin ft": "LF", "linear ft": "LF", "linear feet": "LF", "lineal feet": "LF", "lin. ft.": "LF", feet: "LF",
  ea: "EA", each: "EA", pc: "EA", pcs: "EA", unit: "EA",
  carton: "carton", ctn: "carton", cartons: "carton", box: "carton", boxes: "carton", bx: "carton",
  roll: "roll", rolls: "roll", rl: "roll",
  bag: "bag", bags: "bag",
  pail: "pail", pails: "pail",
  hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  ls: "LS", "lump sum": "LS",
};
export const KNOWN_UOMS = new Set(Object.values(TABLE));

export function normaliseUom(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t || t === "--" || t === "mixed") return null;
  return TABLE[t] ?? TABLE[t.replace(/\.$/, "")] ?? t.toUpperCase();
}
export const isUomText = (text: string) => {
  const t = (text ?? "").trim().toLowerCase();
  return t === "mixed" || t in TABLE;
};

/** SF↔SY (9 SF to a SY) and LF↔ft (the same length). Same unit returns the quantity. */
export function convertQty(qty: number, from: string, to: string): number {
  const f = from.toUpperCase() === "FT" ? "LF" : normaliseUom(from)!;
  const t = to.toUpperCase() === "FT" ? "LF" : normaliseUom(to)!;
  if (f === t) return qty;
  if (f === "SF" && t === "SY") return qty / 9;
  if (f === "SY" && t === "SF") return qty * 9;
  throw new Error(`Cannot convert ${from} to ${to}`);
}
