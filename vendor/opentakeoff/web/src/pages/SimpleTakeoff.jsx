// BMD change (new file): the simple BMD takeoff screen.
//
// One screen, three parts: the sheets on the left, the drawing in the middle, and what is being measured on the
// right. The measuring is OpenTakeoff's engine (lib/bmd/engine.js); the saved takeoff is OpenTakeoff's own document
// (lib/bmd/takeoffDoc.js), so the same takeoff opens in the full workspace under "More tools".
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "../styles/simpleTakeoff.css";
import { store } from "../lib/store.js";
import { PALETTE } from "../lib/takeoffConstants.ts";
import { createSheetEngine, RENDER_SCALE, STANDARD_SCALES } from "../lib/bmd/engine.js";
import { addCondition, addShape, finishTotals, removeShape, scaleFor, setScale, sheetKey, sheetShapes, updateCondition } from "../lib/bmd/takeoffDoc.js";
import { fitView, nearShape, toImage, zoomAt } from "../lib/bmd/view.js";
import { parseFeet } from "../lib/bmd/feet.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const TOOLS = [
  { id: "select", label: "Select", hint: "Click a measurement to select it. Drag to move around the drawing." },
  { id: "room", label: "Click a room", hint: "Click inside a room and it is measured to its walls." },
  { id: "area", label: "Draw area", hint: "Click each corner. Double-click or press Enter to finish." },
  { id: "line", label: "Line", hint: "Click along the run (base, transitions). Double-click or press Enter to finish." },
  { id: "count", label: "Count", hint: "Click each item to count it." },
  { id: "cut", label: "Cut out", hint: "Draw around an area to take out, such as a column or a void." },
];
const fmt = (n, d = 1) => (Number(n) || 0).toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });
const pathOf = (pts, closed) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + (closed ? " Z" : "");

export default function SimpleTakeoff({ projectId, readOnly, saveState }) {
  const [doc, setDoc] = useState(null);
  const [sheets, setSheets] = useState([]);          // [{key, file, page, label}]
  const [current, setCurrent] = useState(null);      // sheet key
  const [engine, setEngine] = useState(null);
  const [detected, setDetected] = useState(null);
  const [tool, setTool] = useState("room");   // the quickest way to measure is the default; dragging still moves the drawing
  const [activeId, setActiveId] = useState(null);    // finish being measured
  const [draft, setDraft] = useState([]);            // corners of the shape being drawn, image px
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState({ k: 0.2, x: 0, y: 0 });
  const [note, setNote] = useState(null);            // {tone, text}
  const [busy, setBusy] = useState("Opening the project's drawings…");
  const [newTag, setNewTag] = useState("");
  const [filter, setFilter] = useState("");
  const [calibrate, setCalibrate] = useState(null);  // null | {points: []}
  const wrap = useRef(null);
  const canvas = useRef(null);
  const pdfs = useRef(new Map());                    // file name → pdf.js document
  const history = useRef({ past: [], future: [] });
  const drag = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const dims = engine?.dims ?? null;
  const scale = doc && current ? scaleFor(doc, current) : null;
  const sheet = sheets.find((s) => s.key === current) ?? null;
  const shapes = useMemo(() => (doc && current ? sheetShapes(doc, current) : []), [doc, current]);
  const totals = useMemo(() => (doc ? finishTotals(doc) : []), [doc]);
  const condById = useMemo(() => new Map((doc?.conditions ?? []).map((c) => [c.id, c])), [doc]);
  const say = (text, tone = "info") => setNote({ text, tone, at: Date.now() });

  // ── saving: every change goes to BMD Projects through the store, which sends one save at a time ──
  const commit = useCallback((next, { undoable = true } = {}) => {
    setDoc((prev) => {
      if (undoable && prev) {
        history.current.past.push(prev);
        if (history.current.past.length > 60) history.current.past.shift();
        history.current.future = [];
      }
      return next;
    });
    if (!readOnly) void store.saveAnnotations(next);
  }, [readOnly]);
  const undo = () => { const h = history.current; if (!h.past.length || !doc) return; h.future.push(doc); commit(h.past.pop(), { undoable: false }); setSelected(null); };
  const redo = () => { const h = history.current; if (!h.future.length || !doc) return; h.past.push(doc); commit(h.future.pop(), { undoable: false }); };

  // ── load the takeoff and the list of sheets ──
  const openPdf = useCallback(async (file) => {
    let p = pdfs.current.get(file);
    if (!p) {
      p = store.loadPdfData(file).then((data) => pdfjsLib.getDocument({ data }).promise);
      pdfs.current.set(file, p);
      p.catch(() => pdfs.current.delete(file));
    }
    return p;
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [loaded, files] = await Promise.all([store.loadAnnotations(), store.listSheets()]);
        if (!live) return;
        setDoc(loaded);
        setActiveId(loaded.conditions?.[0]?.id ?? null);
        const list = [];
        for (const f of files) {
          setBusy(`Opening ${f.name}…`);
          try {
            const pdf = await openPdf(f.name);
            for (let n = 1; n <= pdf.numPages; n++) list.push({ key: sheetKey(f.name, n), file: f.name, page: n, label: null });
          } catch (e) {
            say(`${f.name} could not be opened: ${String(e?.message || e)}`, "bad");
          }
          if (!live) return;
          setSheets([...list]);
        }
        const remembered = (loaded.sheet_tabs || []).find((k) => list.some((s) => s.key === k));
        setCurrent(remembered ?? list[0]?.key ?? null);
        setBusy(list.length ? null : "empty");
      } catch (e) {
        if (live) { setBusy(null); say(`The takeoff could not be opened: ${String(e?.message || e)}`, "bad"); }
      }
    })();
    return () => { live = false; };
  }, [openPdf]);

  // Sheet numbers from the title blocks, filled in a few at a time so the list is usable at once.
  useEffect(() => {
    let live = true;
    (async () => {
      for (const s of sheets) {
        if (!live) return;
        if (s.label !== null) continue;
        try {
          const page = await (await openPdf(s.file)).getPage(s.page);
          const number = await createSheetEngine({ page, OPS: pdfjsLib.OPS }).sheetNumber();
          if (!live) return;
          setSheets((prev) => prev.map((x) => (x.key === s.key ? { ...x, label: number || "" } : x)));
          return;   // one per pass; the state change runs this effect again
        } catch {
          setSheets((prev) => prev.map((x) => (x.key === s.key ? { ...x, label: "" } : x)));
          return;
        }
      }
    })();
    return () => { live = false; };
  }, [sheets, openPdf]);

  // ── open the current sheet ──
  useEffect(() => {
    if (!sheet) return;
    let live = true;
    setEngine(null);
    setDetected(null);
    setDraft([]);
    setSelected(null);
    setCalibrate(null);
    (async () => {
      try {
        const page = await (await openPdf(sheet.file)).getPage(sheet.page);
        if (!live) return;
        const eng = createSheetEngine({ page, OPS: pdfjsLib.OPS });
        eng.page = page;
        setEngine(eng);
        const box = wrap.current?.getBoundingClientRect();
        if (box) setView(fitView(eng.dims, { w: box.width, h: box.height }));
        const d = await eng.detectedScale();
        if (live) setDetected(d);
      } catch (e) {
        if (live) say(`This sheet could not be opened: ${String(e?.message || e)}`, "bad");
      }
    })();
    return () => { live = false; };
  }, [sheet?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Remember which sheet was open, the way the full workspace does.
  useEffect(() => {
    if (!doc || !current || readOnly) return;
    if ((doc.sheet_tabs || [])[0] === current) return;
    const next = { ...doc, sheet_tabs: [current] };
    setDoc(next);
    void store.saveAnnotations(next);
  }, [current]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── draw the visible part of the sheet, sharp at the current zoom ──
  useEffect(() => {
    if (!engine || !canvas.current || !wrap.current) return;
    const box = wrap.current.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let task = null;
    const timer = setTimeout(() => {
      const c = canvas.current;
      if (!c) return;
      const w = Math.max(1, Math.round(box.width * dpr));
      const h = Math.max(1, Math.round(box.height * dpr));
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const g = off.getContext("2d");
      g.fillStyle = "#eef1f5";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#ffffff";
      g.fillRect(view.x * dpr, view.y * dpr, engine.dims.w * view.k * dpr, engine.dims.h * view.k * dpr);
      const vp = engine.page.getViewport({ scale: RENDER_SCALE * view.k * dpr });
      task = engine.page.render({ canvasContext: g, viewport: vp, transform: [1, 0, 0, 1, view.x * dpr, view.y * dpr], background: "rgba(0,0,0,0)" });
      task.promise.then(() => {
        c.width = w;
        c.height = h;
        c.style.transform = "";
        c.dataset.k = String(view.k);
        c.dataset.x = String(view.x);
        c.dataset.y = String(view.y);
        c.getContext("2d").drawImage(off, 0, 0);
      }, () => {});
    }, 90);
    // Until the sharp picture arrives, the last one is stretched into place so panning and zooming feel immediate.
    const c = canvas.current;
    if (c.dataset.k) {
      const k0 = Number(c.dataset.k), x0 = Number(c.dataset.x), y0 = Number(c.dataset.y);
      const f = view.k / k0;
      c.style.transformOrigin = "0 0";
      c.style.transform = `translate(${view.x - x0 * f}px, ${view.y - y0 * f}px) scale(${f})`;
    }
    return () => { clearTimeout(timer); task?.cancel?.(); };
  }, [engine, view]);

  // ── measuring ──
  const active = activeId ? condById.get(activeId) : null;
  const needFinish = () => { if (active) return false; say("Add a finish to measure first, on the right.", "warn"); return true; };
  const needScale = () => { if (scale) return false; say("Set the scale for this sheet first, at the top.", "warn"); return true; };

  const finishDraft = () => {
    if (!dims || !doc) return;
    const role = tool === "line" ? "linear" : tool === "cut" ? "deduct" : "floor_area";
    const min = role === "linear" ? 2 : 3;
    if (draft.length < min) { setDraft([]); return; }
    try {
      commit(addShape(doc, { sheetId: current, conditionId: activeId, role, pointsPx: draft, dims, method: "manual" }));
    } catch (e) {
      say(String(e?.message || e), "warn");
    }
    setDraft([]);
  };

  const pointer = (e) => {
    const box = wrap.current.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  const snapped = async (ix, iy) => {
    if (!engine) return [ix, iy];
    const p = await engine.snap(ix, iy, 7 / Math.max(viewRef.current.k, 0.05) / 2 + 3).catch(() => null);
    return p ?? [ix, iy];
  };

  const onClick = async (e) => {
    if (!engine || !doc || drag.current?.moved) return;
    const [sx, sy] = pointer(e);
    const [ix, iy] = toImage(view, sx, sy);
    if (calibrate) {
      const p = await snapped(ix, iy);
      const points = [...calibrate.points, p];
      if (points.length < 2) return setCalibrate({ points });
      const px = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
      const answer = window.prompt("How long is that, in feet? For example 12.5, or 12' 6\"");
      setCalibrate(null);
      const feet = parseFeet(answer);
      if (!(feet > 0) || !(px > 1)) return say("The scale was not changed.", "info");
      commit(setScale(doc, current, feet / px, "calibrated", dims));
      return say(`Scale set from your ${fmt(feet, 2)} ft measurement.`, "good");
    }
    if (tool === "select") {
      const hit = nearShape(shapes, dims, ix, iy, 8 / view.k);
      return setSelected(hit?.id ?? null);
    }
    if (readOnly) return say("This takeoff is read-only for you.", "warn");
    if (needFinish()) return;
    if (tool === "count") {
      try { commit(addShape(doc, { sheetId: current, conditionId: activeId, role: "count", pointsPx: [[ix, iy]], dims })); } catch (err) { say(String(err?.message || err), "warn"); }
      return;
    }
    if (needScale()) return;
    if (tool === "room") {
      if (ix < 0 || iy < 0 || ix > dims.w || iy > dims.h) return;
      setBusy("Measuring the room…");
      try {
        const r = await engine.roomAt(ix, iy, scale.upp);
        if (!r.ok) return say(r.reason, "warn");
        commit(addShape(doc, { sheetId: current, conditionId: activeId, role: "floor_area", pointsPx: r.pointsPx, dims, method: "one_click_v1", seedPx: [ix, iy], confidence: r.confidence ?? undefined }));
        say(`${active.finish_tag}: ${fmt(r.areaSf)} SF measured to the walls. Check the outline, and undo if it is not the room.`, "good");
      } catch (err) {
        say(`That room could not be measured: ${String(err?.message || err)}`, "bad");
      } finally {
        setBusy(null);
      }
      return;
    }
    const p = await snapped(ix, iy);
    setDraft((d) => [...d, p]);
  };

  const onDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const [sx, sy] = pointer(e);
    drag.current = { sx, sy, x: view.x, y: view.y, moved: false, pan: tool === "select" || e.button === 1 || e.altKey || e.shiftKey || e.currentTarget.dataset.space === "1" };
  };
  const onMove = (e) => {
    const [sx, sy] = pointer(e);
    const d = drag.current;
    if (d && (e.buttons & 1 || e.buttons & 4)) {
      if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true;
      if (d.moved && (d.pan || draft.length === 0)) setView((v) => ({ ...v, x: d.x + sx - d.sx, y: d.y + sy - d.sy }));
    }
    setHover(toImage(viewRef.current, sx, sy));
  };
  const onUp = () => { const d = drag.current; setTimeout(() => { if (drag.current === d) drag.current = null; }, 0); };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => zoomAt(v, e.clientX - box.left, e.clientY - box.top, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [busy]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
      if (e.key === "Escape") { setDraft([]); setCalibrate(null); setSelected(null); }
      else if (e.key === "Enter") finishDraft();
      else if (e.key === "Backspace" && draft.length) setDraft((d) => d.slice(0, -1));
      else if ((e.key === "Delete" || e.key === "Backspace") && selected && !readOnly) { commit(removeShape(doc, selected)); setSelected(null); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fit = () => { const box = wrap.current?.getBoundingClientRect(); if (box && dims) setView(fitView(dims, { w: box.width, h: box.height })); };
  const zoom = (f) => { const box = wrap.current?.getBoundingClientRect(); if (box) setView((v) => zoomAt(v, box.width / 2, box.height / 2, f)); };
  const pickTool = (id) => { setTool(id); setDraft([]); setCalibrate(null); setSelected(null); };
  const addFinish = () => {
    const tag = newTag.trim();
    if (!tag || !doc) return;
    const next = addCondition(doc, tag);
    commit(next);
    setActiveId(next.conditions.find((c) => c.finish_tag.toLowerCase() === tag.toLowerCase())?.id ?? activeId);
    setNewTag("");
  };
  const chooseScale = (value) => {
    if (!doc || !dims) return;
    if (value === "calibrate") { setCalibrate({ points: [] }); setDraft([]); return say("Click the two ends of a length you know, such as a dimension line.", "info"); }
    if (value === "detected" && detected) { commit(setScale(doc, current, detected.upp, "detected", dims)); return; }
    const s = STANDARD_SCALES.find((x) => x.label === value);
    if (s) commit(setScale(doc, current, s.upp, "standard", dims));
  };

  const scaleLabel = scale ? (STANDARD_SCALES.find((s) => Math.abs(s.upp - scale.upp) / scale.upp < 1e-6)?.label ?? (scale.source === "calibrated" ? "Set from a known length" : "Custom scale")) : null;
  const shown = sheets.filter((s) => !filter.trim() || `${s.label ?? ""} page ${s.page} ${s.file}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const selectedShape = selected ? shapes.find((s) => s.id === selected) : null;
  const pts = (s) => (s.verts_norm || []).map(([nx, ny]) => [nx * dims.w, ny * dims.h]);
  const liveDraft = draft.length && hover ? [...draft, hover] : draft;
  const stroke = 2 / view.k;
  const advancedUrl = `?project=${encodeURIComponent(projectId)}&view=advanced`;
  const saveText = readOnly ? "Read-only" : saveState?.kind === "saving" ? "Saving…" : saveState?.kind === "failed" ? "Not saved" : saveState?.kind === "conflict" ? "Not saved" : "Saved";

  if (busy === "empty") {
    return (
      <div className="st st-empty">
        <h1>No drawings yet</h1>
        <p>Upload the plans as a PDF under this project's Documents → Plans, then open the takeoff again.</p>
      </div>
    );
  }

  return (
    <div className="st">
      <header className="st-top">
        <div className="st-sheetname">
          <strong>{sheet ? sheet.label || `Page ${sheet.page}` : "Takeoff"}</strong>
          <span>{sheet ? sheet.file : ""}</span>
        </div>
        <label className={`st-scale ${scale ? "" : "st-scale-missing"}`}>
          <span>Scale</span>
          <select value="" onChange={(e) => chooseScale(e.target.value)} disabled={readOnly || !engine} aria-label="Scale for this sheet">
            <option value="">{scaleLabel ?? "Not set"}</option>
            {detected && <option value="detected">Use the scale on the sheet: {detected.label}</option>}
            <option value="calibrate">Measure a known length…</option>
            {STANDARD_SCALES.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
          </select>
        </label>
        {!scale && detected && !readOnly && <button type="button" className="st-btn st-btn-primary" onClick={() => chooseScale("detected")}>Use {detected.label}</button>}
        <div className="st-tools" role="toolbar" aria-label="Measuring tools">
          {TOOLS.map((t) => <button key={t.id} type="button" className={`st-tool ${tool === t.id ? "st-on" : ""}`} aria-pressed={tool === t.id} title={t.hint} onClick={() => pickTool(t.id)}>{t.label}</button>)}
        </div>
        <div className="st-spacer" />
        <button type="button" className="st-btn" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" className="st-btn" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
        <span className={`st-save ${saveText === "Not saved" ? "st-save-bad" : ""}`} role="status">{saveText}</span>
        <a className="st-btn" href={advancedUrl} title="Roll goods and seams, stitching sheets, schedule import, marked-set PDF and the rest of OpenTakeoff's tools. The same takeoff opens there.">More tools</a>
      </header>

      <div className="st-body">
        <aside className="st-sheets" aria-label="Sheets">
          <input className="st-input" placeholder="Find a sheet…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a sheet" />
          <ul>
            {shown.map((s) => {
              const n = doc ? sheetShapes(doc, s.key).length : 0;
              return (
                <li key={s.key}>
                  <button type="button" className={s.key === current ? "st-on" : ""} onClick={() => setCurrent(s.key)} title={s.file}>
                    <strong>{s.label || `Page ${s.page}`}</strong>
                    <span>{s.label ? `Page ${s.page}` : ""}{n ? ` · ${n} measured` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="st-stage" ref={wrap} data-tool={calibrate ? "calibrate" : tool} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => setHover(null)} onClick={onClick} onDoubleClick={() => (tool === "area" || tool === "line" || tool === "cut") && finishDraft()}>
          <canvas ref={canvas} className="st-canvas" />
          {dims && (
            <svg className="st-overlay" aria-hidden="true">
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {shapes.map((s) => {
                  const c = condById.get(s.condition_id);
                  const colour = c?.color ?? "#64748b";
                  const p = pts(s);
                  const on = s.id === selected;
                  if (s.measure_role === "count") return <circle key={s.id} cx={p[0]?.[0]} cy={p[0]?.[1]} r={7 / view.k} fill={colour} stroke="#fff" strokeWidth={(on ? 3 : 1.5) / view.k} />;
                  if (s.measure_role === "linear" || s.measure_role === "surface_area") return <path key={s.id} d={pathOf(p, false)} fill="none" stroke={colour} strokeWidth={(on ? 5 : 3.5) / view.k} strokeLinecap="round" strokeLinejoin="round" />;
                  if (s.measure_role === "deduct") return <path key={s.id} d={pathOf(p, true)} fill="#ffffff" fillOpacity="0.85" stroke={colour} strokeWidth={stroke} strokeDasharray={`${6 / view.k} ${4 / view.k}`} />;
                  return <path key={s.id} d={pathOf(p, true)} fill={c?.fill ?? colour} fillOpacity={on ? 0.5 : 0.32} stroke={colour} strokeWidth={(on ? 3.5 : 2) / view.k} strokeLinejoin="round" />;
                })}
                {liveDraft.length > 0 && <path d={pathOf(liveDraft, tool !== "line" && liveDraft.length > 2)} fill={tool === "line" ? "none" : active?.color ?? "#1b2d4f"} fillOpacity="0.15" stroke={active?.color ?? "#1b2d4f"} strokeWidth={stroke} strokeDasharray={`${5 / view.k} ${4 / view.k}`} />}
                {draft.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4 / view.k} fill="#fff" stroke={active?.color ?? "#1b2d4f"} strokeWidth={stroke} />)}
                {calibrate?.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5 / view.k} fill="#1b2d4f" />)}
              </g>
            </svg>
          )}
          {busy && busy !== "empty" && <div className="st-busy" role="status">{busy}</div>}
          {note && <div className={`st-note st-note-${note.tone}`} role="status" onClick={(e) => { e.stopPropagation(); setNote(null); }}>{note.text}<span aria-hidden="true">×</span></div>}
          {selectedShape && (
            <div className="st-selected" onClick={(e) => e.stopPropagation()}>
              <strong>{condById.get(selectedShape.condition_id)?.finish_tag ?? "Measurement"}</strong>
              <span>{selectedShape.measure_role === "count" ? "1 counted" : selectedShape.measure_role === "linear" ? `${fmt(selectedShape.computed?.perimeter_lf)} LF` : `${fmt(selectedShape.computed?.area_sf)} SF${selectedShape.measure_role === "deduct" ? " taken out" : ` · ${fmt(selectedShape.computed?.perimeter_lf)} LF around`}`}</span>
              {!readOnly && <button type="button" className="st-btn st-btn-danger" onClick={() => { commit(removeShape(doc, selectedShape.id)); setSelected(null); }}>Remove</button>}
            </div>
          )}
          <div className="st-zoom" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="st-btn" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out">−</button>
            <button type="button" className="st-btn" onClick={fit}>Fit</button>
            <button type="button" className="st-btn" onClick={() => zoom(1.4)} aria-label="Zoom in">+</button>
          </div>
          <p className="st-hint">{calibrate ? "Click the two ends of a length you know." : TOOLS.find((t) => t.id === tool)?.hint} {draft.length > 0 ? "Esc cancels, Backspace removes the last corner." : "Scroll to zoom."}</p>
        </main>

        <aside className="st-finishes" aria-label="Measuring">
          <h2>Measuring</h2>
          <p className="st-sub">Pick a finish, then a tool. Totals are as measured, across every sheet; waste is added on the estimate.</p>
          <ul>
            {totals.map((t) => {
              const c = condById.get(t.id);
              const on = t.id === activeId;
              return (
                <li key={t.id} className={on ? "st-on" : ""}>
                  <button type="button" className="st-finish" onClick={() => setActiveId(t.id)} aria-pressed={on}>
                    <span className="st-swatch" style={{ background: t.colour }} />
                    <span className="st-finish-text">
                      <strong>{t.tag}</strong>
                      <span>{[t.areaSf ? `${fmt(t.areaSf)} SF · ${fmt(t.areaSy)} SY` : null, t.lengthLf ? `${fmt(t.lengthLf)} LF` : null, t.count ? `${t.count} EA` : null].filter(Boolean).join(" · ") || "Nothing measured yet"}</span>
                    </span>
                  </button>
                  {on && !readOnly && (
                    <div className="st-colours" role="group" aria-label={`Colour for ${t.tag}`}>
                      {PALETTE.map((p) => <button key={p} type="button" title="Use this colour" className={c?.color === p ? "st-on" : ""} style={{ background: p }} onClick={() => commit(updateCondition(doc, t.id, { color: p, fill: p }))} />)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!readOnly && (
            <form className="st-add" onSubmit={(e) => { e.preventDefault(); addFinish(); }}>
              <input className="st-input" placeholder="Add a finish, e.g. LVT-1" value={newTag} onChange={(e) => setNewTag(e.target.value)} aria-label="New finish tag" maxLength={40} />
              <button type="submit" className="st-btn st-btn-primary" disabled={!newTag.trim()}>Add</button>
            </form>
          )}
          <p className="st-credit">Measuring engine: OpenTakeoff (Apache-2.0)</p>
        </aside>
      </div>
    </div>
  );
}
