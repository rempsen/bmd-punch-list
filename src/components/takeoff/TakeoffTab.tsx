import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useProjectDocuments } from "@/lib/documents/data";
import { groupVersions } from "@/lib/documents/logic";
import { signedUrl } from "@/lib/documents/upload";
import { errText } from "@/lib/platform/db";
import { ensureSheets, updateSheet, useRefreshSheets, useSheets, type PlanSheet } from "@/lib/takeoff/data";
import { openPdf } from "@/lib/takeoff/pdf";
import { filterSheets, sheetLabel } from "@/lib/takeoff/view";
import { PlanViewer } from "./PlanViewer";

/** Plans for one project: pick a drawing set, find a sheet, look at it closely. Measuring builds on this. */
export default function TakeoffTab({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const canEdit = canAny("manage_estimates") || canAny("manage_documents");
  const { data: docs = [], isLoading } = useProjectDocuments(projectId);
  const plans = useMemo(() => groupVersions(docs).plans.map((e) => e.latest).filter((d) => d.mime === "application/pdf" || /\.pdf$/i.test(d.file_name)), [docs]);
  const [docId, setDocId] = useState<string | null>(null);
  const current = plans.find((d) => d.id === docId) ?? plans[0] ?? null;
  const { data: sheets = [], isSuccess: sheetsLoaded } = useSheets(current?.id ?? null);
  const refreshSheets = useRefreshSheets(current?.id ?? null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!current) return;
    let stale = false;
    setPdf(null);
    setError(null);
    setPageNumber(1);
    signedUrl(current.storage_path)
      .then((url) => openPdf(current.id, url))
      .then(
        (d) => !stale && setPdf(d),
        (e) => !stale && setError(errText(e)),
      );
    return () => {
      stale = true;
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Give every page a sheet row the first time a set is opened.
  useEffect(() => {
    if (!pdf || !current || !sheetsLoaded || sheets.length >= pdf.numPages) return;
    ensureSheets(projectId, current.id, pdf.numPages, sheets.map((s) => s.page_number)).then(refreshSheets, (e) => toast.error(errText(e)));
  }, [pdf, current?.id, sheetsLoaded, sheets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!current) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="font-medium">No drawings yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the plans as a PDF under{" "}
          <Link to="/projects/$id" params={{ id: projectId }} search={{ tab: "documents" }} className="underline">
            Documents → Plans
          </Link>
          , then come back here to open them.
        </p>
      </div>
    );
  }
  const pages: PlanSheet[] = sheets.length ? sheets : Array.from({ length: pdf?.numPages ?? 0 }, (_, i) => ({ id: `p${i + 1}`, project_id: projectId, document_id: current.id, page_number: i + 1, sheet_number: null, title: null, discipline: null, floor_label: null, width_pt: null, height_pt: null, rotation: 0 }));
  const sheet = pages.find((s) => s.page_number === pageNumber) ?? null;
  const shown = filterSheets(pages, query);
  const save = (patch: Parameters<typeof updateSheet>[1]) => sheet && !sheet.id.startsWith("p") && updateSheet(sheet.id, patch).then(refreshSheets, (e) => toast.error(errText(e)));

  return (
    <div className="flex h-[calc(100vh-13rem)] min-h-[32rem] flex-col gap-3 lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-2 lg:w-56">
        {plans.length > 1 && (
          <label className="text-xs font-medium text-muted-foreground">
            Drawing set
            <select className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" value={current.id} onChange={(e) => setDocId(e.target.value)}>
              {plans.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Input type="search" placeholder="Find a sheet…" aria-label="Find a sheet by number, title or page" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {pdf ? `${shown.length} of ${pdf.numPages} sheets` : error ? "" : "Opening drawings…"}
        </p>
        <ul className="flex min-h-0 gap-2 overflow-auto lg:flex-1 lg:flex-col">
          {pdf &&
            shown.map((s) => (
              <li key={s.page_number} className="shrink-0">
                <button
                  type="button"
                  aria-current={s.page_number === pageNumber ? "true" : undefined}
                  onClick={() => setPageNumber(s.page_number)}
                  className={`block w-36 rounded-md border p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full ${s.page_number === pageNumber ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"}`}
                >
                  <Thumb doc={pdf} pageNumber={s.page_number} />
                  <span className="mt-1 block truncate text-xs font-medium">{sheetLabel(s)}</span>
                  {s.title && <span className="block truncate text-xs text-muted-foreground">{s.title}</span>}
                </button>
              </li>
            ))}
        </ul>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {sheet && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Sheet number
              <input key={`${sheet.id}-n-${sheet.sheet_number}`} disabled={!canEdit} defaultValue={sheet.sheet_number ?? ""} placeholder={`Page ${sheet.page_number}`} onBlur={(e) => e.target.value.trim() !== (sheet.sheet_number ?? "") && void save({ sheet_number: e.target.value.trim() || null })} className="mt-1 block h-10 w-32 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
            </label>
            <label className="min-w-40 flex-1 text-xs font-medium text-muted-foreground">
              Title
              <input key={`${sheet.id}-t-${sheet.title}`} disabled={!canEdit} defaultValue={sheet.title ?? ""} placeholder="e.g. Level 2 finish plan" onBlur={(e) => e.target.value.trim() !== (sheet.title ?? "") && void save({ title: e.target.value.trim() || null })} className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" />
            </label>
            <p className="pb-2 text-xs text-muted-foreground">
              Page {sheet.page_number} of {pdf?.numPages ?? "…"}
            </p>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
          {error ? <p className="p-6 text-sm text-destructive">Could not open {current.file_name}: {error}</p> : pdf ? <PlanViewer doc={pdf} pageNumber={pageNumber} onPageSize={(size, rotation) => sheet && sheet.width_pt == null && void save({ width_pt: size.width, height_pt: size.height, rotation })} /> : <p className="p-6 text-sm text-muted-foreground">Opening drawings…</p>}
        </div>
      </section>
    </div>
  );
}

/** A small picture of a sheet, drawn only once it scrolls into view. */
function Thumb({ doc, pageNumber }: { doc: PDFDocumentProxy; pageNumber: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current!;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void doc.getPage(pageNumber).then((page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 280 / base.width });
        el.width = vp.width;
        el.height = vp.height;
        const t = page.render({ canvasContext: el.getContext("2d")!, canvas: el, viewport: vp } as never);
        task = t;
        t.promise.catch(() => undefined);
      });
    });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      task?.cancel();
    };
  }, [doc, pageNumber]);
  return <canvas ref={ref} aria-hidden className="aspect-[3/2] w-full rounded-sm bg-white object-contain" />;
}
