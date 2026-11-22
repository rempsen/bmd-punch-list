/** Drawing scales. A scale is kept as feet of building per point of paper (1 point = 1/72 inch). */
export type Pt = { x: number; y: number };

const ARCH = /(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(?:"|”|in\.?)\s*=\s*(\d+)\s*(?:'|’|ft\.?)(?:\s*-?\s*(\d+)\s*(?:"|”)?)?/i;
const METRIC = /\b1\s*:\s*(\d{1,5})\b/;

const mixed = (s: string) =>
  s.trim().split(/\s+/).reduce((n, part) => {
    const [a, b] = part.split("/");
    return n + (b ? Number(a) / Number(b) : Number(a));
  }, 0);

/** The ratio of real size to drawn size stated in a piece of text, e.g. 96 for 1/8" = 1'-0". Null when there is none (including N.T.S.). */
export function parseScaleText(s: string): { ratio: number } | null {
  const a = ARCH.exec(s);
  if (a) {
    const paper = mixed(a[1]!);
    const real = Number(a[2]) * 12 + Number(a[3] ?? 0);
    return paper > 0 && real > 0 ? { ratio: real / paper } : null;
  }
  const m = METRIC.exec(s);
  if (m && Number(m[1]) > 0) return { ratio: Number(m[1]) };
  return null;
}

export const feetPerPoint = (ratio: number) => ratio / 72 / 12;

const ARCH_LABELS: [number, string][] = [[192, '1/16" = 1\'-0"'], [128, '3/32" = 1\'-0"'], [96, '1/8" = 1\'-0"'], [64, '3/16" = 1\'-0"'], [48, '1/4" = 1\'-0"'], [32, '3/8" = 1\'-0"'], [24, '1/2" = 1\'-0"'], [16, '3/4" = 1\'-0"'], [12, '1" = 1\'-0"'], [8, '1 1/2" = 1\'-0"'], [4, '3" = 1\'-0"']];
const METRIC_RATIOS = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];
export const COMMON_SCALES = [...ARCH_LABELS.map(([ratio, label]) => ({ ratio, label })), ...[50, 100, 200].map((ratio) => ({ ratio, label: `1:${ratio}` }))];

export function scaleLabel(fpp: number): string {
  const ratio = fpp * 864;
  const near = (r: number) => Math.abs(ratio - r) / r < 0.001;
  const arch = ARCH_LABELS.find(([r]) => near(r));
  if (arch) return arch[1];
  const metric = METRIC_RATIOS.find(near);
  return metric ? `1:${metric}` : `1:${Math.round(ratio)} (calibrated)`;
}

/** A scale to offer for a sheet, only when its text states exactly one. Two different scales on a sheet mean details at other scales: a person decides. */
export function suggestScale(items: { str: string; x: number; y: number }[], _page: { width: number; height: number }): { ratio: number; source: string } | null {
  const found = new Map<number, string>();
  for (const it of items) {
    const p = parseScaleText(it.str);
    if (p && !found.has(Math.round(p.ratio * 1000))) found.set(Math.round(p.ratio * 1000), it.str.trim());
  }
  if (found.size !== 1) return null;
  const [key, source] = [...found][0]!;
  return { ratio: key / 1000, source };
}

export function calibrate(p1: Pt, p2: Pt, realFeet: number): number {
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(d > 0)) throw new Error("Pick two different points");
  if (!(realFeet > 0)) throw new Error("Enter the real length");
  return realFeet / d;
}

export type SheetScale = { region: { x: number; y: number; width: number; height: number } | null; feet_per_point: number };
/** The scale in force at a point: the smallest region containing it, else the whole-sheet scale. */
export function scaleAt(scales: SheetScale[], p: Pt): number | null {
  const inside = scales.filter((s) => s.region && p.x >= s.region.x && p.x <= s.region.x + s.region.width && p.y >= s.region.y && p.y <= s.region.y + s.region.height).sort((a, b) => a.region!.width * a.region!.height - b.region!.width * b.region!.height);
  return (inside[0] ?? scales.find((s) => !s.region))?.feet_per_point ?? null;
}
