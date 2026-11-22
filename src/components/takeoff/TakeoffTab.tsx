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
import { suggestSheetName } from "@/lib/ai/scope";
import { openPdf, sheetText } from "@/lib/takeoff/pdf";
import { filterSheets, sheetLabel } from "@/lib/takeoff/view";
import { Button } from "@/components/ui/button";
import { useLabourRates, useMaterials, useTemplates } from "@/lib/catalogue/data";
import { catalogueView, saveLines, useEstimate, useFinishes, useRefreshEstimate } from "@/lib/estimating/data";
import { lineFromFinish, simpleLine } from "@/lib/estimating/lines";
import { carryForward, measureShape, qtyFor, totalsByCondition } from "@/lib/takeoff/geometry";
import { useTakeoff, useTakeoffActions, type Condition } from "@/lib/takeoff/store";
import { Measure } from "./Measure";

/** Plans for one project: pick a drawing set, find a sheet, look at it closely. Measuring builds on this. */
export default function TakeoffTab({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const canEdit = canAny("manage_estimates") || canAny("manage_documents");
  const { data: docs = [], isLoading } = useProjectDocuments(projectId);
  const previousOf = useMemo(() => new Map(groupVersions(docs).plans.map((e) => [e.latest.id, e.older[0] ?? null])), [docs]);
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

  const canPrice = canAny("view_pricing");
  const canEstimate = canAny("manage_estimates");
  const { data: takeoff } = useTakeoff(projectId);
  const actions = useTakeoffActions(projectId, takeoff);
  const { data: versions = [] } = useEstimate(projectId, canPrice);
  const { data: finishes = [] } = useFinishes(projectId, canPrice);
  const { data: templates = [] } = useTemplates(canPrice);
  const { data: materials = [] } = useMaterials(canPrice);
  const { data: labour = [] } = useLabourRates(canPrice);
  const refreshEstimate = useRefreshEstimate(projectId);
  const totals = useMemo(() => totalsByCondition(takeoff?.shapes ?? []), [takeoff?.shapes]);
  // A newer upload of the same drawing file: offer to bring the earlier measurements across once.
  const previous = current ? (previousOf.get(current.id) ?? null) : null;
  const { data: previousSheets = [] } = useSheets(previous?.id ?? null);
  const oldShapes = (takeoff?.shapes ?? []).filter((s) => previousSheets.some((p) => p.id === s.sheet_id));
  const hasOwn = (takeoff?.shapes ?? []).some((s) => sheets.some((p) => p.id === s.sheet_id));
  const bringForward = async () => {
    const r = carryForward(previousSheets, sheets, oldShapes);
    try {
      for (const [from, to] of Object.entries(r.sheetMap)) {
        const sc = takeoff!.scales.find((x) => x.sheet_id === from && !x.region);
        if (sc && !takeoff!.scales.some((x) => x.sheet_id === to && !x.region)) await actions.setScale(to, sc.feet_per_point, sc.provenance);
      }
      for (const s of r.shapes) await actions.putShape(s);
      toast.success(`${r.shapes.length} measurements brought forward and marked for checking.${r.unmatched.length ? ` No matching sheet for: ${r.unmatched.join(", ")}.` : ""}`);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const target = versions.find((v) => v.kind === "estimate" && !v.locked) ?? null;

  /** Puts a condition's quantity on the open estimate price as a line that follows the takeoff. */
  const toEstimate = async (c: Condition) => {
    if (!target) return void toast.error("There is no open price to add to. Start the estimate on the Estimate tab first.");
    if (target.lines.some((l) => l.takeoff_condition_id === c.id)) return void toast.info(`"${c.label}" is already on ${target.name}. Its quantity is updated from the Estimate tab.`);
    const uom = c.kind === "area" ? "SF" : c.kind === "linear" ? "LF" : "EA";
    const section = c.default_section || "General";
    const qty = totals[c.id] ? qtyFor(totals[c.id]!, uom, section) : 0;
    const finish = finishes.find((f) => f.id === c.finish_id);
    const template = finish && templates.find((t) => t.id === finish.assembly_template_id);
    const base = finish && template && uom === "SF" ? lineFromFinish({ versionId: target.id, finish, template, catalogue: catalogueView(materials, labour), qty, section, markupPct: target.default_markup_pct, source: "takeoff" }).item : simpleLine({ versionId: target.id, kind: "misc", section, description: c.label, qty, uom, unitCostCents: null, pst: false, markupPct: target.default_markup_pct, costCode: null });
    try {
      await saveLines([{ ...base, line: { ...base.line, source: "takeoff", takeoff_condition_id: c.id } }]);
      refreshEstimate();
      toast.success(`${c.label}: ${qty.toLocaleString("en-CA")} ${uom} added to ${target.name}.`);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const [naming, setNaming] = useState<string | null>(null);
  /** Fills in sheet numbers and titles from each sheet's title block, for sheets nobody has named yet. */
  const nameSheets = async () => {
    if (!pdf) return;
    const todo = sheets.filter((s) => !s.sheet_number);
    let named = 0;
    try {
      for (const [i, s] of todo.entries()) {
        setNaming(`Reading sheet ${i + 1} of ${todo.length}…`);
        const t = await sheetText(pdf, s.page_number);
        const guess = suggestSheetName(t.items, t.page);
        if (guess) {
          await updateSheet(s.id, { sheet_number: guess.sheet_number, ...(guess.title && !s.title ? { title: guess.title } : {}) });
          named++;
        }
      }
      toast.success(`${named} of ${todo.length} sheets named from their title blocks.${named < todo.length ? " The rest have no readable title block; name those by hand." : ""} Check them against the drawings.`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setNaming(null);
      refreshSheets();
    }
  };
  const exportQuantities = async () => {
    const XLSX = await import("xlsx");
    const rows = (takeoff?.shapes ?? []).map((s) => {
      const c = takeoff!.conditions.find((x) => x.id === s.condition_id);
      const sh = sheets.find((x) => x.id === s.sheet_id);
      const m = measureShape(s);
      return { Measuring: c?.label ?? "", Section: s.section ?? "", Sheet: sh ? sheetLabel(sh) : "", Repeats: s.multiplier, SF: +m.sf.toFixed(2), SY: +m.sy.toFixed(2), LF: +m.lf.toFixed(2), EA: m.ea };
    });
    const summary = (takeoff?.conditions ?? []).map((c) => ({ Measuring: c.label, SF: +(totals[c.id]?.sf ?? 0).toFixed(2), SY: +(totals[c.id]?.sy ?? 0).toFixed(2), LF: +(totals[c.id]?.lf ?? 0).toFixed(2), EA: totals[c.id]?.ea ?? 0 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Totals");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Measurements");
    XLSX.writeFile(wb, "takeoff-quantities.xlsx");
  };

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
        {canEdit && pdf && sheets.some((x) => !x.sheet_number) && (
          <Button size="sm" variant="outline" disabled={!!naming} onClick={() => void nameSheets()}>
            {naming ?? "Name sheets from title blocks"}
          </Button>
        )}
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
            {(takeoff?.shapes.length ?? 0) > 0 && (
              <Button size="sm" variant="outline" className="mb-1" onClick={() => void exportQuantities().catch((e) => toast.error(errText(e)))}>
                Export quantities
              </Button>
            )}
          </div>
        )}
        {canEstimate && previous && oldShapes.length > 0 && !hasOwn && sheets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            <span className="min-w-0 flex-1">
              These are newer drawings than version {previous.version}, which has {oldShapes.length} measurements. Bring them across to the sheets with the same number? The earlier version is left as it is.
            </span>
            <Button size="sm" variant="outline" className="bg-white" onClick={() => void bringForward()}>
              Bring measurements forward
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {error ? (
            <p className="p-6 text-sm text-destructive">Could not open {current.file_name}: {error}</p>
          ) : pdf && takeoff ? (
            <Measure
              doc={pdf}
              pageNumber={pageNumber}
              sheetId={sheet && !sheet.id.startsWith("p") ? sheet.id : null}
              data={takeoff}
              actions={actions}
              canEdit={canEstimate}
              finishes={finishes}
              onPageSize={(size, rotation) => sheet && sheet.width_pt == null && void save({ width_pt: size.width, height_pt: size.height, rotation })}
              conditionExtra={(c) =>
                canEstimate && (
                  <Button size="sm" variant="outline" onClick={() => void toEstimate(c)}>
                    To estimate
                  </Button>
                )
              }
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Opening drawings…</p>
          )}
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
