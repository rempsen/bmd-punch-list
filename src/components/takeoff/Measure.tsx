import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Redo2, Ruler, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { hitTest, measureShape, parseFeet, polylineLength, totalsByCondition, type Shape, type ShapeKind } from "@/lib/takeoff/geometry";
import { calibrate, COMMON_SCALES, feetPerPoint, scaleLabel, suggestScale, type Pt } from "@/lib/takeoff/scale";
import { COLOURS, type Condition, type TakeoffActions, type TakeoffData } from "@/lib/takeoff/store";
import { findTags, type SheetText } from "@/lib/ai/scope";
import { sheetText } from "@/lib/takeoff/pdf";
import { PlanViewer } from "./PlanViewer";

type Mode = "pan" | "draw" | "cutout" | "calibrate" | "check";
type Step = { undo: () => Promise<void>; redo: () => Promise<void> };
const num = (n: number, d = 1) => n.toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });
const totalText = (kind: ShapeKind, m: { sf: number; sy: number; lf: number; ea: number }) => (kind === "area" ? `${num(m.sf)} SF · ${num(m.sy)} SY` : kind === "linear" ? `${num(m.lf)} LF` : `${num(m.ea, 0)} EA`);
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

type Props = { doc: PDFDocumentProxy; pageNumber: number; sheetId: string | null; data: TakeoffData; actions: TakeoffActions; canEdit: boolean; conditionExtra?: (c: Condition) => React.ReactNode; finishes?: { id: string; tag: string; description: string | null }[]; onPageSize?: (size: { width: number; height: number }, rotation: number) => void };

/** One sheet with its scale, the conditions being measured, and the tools to draw them. Nothing is drawn until the sheet has a scale. */
export function Measure({ doc, pageNumber, sheetId, data, actions, canEdit, conditionExtra, finishes = [], onPageSize }: Props) {
  const [mode, setMode] = useState<Mode>("pan");
  const [conditionId, setConditionId] = useState<string | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<{ ratio: number; source: string } | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ label: string; kind: ShapeKind; section: string; finishId: string } | null>(null);
  const [text, setText] = useState<SheetText[]>([]);
  const [tag, setTag] = useState("");
  const undo = useRef<Step[]>([]);
  const redo = useRef<Step[]>([]);
  const [, bump] = useState(0);

  const scale = data.scales.find((s) => s.sheet_id === sheetId && !s.region) ?? null;
  const fpp = scale?.feet_per_point ?? null;
  const sheetShapes = useMemo(() => data.shapes.filter((s) => s.sheet_id === sheetId), [data.shapes, sheetId]);
  const totals = useMemo(() => totalsByCondition(data.shapes), [data.shapes]);
  const condition = data.conditions.find((c) => c.id === conditionId) ?? null;
  const colourOf = (id: string) => data.conditions.find((c) => c.id === id)?.colour ?? "#2563eb";
  const sel = sheetShapes.find((s) => s.id === selected) ?? null;

  useEffect(() => {
    setPts([]);
    setMode("pan");
    setSelected(null);
    setChecked(null);
    setSuggested(null);
    setText([]);
    let stale = false;
    void sheetText(doc, pageNumber).then((t) => {
      if (stale) return;
      setText(t.items);
      setSuggested(suggestScale(t.items, t.page));
    }, () => undefined);
    return () => {
      stale = true;
    };
  }, [doc, pageNumber]);

  const run = async (step: Step) => {
    try {
      await step.redo();
      undo.current.push(step);
      redo.current = [];
      bump((n) => n + 1);
    } catch (e) {
      err(e);
    }
  };
  const stepBack = async (from: Step[], to: Step[], dir: "undo" | "redo") => {
    const step = from.pop();
    if (!step) return;
    try {
      await step[dir]();
      to.push(step);
    } catch (e) {
      from.push(step);
      err(e);
    }
    bump((n) => n + 1);
  };

  const setScale = (value: number, provenance: "suggested" | "chosen" | "calibrated") => {
    if (!sheetId) return;
    const before = scale;
    if (sheetShapes.length > 0 && !window.confirm(`Change the scale of this sheet? ${sheetShapes.length} measurement${sheetShapes.length === 1 ? "" : "s"} on it will be re-measured, and estimate lines fed by them will be flagged.`)) return;
    void run({ redo: () => actions.setScale(sheetId, value, provenance), undo: () => (before ? actions.setScale(sheetId, before.feet_per_point, before.provenance) : Promise.resolve()) });
  };

  const finish = (points: Pt[]) => {
    setPts([]);
    if (!sheetId || !fpp) return;
    if (mode === "cutout" && sel) {
      if (points.length < 3) return;
      const before = sel.cutouts;
      void run({ redo: () => actions.updateShape(sel.id, { cutouts: [...before, points] }), undo: () => actions.updateShape(sel.id, { cutouts: before }) });
      setMode("pan");
      return;
    }
    if (!condition) return;
    if ((condition.kind === "area" && points.length < 3) || (condition.kind === "linear" && points.length < 2)) return;
    const shape: Shape = { id: crypto.randomUUID(), sheet_id: sheetId, condition_id: condition.id, kind: condition.kind, vertices: points, cutouts: [], openings_ft: 0, multiplier: 1, section: condition.default_section, scale_feet_per_point: fpp };
    void run({ redo: () => actions.putShape(shape), undo: () => actions.removeShape(shape.id) });
  };

  const pointer = (kind: "down" | "move" | "up" | "dblclick" | "click", raw: Pt, e: React.PointerEvent | React.MouseEvent) => {
    // Shift keeps a new edge level or plumb with the last point.
    const last = pts[pts.length - 1];
    const p = e.shiftKey && last ? (Math.abs(raw.x - last.x) > Math.abs(raw.y - last.y) ? { x: raw.x, y: last.y } : { x: last.x, y: raw.y }) : raw;
    if (kind === "move") return setHover(p);
    if (kind === "click") return setSelected(hitTest(sheetShapes, raw, 6));
    if (kind === "dblclick" && (mode === "draw" || mode === "cutout")) return finish(pts);
    if (kind !== "down") return;
    if (mode === "calibrate" || mode === "check") {
      const two = [...pts, p];
      if (two.length < 2) return setPts(two);
      setPts([]);
      setMode("pan");
      if (mode === "check") return setChecked(fpp ? `That distance measures ${num(polylineLength(two) * fpp, 2)} ft at the current scale.` : null);
      const typed = window.prompt("How long is that line in real life? e.g. 16, 16' 6\", 3 m");
      if (typed == null) return;
      const feet = parseFeet(typed);
      if (!feet) return void toast.error("Enter a length such as 16, 16' 6\" or 3 m.");
      try {
        setScale(calibrate(two[0]!, two[1]!, feet), "calibrated");
      } catch (x) {
        err(x);
      }
      return;
    }
    if (mode === "draw" && condition?.kind === "count") {
      if (!sheetId || !fpp) return;
      const existing = sheetShapes.find((s) => s.condition_id === condition.id && s.kind === "count");
      if (existing) {
        const before = existing.vertices;
        return void run({ redo: () => actions.updateShape(existing.id, { vertices: [...before, p] }), undo: () => actions.updateShape(existing.id, { vertices: before }) });
      }
      const shape: Shape = { id: crypto.randomUUID(), sheet_id: sheetId, condition_id: condition.id, kind: "count", vertices: [p], cutouts: [], openings_ft: 0, multiplier: 1, section: condition.default_section, scale_feet_per_point: fpp };
      return void run({ redo: () => actions.putShape(shape), undo: () => actions.removeShape(shape.id) });
    }
    // A double-click arrives as two presses; the second lands on the first and is ignored.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
    setPts([...pts, p]);
  };

  const key = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,select,textarea")) return;
    if (e.key === "Escape") (setPts([]), setMode("pan"));
    else if (e.key === "Enter" && pts.length) finish(pts);
    else if (e.key === "Backspace" && pts.length) setPts(pts.slice(0, -1));
    else if ((e.key === "Delete" || e.key === "Backspace") && sel && canEdit) removeSelected();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") void (e.shiftKey ? stepBack(redo.current, undo.current, "redo") : stepBack(undo.current, redo.current, "undo"));
    else return;
    e.preventDefault();
  };
  const removeSelected = () => {
    if (!sel) return;
    const gone = sel;
    setSelected(null);
    void run({ redo: () => actions.removeShape(gone.id), undo: () => actions.putShape(gone) });
  };
  const patchSelected = (patch: Partial<Pick<Shape, "multiplier" | "openings_ft" | "section">>) => {
    if (!sel) return;
    const before = { multiplier: sel.multiplier, openings_ft: sel.openings_ft, section: sel.section };
    void run({ redo: () => actions.updateShape(sel.id, patch), undo: () => actions.updateShape(sel.id, before) });
  };

  const found = useMemo(() => findTags(text, tag), [text, tag]);
  const drawing = mode !== "pan";
  const preview = hover && pts.length ? [...pts, hover] : pts;
  const hint =
    mode === "calibrate" ? "Click the two ends of a dimension you know." : mode === "check" ? "Click two points to measure between them." : mode === "cutout" ? "Click around the part to leave out. Double-click or Enter to finish." : mode === "draw" && condition ? (condition.kind === "count" ? "Click each one. Esc when done." : `Click each corner. Double-click or Enter to finish, Backspace to step back, Shift for a straight edge.`) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 lg:flex-row" onKeyDown={key}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Ruler className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className={fpp ? "font-medium" : "font-medium text-amber-700"}>{fpp ? `Scale ${scaleLabel(fpp)}` : "No scale set. Set the scale before measuring."}</span>
          {canEdit && sheetId && (
            <>
              {suggested && (!fpp || Math.abs(feetPerPoint(suggested.ratio) - fpp) / fpp > 0.001) && (
                <Button size="sm" variant="outline" onClick={() => setScale(feetPerPoint(suggested.ratio), "suggested")}>
                  Use the sheet's scale: {scaleLabel(feetPerPoint(suggested.ratio))}
                </Button>
              )}
              <select aria-label="Choose a scale" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value="" onChange={(e) => e.target.value && setScale(feetPerPoint(Number(e.target.value)), "chosen")}>
                <option value="">Choose a scale…</option>
                {COMMON_SCALES.map((s) => (
                  <option key={s.label} value={s.ratio}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant={mode === "calibrate" ? "default" : "outline"} onClick={() => (setPts([]), setMode(mode === "calibrate" ? "pan" : "calibrate"))}>
                Calibrate
              </Button>
              <Button size="sm" variant={mode === "check" ? "default" : "outline"} disabled={!fpp} onClick={() => (setPts([]), setChecked(null), setMode(mode === "check" ? "pan" : "check"))}>
                Check scale
              </Button>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Find tag
                <input className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm text-foreground" placeholder="LVP-1" value={tag} onChange={(e) => setTag(e.target.value)} />
                {tag.trim() && <span aria-live="polite">{found.length} here</span>}
              </label>
              <span className="ml-auto flex">
                <Button size="sm" variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={undo.current.length === 0} onClick={() => void stepBack(undo.current, redo.current, "undo")}>
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={redo.current.length === 0} onClick={() => void stepBack(redo.current, undo.current, "redo")}>
                  <Redo2 className="h-4 w-4" />
                </Button>
              </span>
            </>
          )}
        </div>
        {sheetShapes.some((x) => x.needs_checking) && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
            {sheetShapes.filter((x) => x.needs_checking).length} measurement(s) on this sheet came from the previous drawings (dashed outline). Click each one and confirm it still fits.
          </p>
        )}
        <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
          {hint ?? checked ?? (suggested && !fpp ? `This sheet says "${suggested.source}". Check it against a known dimension after accepting.` : "")}
        </p>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          <PlanViewer
            doc={doc}
            pageNumber={pageNumber}
            toolActive={drawing}
            onPointer={pointer}
            {...(onPageSize ? { onPageSize } : {})}
            overlay={({ view }) => {
              const px = 1 / view.scale;
              return (
                <>
                  {sheetShapes.map((s) => {
                    const c = colourOf(s.condition_id);
                    const on = s.id === selected;
                    const d = s.vertices.map((v, i) => `${i ? "L" : "M"}${v.x} ${v.y}`).join(" ");
                    if (s.kind === "count") return s.vertices.map((v, i) => <circle key={`${s.id}-${i}`} cx={v.x} cy={v.y} r={(on ? 8 : 6) * px} fill={c} stroke="#fff" strokeWidth={1.5 * px} />);
                    if (s.kind === "linear") return <path key={s.id} d={d} fill="none" stroke={c} strokeWidth={(on ? 5 : 3) * px} strokeLinecap="round" strokeLinejoin="round" {...(s.needs_checking ? { strokeDasharray: `${8 * px} ${5 * px}` } : {})} />;
                    const holes = s.cutouts.map((h) => h.map((v, i) => `${i ? "L" : "M"}${v.x} ${v.y}`).join(" ") + " Z").join(" ");
                    const m = measureShape(s);
                    const cx = s.vertices.reduce((n, v) => n + v.x, 0) / s.vertices.length;
                    const cy = s.vertices.reduce((n, v) => n + v.y, 0) / s.vertices.length;
                    return (
                      <g key={s.id}>
                        <path d={`${d} Z ${holes}`} fillRule="evenodd" fill={c} fillOpacity={on ? 0.45 : 0.25} stroke={c} strokeWidth={(on ? 3 : 1.5) * px} {...(s.needs_checking ? { strokeDasharray: `${8 * px} ${5 * px}` } : {})} />
                        <text x={cx} y={cy} fontSize={12 * px} textAnchor="middle" fill="#111" stroke="#fff" strokeWidth={3 * px} paintOrder="stroke">
                          {num(m.sf)} SF{s.multiplier !== 1 ? ` (×${s.multiplier})` : ""}
                        </text>
                      </g>
                    );
                  })}
                  {found.map((f, i) => (
                    <circle key={`tag-${i}`} cx={f.x} cy={f.y} r={16 * px} fill="rgba(250,204,21,0.35)" stroke="#ca8a04" strokeWidth={2 * px} />
                  ))}
                  {preview.length > 0 && (
                    <>
                      <path d={preview.map((v, i) => `${i ? "L" : "M"}${v.x} ${v.y}`).join(" ")} fill={mode === "cutout" || condition?.kind === "area" ? "rgba(17,24,39,0.12)" : "none"} stroke="#111827" strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
                      {pts.map((v, i) => (
                        <circle key={i} cx={v.x} cy={v.y} r={4 * px} fill="#fff" stroke="#111827" strokeWidth={1.5 * px} />
                      ))}
                    </>
                  )}
                </>
              );
            }}
          />
        </div>
      </div>

      <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto lg:w-64">
        <section>
          <h3 className="text-sm font-semibold">Measuring</h3>
          {data.conditions.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Add what you are measuring, such as "LVP-1 guest rooms" or "Rubber base".</p>}
          <ul className="mt-1 space-y-1">
            {data.conditions.map((c) => {
              const t = totals[c.id] ?? { sf: 0, sy: 0, lf: 0, ea: 0 };
              const active = mode === "draw" && conditionId === c.id;
              return (
                <li key={c.id} className={`rounded-md border p-2 ${active ? "border-primary ring-1 ring-primary" : "border-border"}`}>
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: c.colour }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.label}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">{totalText(c.kind, t)}</p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Button size="sm" variant={active ? "default" : "outline"} disabled={!fpp || !sheetId} title={fpp ? undefined : "Set the sheet's scale first"} onClick={() => (setPts([]), setSelected(null), setConditionId(c.id), setMode(active ? "pan" : "draw"))}>
                        {active ? "Stop" : c.kind === "count" ? "Count" : "Draw"}
                      </Button>
                      {conditionExtra?.(c)}
                      <Button size="sm" variant="ghost" aria-label={`Delete ${c.label}`} onClick={() => window.confirm(`Delete "${c.label}" and everything measured for it on every sheet?`) && void actions.removeCondition(c.id).catch(err)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {canEdit &&
            (adding ? (
              <form
                className="mt-2 space-y-2 rounded-md border border-border p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!adding.label.trim()) return;
                  void actions.addCondition({ finish_id: adding.finishId || null, label: adding.label.trim(), kind: adding.kind, colour: COLOURS[data.conditions.length % COLOURS.length]!, default_section: adding.section.trim() || null }).then((id) => (setAdding(null), setConditionId(id)), err);
                }}
              >
                {finishes.length > 0 && (
                  <label className="block text-xs font-medium">
                    Finish (optional)
                    <select className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={adding.finishId} onChange={(e) => setAdding({ ...adding, finishId: e.target.value, label: adding.label || (finishes.find((f) => f.id === e.target.value)?.tag ?? "") })}>
                      <option value="">Not tied to a finish</option>
                      {finishes.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.tag}
                          {f.description ? ` – ${f.description}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-xs font-medium">
                  Name
                  <input autoFocus className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
                </label>
                <label className="block text-xs font-medium">
                  Measured as
                  <select className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as ShapeKind })}>
                    <option value="area">Area (SF / SY)</option>
                    <option value="linear">Length (LF)</option>
                    <option value="count">Count (EA)</option>
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  Section (optional)
                  <input className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" placeholder="e.g. Level 2" value={adding.section} onChange={(e) => setAdding({ ...adding, section: e.target.value })} />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setAdding({ label: "", kind: "area", section: "", finishId: "" })}>
                Add something to measure
              </Button>
            ))}
        </section>

        {sel && (
          <section className="rounded-md border border-border p-2">
            <h3 className="text-sm font-semibold">Selected: {data.conditions.find((c) => c.id === sel.condition_id)?.label}</h3>
            <p className="text-xs tabular-nums text-muted-foreground">{totalText(sel.kind, measureShape(sel))}</p>
            {canEdit && (
              <div className="mt-2 space-y-2">
                <label className="block text-xs font-medium">
                  Repeats (typical floors or rooms)
                  <input key={`${sel.id}-m-${sel.multiplier}`} type="number" min={1} step={1} defaultValue={sel.multiplier} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== sel.multiplier && patchSelected({ multiplier: Number(e.target.value) })} className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" />
                </label>
                {sel.kind !== "count" && (
                  <label className="block text-xs font-medium">
                    Door openings to leave out (ft)
                    <input key={`${sel.id}-o-${sel.openings_ft}`} type="number" min={0} step={0.5} defaultValue={sel.openings_ft} onBlur={(e) => Number(e.target.value) >= 0 && Number(e.target.value) !== sel.openings_ft && patchSelected({ openings_ft: Number(e.target.value) })} className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" />
                  </label>
                )}
                <label className="block text-xs font-medium">
                  Section
                  <input key={`${sel.id}-s-${sel.section}`} defaultValue={sel.section ?? ""} onBlur={(e) => (e.target.value.trim() || null) !== sel.section && patchSelected({ section: e.target.value.trim() || null })} className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" />
                </label>
                {sel.needs_checking && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    Brought forward from the previous drawings. Check it still fits this sheet.
                    <Button size="sm" variant="outline" className="mt-1.5 bg-white" onClick={() => void actions.updateShape(sel.id, { needs_checking: false }).catch(err)}>
                      It fits: mark checked
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {sel.kind === "area" && (
                    <Button size="sm" variant={mode === "cutout" ? "default" : "outline"} onClick={() => (setPts([]), setMode(mode === "cutout" ? "pan" : "cutout"))}>
                      Cut out a part
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={removeSelected}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
