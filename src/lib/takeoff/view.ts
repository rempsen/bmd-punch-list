/** Where a plan sheet sits in the window: pixels per PDF point, and the pixel position of the sheet's top-left corner. */
export type View = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

const MAX_SCALE = 12;
const KEEP_IN_SIGHT = 80;

export function fitView(page: Size, box: Size): View {
  const scale = Math.min(box.width / page.width, box.height / page.height);
  return { scale, x: (box.width - page.width * scale) / 2, y: (box.height - page.height * scale) / 2 };
}

/** Keeps at least a strip of the sheet inside the window. */
export function clampView(v: View, page: Size, box: Size): View {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return { scale: v.scale, x: clamp(v.x, KEEP_IN_SIGHT - page.width * v.scale, box.width - KEEP_IN_SIGHT), y: clamp(v.y, KEEP_IN_SIGHT - page.height * v.scale, box.height - KEEP_IN_SIGHT) };
}

/** Zooms by a factor about a point in the window, so what is under the pointer stays under it. */
export function zoomAt(v: View, factor: number, at: { x: number; y: number }, page: Size, box: Size): View {
  const min = fitView(page, box).scale / 2;
  const scale = Math.min(MAX_SCALE, Math.max(min, v.scale * factor));
  const k = scale / v.scale;
  return clampView({ scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, page, box);
}

export type SheetRef = { id: string; page_number: number; sheet_number: string | null; title: string | null };
export const sheetLabel = (s: SheetRef) => s.sheet_number?.trim() || `Page ${s.page_number}`;

export function filterSheets<T extends SheetRef>(sheets: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return sheets;
  return sheets.filter((s) => `${sheetLabel(s)} ${s.title ?? ""} page ${s.page_number}`.toLowerCase().includes(q) && (!/^\d+$/.test(q) || String(s.page_number) === q || sheetLabel(s).toLowerCase().includes(q) && !/^page /i.test(sheetLabel(s))));
}
