// BMD change (new file): OpenTakeoff's measuring engine behind a small, plain interface for the simple BMD takeoff
// screen. Nothing here measures anything itself: reading the scale, finding a room's walls, tracing and snapping
// are all OpenTakeoff's own functions (lib/oneclick.ts, lib/detectRooms.ts, lib/sheets.ts, lib/geometry.js), called
// in the same order its own tools call them, so the numbers are the same numbers.
//
// Positions are in "image pixels": PDF points × RENDER_SCALE, origin at the top left, y downwards. That is the
// space OpenTakeoff measures in, and a scale ("upp") is real feet per image pixel.
import { extractVectorGeometry, buildMask, traceRegion, snapVertices, ringArea, MASK_MAX_DIM } from "../oneclick.ts";
import { floodAtSeed } from "../detectRooms.ts";
import { buildSnapGrid, nearestSnap, closedMetrics } from "../geometry.js";
import { detectScale, extractSheetNumber, STANDARD_SCALES } from "../sheets.ts";
import { RENDER_SCALE, SNAP_CELL, SNAP_TOL } from "../takeoffConstants.ts";

export { RENDER_SCALE, STANDARD_SCALES };
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{page: any, OPS: Record<string, number>}} deps a pdf.js page and pdf.js's operator table
 */
export function createSheetEngine({ page, OPS }) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const pt = page.getViewport({ scale: 1 });
  const dims = { w: viewport.width, h: viewport.height };
  let textP = null;
  let geoP = null;
  const masks = new Map();   // scale → mask; a mask bakes the scale in

  const text = () => (textP ??= page.getTextContent());
  const geometry = () =>
    (geoP ??= (async () => {
      const geo = extractVectorGeometry(await page.getOperatorList(), viewport.transform, OPS);
      return { geo, grid: buildSnapGrid(geo.points, SNAP_CELL) };
    })());

  return {
    dims,
    viewport,
    /** The scale written on the sheet ({label, upp}), or null when none can be read with confidence. */
    async detectedScale() {
      try {
        return detectScale(await text(), viewport);
      } catch {
        return null;
      }
    },
    /** The sheet number from the title block, or null. */
    async sheetNumber() {
      try {
        return extractSheetNumber(await text(), viewport);
      } catch {
        return null;
      }
    },
    /** The nearest real corner or line end on the drawing within `maxDist` image pixels, or null. */
    async snap(x, y, maxDist = SNAP_TOL) {
      const { grid } = await geometry();
      return nearestSnap(grid, x, y, maxDist) ?? null;
    },
    /** True when the sheet has drawn linework to measure against (a scan has none). */
    async hasLinework() {
      return (await geometry()).geo.segs.length > 0;
    },
    /**
     * Measures the enclosed space around a point, to its walls.
     * @returns {Promise<{ok: true, pointsPx: number[][], areaSf: number, perimeterLf: number, confidence: number|null} | {ok: false, reason: string}>}
     */
    async roomAt(x, y, upp) {
      if (!(upp > 0)) return { ok: false, reason: "Set the scale for this sheet first." };
      const { geo, grid } = await geometry();
      if (!geo.segs.length) return { ok: false, reason: "This sheet is a scan with no drawn linework, so a room cannot be found by clicking. Draw around it instead." };
      let mask = masks.get(upp);
      if (!mask) {
        const pxPerFt = 1 / upp;
        mask = buildMask(geo.segs, dims.w, dims.h, MASK_MAX_DIM, geo.meta, pxPerFt, pxPerFt, { pageW: pt.width, pageH: pt.height, renderScale: RENDER_SCALE, baseScale: RENDER_SCALE }, null);
        masks.clear();
        masks.set(upp, mask);
      }
      const flood = floodAtSeed(mask, x, y);
      if (flood.status === "leak") return { ok: false, reason: "That space isn't enclosed on the drawing: the fill escaped through a gap or an opening. Draw around it instead." };
      if (flood.status !== "ok") return { ok: false, reason: "That landed on dense linework such as hatching or text. Click an open spot inside the room, or draw around it." };
      const ring = snapVertices(traceRegion(flood), (px, py, d) => nearestSnap(grid, px, py, d), SNAP_TOL);
      if (ring.length < 3) return { ok: false, reason: "That space could not be traced. Draw around it instead." };
      return {
        ok: true,
        pointsPx: ring.map(([px, py]) => [px, py]),
        areaSf: round2(ringArea(ring) * upp * upp),
        perimeterLf: round2(closedMetrics(ring).perim * upp),
        confidence: typeof flood.confidence === "number" ? flood.confidence : null,
      };
    },
  };
}
