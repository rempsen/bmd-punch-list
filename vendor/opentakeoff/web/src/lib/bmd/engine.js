// BMD change (new file): OpenTakeoff's measuring engine behind a small, plain interface for the simple BMD takeoff
// screen. Reading the scale, filling a room, tracing and snapping are OpenTakeoff's own functions (lib/oneclick.ts,
// lib/detectRooms.ts, lib/sheets.ts, lib/geometry.js). What BMD adds, in ./roomParts.js, is deciding which linework
// is building and which is markup or text before a room is filled, and finding cabinets and fixtures afterwards.
//
// Positions are in "image pixels": PDF points × RENDER_SCALE, origin at the top left, y downwards. That is the
// space OpenTakeoff measures in, and a scale ("upp") is real feet per image pixel.
import { extractVectorGeometry } from "../oneclick.ts";
import { buildSnapGrid, nearestSnap } from "../geometry.js";
import { createRoomFinder, textBoxes } from "./roomParts.js";
import { baseRuns } from "./baseFromRoom.js";
import { detectScale, extractSheetNumber, STANDARD_SCALES } from "../sheets.ts";
import { RENDER_SCALE, SNAP_CELL, SNAP_TOL } from "../takeoffConstants.ts";

export { RENDER_SCALE, STANDARD_SCALES };

/**
 * @param {{page: any, OPS: Record<string, number>}} deps a pdf.js page and pdf.js's operator table
 */
export function createSheetEngine({ page, OPS }) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const pt = page.getViewport({ scale: 1 });
  const dims = { w: viewport.width, h: viewport.height };
  let textP = null;
  let geoP = null;
  let finderP = null;

  const text = () => (textP ??= page.getTextContent());
  const geometry = () =>
    (geoP ??= (async () => {
      const geo = extractVectorGeometry(await page.getOperatorList(), viewport.transform, OPS);
      return { geo, grid: buildSnapGrid(geo.points, SNAP_CELL) };
    })());

  return {
    dims,
    viewport,
    /** The page's text (pdf.js text content), read once. */
    textContent: () => text(),
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
     * Measures the space around a point: a room to its walls, with tags, notes, arrows and dashed lines inside it
     * ignored; or, when the point is inside a cabinet or fixture, that fixture's footprint.
     * `fixtures` are the cabinet and fixture areas along the room's edge that were left out, and `withFixtures`
     * is the same room measured with them included. `note` says in plain words what was ignored, or is null.
     * @returns {Promise<{ok: false, reason: string} | {ok: true, kind: "room"|"fixture", pointsPx: number[][], areaSf: number, perimeterLf: number, confidence: number|null, note: string|null, ignored: object|null, fixtures: {pointsPx: number[][], areaSf: number}[], withFixtures: {pointsPx: number[][], areaSf: number, perimeterLf: number}|null}>}
     */
    /**
     * A room's outline as wall base: the stretches that run along drawn walls, with door openings left out.
     * See ./baseFromRoom.js for what comes back. When the sheet has no linework to tell openings by, the whole
     * outline is returned and `deducted` is false.
     */
    async baseAlong(pointsPx, upp) {
      const finder = await roomFinder();
      return baseRuns(pointsPx, upp, (await this.hasLinework()) ? (x, y) => finder.edgeAt(x, y, upp) : null);
    },
    async roomAt(x, y, upp) {
      if (!(upp > 0)) return { ok: false, reason: "Set the scale for this sheet first." };
      return (await roomFinder()).roomAt(x, y, upp);
    },
  };
  function roomFinder() {
    return (finderP ??= (async () => {
        const { geo, grid } = await geometry();
        let texts = [];
        try { texts = textBoxes(await text(), viewport.transform); } catch { /* a sheet with unreadable text is sorted on its linework alone */ }
        return createRoomFinder({ geo, texts, dims, pagePt: { w: pt.width, h: pt.height }, renderScale: RENDER_SCALE, nearest: (px, py, d) => nearestSnap(grid, px, py, d) });
    })());
  }
}
