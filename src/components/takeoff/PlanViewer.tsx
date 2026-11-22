import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { Maximize, Minus, Plus } from "lucide-react";
import { clampView, fitView, zoomAt, type Size, type View } from "@/lib/takeoff/view";

export type OverlayContext = { view: View; page: Size; box: Size };
type Props = {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** Drawn over the sheet in an SVG whose units are PDF points of the page. */
  overlay?: (ctx: OverlayContext) => ReactNode;
  /** When set, dragging does not pan (a drawing tool has the pointer). The middle button and two fingers still do. */
  toolActive?: boolean;
  onPageSize?: (size: Size, rotation: number) => void;
  onPointer?: (kind: "down" | "move" | "up" | "dblclick" | "click", pt: { x: number; y: number }, e: React.PointerEvent | React.MouseEvent) => void;
};

/**
 * Shows one sheet. Only the part of the sheet inside the window is drawn, at the window's own resolution,
 * so a large sheet stays sharp at any zoom without a huge image. While the hand is moving, the last picture
 * is stretched to follow; the sharp redraw comes a moment after it stops.
 */
export function PlanViewer({ doc, pageNumber, overlay, toolActive, onPageSize, onPointer }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const [drawn, setDrawn] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; view: View; pinch?: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let stale = false;
    setPage(null);
    setView(null);
    setDrawn(null);
    setError(null);
    doc.getPage(pageNumber).then(
      (p) => {
        if (stale) return;
        const vp = p.getViewport({ scale: 1 });
        setPage(p);
        setSize({ width: vp.width, height: vp.height });
        onPageSize?.({ width: vp.width, height: vp.height }, p.rotate);
      },
      (e) => !stale && setError(e instanceof Error ? e.message : "Could not open this sheet"),
    );
    return () => {
      stale = true;
    };
  }, [doc, pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (size && box.width > 0 && !view) setView(fitView(size, box));
  }, [size, box, view]);

  // Sharp redraw of the visible part, shortly after the view settles.
  useEffect(() => {
    if (!page || !view || box.width === 0) return;
    let task: RenderTask | null = null;
    const timer = setTimeout(() => {
      const c = canvas.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const off = document.createElement("canvas");
      off.width = Math.round(box.width * dpr);
      off.height = Math.round(box.height * dpr);
      const ctx = off.getContext("2d")!;
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(0, 0, off.width, off.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(view.x * dpr, view.y * dpr, size!.width * view.scale * dpr, size!.height * view.scale * dpr);
      task = page.render({ canvasContext: ctx, canvas: off, viewport: page.getViewport({ scale: view.scale * dpr, offsetX: view.x * dpr, offsetY: view.y * dpr }) } as never);
      task.promise.then(
        () => {
          c.width = off.width;
          c.height = off.height;
          c.getContext("2d")!.drawImage(off, 0, 0);
          setDrawn(view);
        },
        () => undefined,
      );
    }, drawn ? 140 : 0);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, [page, view, box]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toPage = (p: { x: number; y: number }) => ({ x: (p.x - view!.x) / view!.scale, y: (p.y - view!.y) / view!.scale });
  const zoom = (factor: number, at = { x: box.width / 2, y: box.height / 2 }) => size && setView((v) => (v ? zoomAt(v, factor, at, size, box) : v));

  useEffect(() => {
    const el = wrap.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), local(e));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }); // rebinding each render keeps the latest size and box

  const down = (e: React.PointerEvent) => {
    if (!view || !size) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const panning = !toolActive || e.button === 1 || pts.length === 2;
    if (panning) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { ...pts[0]!, view, ...(pts.length === 2 ? { pinch: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) } : {}) };
    } else onPointer?.("down", toPage(local(e)), e);
  };
  const move = (e: React.PointerEvent) => {
    if (!view || !size) return;
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const d = drag.current;
    if (!d) return onPointer?.("move", toPage(p), e);
    const pts = [...pointers.current.values()];
    if (d.pinch && pts.length === 2) {
      const mid = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 };
      setView(zoomAt(d.view, Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) / d.pinch, mid, size, box));
    } else setView(clampView({ scale: d.view.scale, x: d.view.x + p.x - d.x, y: d.view.y + p.y - d.y }, size, box));
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (d) {
      drag.current = null;
      const p = local(e);
      // A press that did not move is a click on the sheet, not a pan.
      if (view && !d.pinch && Math.hypot(p.x - d.x, p.y - d.y) < 4) onPointer?.("click", toPage(p), e);
    } else if (view) onPointer?.("up", toPage(local(e)), e);
  };

  const k = view && drawn ? view.scale / drawn.scale : 1;
  return (
    <div
      ref={wrap}
      tabIndex={0}
      role="application"
      aria-label={`Sheet, page ${pageNumber}. Drag to move, scroll or pinch to zoom, plus and minus keys to zoom, zero to fit.`}
      className={`relative h-full w-full touch-none overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring ${toolActive ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => view && onPointer?.("dblclick", toPage(local(e)), e)}
      onKeyDown={(e) => {
        if (e.key === "+" || e.key === "=") zoom(1.25);
        else if (e.key === "-") zoom(0.8);
        else if (e.key === "0" && size) setView(fitView(size, box));
        else if (e.key.startsWith("Arrow") && view && size) {
          const step = 60 * (e.key === "ArrowLeft" || e.key === "ArrowUp" ? 1 : -1);
          setView(clampView({ ...view, ...(e.key === "ArrowLeft" || e.key === "ArrowRight" ? { x: view.x + step } : { y: view.y + step }) }, size, box));
        } else return;
        e.preventDefault();
      }}
    >
      <canvas ref={canvas} className="absolute left-0 top-0 origin-top-left" style={{ width: box.width, height: box.height, transform: view && drawn ? `translate(${view.x - drawn.x * k}px, ${view.y - drawn.y * k}px) scale(${k})` : undefined }} />
      {view && size && overlay && (
        <svg className="pointer-events-none absolute left-0 top-0" width={box.width} height={box.height}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>{overlay({ view, page: size, box })}</g>
        </svg>
      )}
      {error && <p className="absolute inset-x-0 top-10 text-center text-sm text-destructive">Could not open this sheet: {error}</p>}
      {!drawn && !error && <p className="absolute inset-x-0 top-10 text-center text-sm text-muted-foreground">Opening sheet…</p>}
      <div className="absolute bottom-3 right-3 flex overflow-hidden rounded-md border border-border bg-card shadow-sm">
        {[
          { label: "Zoom out", icon: Minus, run: () => zoom(0.8) },
          { label: "Fit sheet to window", icon: Maximize, run: () => size && setView(fitView(size, box)) },
          { label: "Zoom in", icon: Plus, run: () => zoom(1.25) },
        ].map((b) => (
          <button key={b.label} type="button" aria-label={b.label} title={b.label} onPointerDown={(e) => e.stopPropagation()} onClick={b.run} className="flex h-11 w-11 items-center justify-center hover:bg-muted">
            <b.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
