/** A sheet drawn with the takeoff's coloured measurements and a colour key, as a picture for quotes. Browser only. */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { KeyRow, Mark } from "./marked";

export type MarkedSheet = { dataUrl: string; width: number; height: number; title: string };

export async function renderTakeoffSheet(doc: PDFDocumentProxy, pageNumber: number, marks: Mark[], key: KeyRow[], opts: { title: string; maxWidth?: number; quality?: number }): Promise<MarkedSheet> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const k = Math.min((opts.maxWidth ?? 1800) / base.width, 3);
  const vp = page.getViewport({ scale: k });
  const canvas = document.createElement("canvas");
  const W = (canvas.width = Math.round(vp.width));
  const H = (canvas.height = Math.round(vp.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  await page.render({ canvasContext: ctx, canvas, viewport: vp } as never).promise;

  const path = (pts: [number, number][], close: boolean) => {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    if (close) ctx.closePath();
  };
  // Areas first, then cut-outs over them, then lines and counts on top.
  const order = { area: 0, cut: 1, line: 2, count: 3 } as const;
  for (const m of [...marks].sort((a, b) => order[a.kind] - order[b.kind])) {
    ctx.strokeStyle = m.colour;
    ctx.fillStyle = m.colour;
    ctx.setLineDash([]);
    if (m.kind === "area") {
      ctx.beginPath();
      path(m.pts, true);
      for (const h of m.holes) path(h, true);
      ctx.globalAlpha = 0.3;
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(2, W / 900);
      ctx.stroke();
    } else if (m.kind === "cut") {
      ctx.beginPath();
      path(m.pts, true);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.lineWidth = Math.max(2, W / 900);
      ctx.setLineDash([W / 150, W / 220]);
      ctx.stroke();
    } else if (m.kind === "line") {
      ctx.beginPath();
      path(m.pts, false);
      ctx.lineWidth = Math.max(4, W / 450);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else {
      for (const [x, y] of m.pts) {
        ctx.beginPath();
        ctx.arc(x * W, y * H, Math.max(7, W / 260), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);

  // The colour key, in the top-left corner on a white panel so it reads over any drawing.
  if (key.length) {
    const f = Math.max(14, Math.round(W / 110));
    ctx.font = `${f}px Helvetica, Arial, sans-serif`;
    const rows = key.map((e) => `${e.label}  ·  ${e.quantity}`);
    const w = Math.max(...rows.map((r) => ctx.measureText(r).width), ctx.measureText("Colour key").width) + f * 3.2;
    const h = (rows.length + 1) * f * 1.6 + f * 0.8;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillRect(f, f, w, h);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(f, f, w, h);
    ctx.fillStyle = "#111827";
    ctx.font = `bold ${f}px Helvetica, Arial, sans-serif`;
    ctx.fillText("Colour key", f * 1.7, f * 2.4);
    ctx.font = `${f}px Helvetica, Arial, sans-serif`;
    key.forEach((e, i) => {
      const y = f * 2.4 + (i + 1) * f * 1.6;
      ctx.fillStyle = e.colour;
      if (e.kind === "count") {
        ctx.beginPath();
        ctx.arc(f * 2.2, y - f * 0.35, f * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(f * 1.7, y - f * (e.kind === "line" ? 0.5 : 0.85), f, f * (e.kind === "line" ? 0.3 : 1));
      ctx.fillStyle = "#111827";
      ctx.fillText(rows[i]!, f * 3.3, y);
    });
  }
  return { dataUrl: canvas.toDataURL("image/jpeg", opts.quality ?? 0.72), width: W, height: H, title: opts.title };
}
