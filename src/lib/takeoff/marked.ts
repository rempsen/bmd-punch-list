/**
 * Marked-up drawings for quotes, read from the project's takeoff (the document the takeoff workspace saves).
 * Only accepted measurements are used, the same ones the estimate is priced from. Nothing here knows a price.
 */
type Pt = [number, number];
type DocShape = { id?: string; sheet_id?: string; condition_id?: string; measure_role?: string; verts_norm?: Pt[]; verts_norm_holes?: Pt[][]; cuts_shape_id?: string | null; computed?: { area_sf?: number; perimeter_lf?: number; count?: number } | null; origin?: { reviewed?: boolean } | null };
export type TakeoffDoc = { conditions?: { id: string; finish_tag?: string | null; color?: string | null }[]; shapes?: DocShape[] } | null | undefined;

export type Mark = { kind: "area" | "cut" | "line" | "count"; colour: string; pts: Pt[]; holes: Pt[][] };
export type KeyRow = { label: string; colour: string; kind: "area" | "line" | "count"; quantity: string };
export type MeasuredSheet = { key: string; file: string; page: number; shapes: number };

const FALLBACK = "#2563eb";
const counted = (doc: TakeoffDoc) => (doc?.shapes ?? []).filter((s) => s && s.sheet_id && s.origin?.reviewed !== false && (s.verts_norm?.length ?? 0) > 0);
const whole = (n: number) => Math.round(n).toLocaleString("en-CA");

/** "Plans.pdf#4" → the file and the page. The page is after the last #. */
export function splitSheetKey(key: string): { file: string; page: number } | null {
  const at = key.lastIndexOf("#");
  const page = Number(key.slice(at + 1));
  if (at <= 0 || !Number.isInteger(page) || page < 1) return null;
  return { file: key.slice(0, at), page };
}

/** Sheets with at least one accepted measurement, by file name then page. */
export function measuredSheets(doc: TakeoffDoc): MeasuredSheet[] {
  const n = new Map<string, number>();
  for (const s of counted(doc)) n.set(s.sheet_id!, (n.get(s.sheet_id!) ?? 0) + 1);
  return [...n]
    .flatMap(([key, shapes]) => {
      const at = splitSheetKey(key);
      return at ? [{ key, ...at, shapes }] : [];
    })
    .sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }) || a.page - b.page);
}

/** What a sheet is called on the quote: its number from the title block when the takeoff found one, else the file and page. */
export function sheetLabel(key: string, labels: Record<string, string>): string {
  const known = labels[key]?.trim();
  if (known) return known;
  const at = splitSheetKey(key);
  return at ? `${at.file.replace(/\.pdf$/i, "")}, page ${at.page}` : key;
}

/** The coloured measurements on one sheet and the colour key that goes with them. Points are fractions of the page. */
export function sheetMarks(doc: TakeoffDoc, key: string): { marks: Mark[]; key: KeyRow[] } {
  const cond = new Map((doc?.conditions ?? []).map((c) => [c.id, c]));
  const marks: Mark[] = [];
  const sums = new Map<string, { sf: number; lf: number; ea: number }>();
  for (const s of counted(doc)) {
    if (s.sheet_id !== key) continue;
    const colour = cond.get(s.condition_id ?? "")?.color || FALLBACK;
    const role = s.measure_role;
    const kind: Mark["kind"] = role === "count" ? "count" : role === "linear" || role === "surface_area" ? "line" : role === "deduct" ? "cut" : "area";
    marks.push({ kind, colour, pts: s.verts_norm!, holes: kind === "area" ? (s.verts_norm_holes ?? []) : [] });
    const t = sums.get(s.condition_id ?? "") ?? { sf: 0, lf: 0, ea: 0 };
    const c = s.computed ?? {};
    if (role === "count") t.ea += c.count || 1;
    else if (role === "linear") t.lf += c.perimeter_lf || 0;
    else if (role === "deduct") t.sf -= s.cuts_shape_id ? 0 : c.area_sf || 0;   // a cut already taken out of its area is not taken off twice
    else t.sf += c.area_sf || 0;
    sums.set(s.condition_id ?? "", t);
  }
  const rows: KeyRow[] = [];
  for (const [id, t] of sums) {
    const c = cond.get(id);
    const label = String(c?.finish_tag ?? "").trim() || "Measured";
    const colour = c?.color || FALLBACK;
    if (t.sf > 0.5) rows.push({ label, colour, kind: "area", quantity: `${whole(t.sf)} SF` });
    if (t.lf > 0.5) rows.push({ label, colour, kind: "line", quantity: `${whole(t.lf)} LF` });
    if (t.ea > 0) rows.push({ label, colour, kind: "count", quantity: `${whole(t.ea)} EA` });
  }
  return { marks, key: rows };
}

export type ChosenDrawing = { key: string; file: string; page: number; label: string };
/** The sheets ticked on a quote that still have measurements, in sheet order, with the names the client sees. */
export function chosenDrawings(chosen: string[], doc: TakeoffDoc, labels: Record<string, string>): ChosenDrawing[] {
  const want = new Set(chosen);
  return measuredSheets(doc)
    .filter((s) => want.has(s.key))
    .map((s) => ({ key: s.key, file: s.file, page: s.page, label: sheetLabel(s.key, labels) }));
}

type DocRow = { id: string; section: string; file_name: string; version: number; storage_path: string; mime?: string | null };
const SECTIONS = ["plans", "specifications"];
const SECTION_LABEL: Record<string, string> = { specifications: "Specifications" };
/**
 * The project's drawings by the name the takeoff knows them by: the newest version of each PDF under Plans and
 * Specifications, and a name used in both sections carries its section the second time. Mirrors the takeoff workspace.
 */
export function drawingFiles(rows: DocRow[]): Map<string, { id: string; path: string }> {
  const newest = new Map<string, DocRow>();
  for (const r of rows) {
    if (!SECTIONS.includes(r.section)) continue;
    if (!(/\.pdf$/i.test(r.file_name) || r.mime === "application/pdf")) continue;
    const k = `${r.section}/${r.file_name.toLowerCase()}`;
    const had = newest.get(k);
    if (!had || r.version > had.version) newest.set(k, r);
  }
  const ordered = [...newest.values()].sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.file_name.localeCompare(b.file_name, undefined, { numeric: true }));
  const out = new Map<string, { id: string; path: string }>();
  for (const r of ordered) out.set(out.has(r.file_name) ? `${SECTION_LABEL[r.section] ?? r.section} - ${r.file_name}` : r.file_name, { id: r.id, path: r.storage_path });
  return out;
}
