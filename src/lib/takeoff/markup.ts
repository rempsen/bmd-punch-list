/** A sheet drawn with its coloured measurements and a colour key, as a picture for quotes and for printing. Browser only. */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { legendFor, type Shape, type ShapeKind } from "./geometry";

type Cond = { id: string; label: string; kind: ShapeKind; colour: string; finish_id: string | null };
export type MarkedSheet = { dataUrl: string; width: number; height: number; title: string };

export async function renderMarkedSheet(doc: PDFDocumentProxy, pageNumber: number, shapes: Shape[], conditions: Cond[], opts: { title: string; maxWidth?: number; quality?: number } = { title: "" }): Promise<MarkedSheet> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const k = Math.min((opts.maxWidth ?? 1800) / base.width, 3);
  const vp = page.getViewport({ scale: k });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp } as never).promise;

  const colour = new Map(conditions.map((c) => [c.id, c.colour]));
  const path = (pts: { x: number; y: number }[], close: boolean) => {
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
    if (close) ctx.closePath();
  };
  for (const s of shapes) {
    const c = colour.get(s.condition_id) ?? "#2563eb";
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    if (s.kind === "area") {
      ctx.beginPath();
      path(s.vertices, true);
      for (const h of s.cutouts) path(h, true);
      ctx.globalAlpha = 0.3;
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(2, canvas.width / 900);
      ctx.stroke();
    } else if (s.kind === "linear") {
      ctx.beginPath();
      path(s.vertices, false);
      ctx.lineWidth = Math.max(4, canvas.width / 450);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      for (const v of s.vertices) {
        ctx.beginPath();
        ctx.arc(v.x * k, v.y * k, Math.max(7, canvas.width / 260), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // The colour key, in the top-left corner on a white panel so it reads over any drawing.
  const key = legendFor(shapes, conditions);
  if (key.length) {
    const f = Math.max(14, Math.round(canvas.width / 110));
    ctx.font = `${f}px Helvetica, Arial, sans-serif`;
    const rows = key.map((e) => `${e.label}  ·  ${e.quantity}`);
    const w = Math.max(...rows.map((r) => ctx.measureText(r).width), ctx.measureText("Colour key").width) + f * 3.2;
    const h = (rows.length + 1) * f * 1.6 + f * 0.8;
    const x0 = f;
    const y0 = f;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = "#111827";
    ctx.font = `bold ${f}px Helvetica, Arial, sans-serif`;
    ctx.fillText("Colour key", x0 + f * 0.7, y0 + f * 1.4);
    ctx.font = `${f}px Helvetica, Arial, sans-serif`;
    key.forEach((e, i) => {
      const y = y0 + f * 1.4 + (i + 1) * f * 1.6;
      ctx.fillStyle = e.colour;
      if (e.kind === "count") {
        ctx.beginPath();
        ctx.arc(x0 + f * 1.2, y - f * 0.35, f * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(x0 + f * 0.7, y - f * (e.kind === "linear" ? 0.5 : 0.85), f, f * (e.kind === "linear" ? 0.3 : 1));
      ctx.fillStyle = "#111827";
      ctx.fillText(rows[i]!, x0 + f * 2.3, y);
    });
  }
  return { dataUrl: canvas.toDataURL("image/jpeg", opts.quality ?? 0.72), width: canvas.width, height: canvas.height, title: opts.title };
}
