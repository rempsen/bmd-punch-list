// BMD change (new file): which area a room belongs to, and the estimate section its quantities go under.
// BMD's own code. Pure: no drawing, no engine.
//
// The estimate wants one line per area, not one per room: every Suite Type B together, every Suite Type D together,
// the common areas together, the washrooms together. A room's own name ("106 SUITE TYPE A") stays on its
// measurement for the drawing and the review list; it is never the section.

const WASHROOM = /(^|[^A-Z])(BATH(ROOM)?|W\.?\/?C\.?|WASHROOM|WR|ENSUITE|EN-SUITE|POWDER( ROOM)?|TOILETS?|SHOWERS?|LAV(ATORY)?|RESTROOM|TUB ROOM)([^A-Z]|$)/;
const SUITE = /(^|[^A-Z])(SUITE|UNIT|APT\.?|APARTMENT|GUEST ?ROOM|DWELLING)([^A-Z]|$)/;
export const AREA_GROUPS = [["suite", "Suites"], ["common", "Common areas"], ["washroom", "Washrooms"]];

/**
 * Which area a room is counted under: "suite", "common" or "washroom". A washroom is a washroom wherever it is;
 * any other space takes the area of the room it is inside (`parentName`), if any.
 */
export function areaGroup(name, parentName = "") {
  const n = String(name ?? "").toUpperCase();
  if (WASHROOM.test(n)) return "washroom";
  return SUITE.test(n) || SUITE.test(String(parentName ?? "").toUpperCase()) ? "suite" : "common";
}

// "SUITE TYPE B" → "Suite Type B". Short words, and words with a figure or a full stop in them, are left as lettered.
const title = (s) => String(s ?? "").trim().replace(/\s+/g, " ").split(" ").map((w) => (w.length <= 2 || /[\d.]/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");

/**
 * The estimate section for an area. Suites go under their own type, read from the suite's name on the drawing;
 * a suite with no type lettered is "Suites".
 * @param {"suite"|"common"|"washroom"} group
 * @param {string} suiteName the tagged suite's name (for a space inside a suite, the suite it is inside)
 */
export function areaSection(group, suiteName = "") {
  if (group === "washroom") return "Washrooms";
  if (group !== "suite") return "Common areas";
  const n = title(suiteName);
  return !n || /^(suite|unit|apt\.?|apartment)s?$/i.test(n) || !SUITE.test(n.toUpperCase()) ? "Suites" : n;
}

/**
 * The section one measurement's quantities go under, before the finish's own variant name is considered.
 * Hand-made work: the area name typed on it. Automatic work (floors, spaces inside rooms, base): its area section,
 * unless someone has typed a different area name over the room's.
 */
export function sectionOf(shape) {
  const label = String(shape?.label ?? "").trim();
  const a = shape?.origin?.auto;
  if (shape?.origin?.method !== "auto_v1" || !a) return label;
  if (a.kind === "transition" || a.kind === "count") return label === String(a.room ?? "").trim() ? "" : label;
  const own = [a.room, a.name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  if (label && label !== own) return label;
  if (typeof a.section === "string" && a.section.trim()) return a.section.trim();
  const group = a.group === "suite" || a.group === "common" || a.group === "washroom" ? a.group : areaGroup(a.name);
  return areaSection(group, group === "suite" ? a.name : "");
}
