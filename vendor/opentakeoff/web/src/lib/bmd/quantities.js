// BMD change (new file): what the takeoff tells the estimate. Worked out with OpenTakeoff's own totals module on
// every save and sent with it, so BMD Projects always holds the quantities of the takeoff it has stored.
//
// Quantities are as measured: no waste. Waste is added on the estimate line. Measurements still waiting for
// review (a proposal from an import or from the automatic takeoff) are left out until someone accepts them.
import { conditionTotals } from "../totals.js";
import { shapeLabelValue } from "../shapeLabels.js";
import { baseTagOf } from "../variants.ts";

/**
 * @returns {{conditions: {key: string, tag: string, variant: boolean, colour: string}[], rows: {key: string, section: string, floor_sf: number, wall_sf: number, border_sf: number, lf: number, ea: number}[]}}
 */
export function takeoffQuantities(doc) {
  const conditions = [];
  const rows = [];
  const counted = (doc?.shapes || []).filter((s) => s && s.origin?.reviewed !== false);
  for (const c of doc?.conditions || []) {
    const full = String(c.finish_tag ?? "").trim();
    const tag = baseTagOf(full);
    if (!c.id || !tag) continue;
    const variant = full !== tag;
    const own = full.slice(tag.length).replace(/^\s*–\s*/, "").trim();   // "CPT-1 – Level 3" → "Level 3"
    conditions.push({ key: c.id, tag, variant, colour: c.color || "" });
    const bySection = new Map();
    for (const s of counted) {
      if (s.condition_id !== c.id) continue;
      const section = shapeLabelValue(s).trim() || own;
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push(s);
    }
    for (const [section, shapes] of bySection) {
      const [t] = conditionTotals([{ ...c, waste_pct: 0, materials: [] }], shapes);
      rows.push({ key: c.id, section, floor_sf: t.floor_sf, wall_sf: t.wall_sf, border_sf: t.border_sf, lf: t.lf, ea: t.ea });
    }
  }
  return { conditions, rows };
}
