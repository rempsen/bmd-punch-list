// BMD change (new file): pan, zoom and picking for the simple takeoff screen. Image pixels are OpenTakeoff's
// measuring space (see engine.js); a view says how they are placed on screen: screen = image × k + (x, y).
import { distToSeg, pointInPoly } from "../geometry.js";

export const MIN_K = 0.02;
export const MAX_K = 12;

export function fitView(dims, box, margin = 24) {
  const k = Math.max(MIN_K, Math.min((box.w - 2 * margin) / dims.w, (box.h - 2 * margin) / dims.h));
  return { k, x: (box.w - dims.w * k) / 2, y: (box.h - dims.h * k) / 2 };
}

/** Zooms by `factor` keeping the image point under screen point (sx, sy) fixed. */
export function zoomAt(view, sx, sy, factor) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor));
  const f = k / view.k;
  return { k, x: sx - (sx - view.x) * f, y: sy - (sy - view.y) * f };
}

export const toImage = (view, sx, sy) => [(sx - view.x) / view.k, (sy - view.y) / view.k];
export const toScreen = (view, ix, iy) => [ix * view.k + view.x, iy * view.k + view.y];

/** The topmost measurement at an image point, within `tol` image pixels for lines and marks. */
export function nearShape(shapes, dims, ix, iy, tol) {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const pts = (s.verts_norm || []).map(([nx, ny]) => [nx * dims.w, ny * dims.h]);
    if (s.measure_role === "count") {
      if (pts[0] && Math.hypot(pts[0][0] - ix, pts[0][1] - iy) <= tol * 1.6) return s;
    } else if (s.measure_role === "linear" || s.measure_role === "surface_area") {
      for (let j = 1; j < pts.length; j++) if (distToSeg(ix, iy, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) <= tol) return s;
    } else if (pts.length >= 3 && pointInPoly(ix, iy, pts)) return s;
  }
  return null;
}
