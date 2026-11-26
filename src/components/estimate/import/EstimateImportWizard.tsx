import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NewProductFromImportDialog, type CreatedProduct } from "@/components/catalogue/NewProductFromImportDialog";
import { useAuth } from "@/lib/auth";
import { db, errText } from "@/lib/platform/db";
import { useEstimate } from "@/lib/estimating/data";
import type { CatalogueView } from "@/lib/estimating/assemble";
import type { Template } from "@/lib/catalogue/data";
import { enqueueFile } from "@/lib/documents/index-queue";
import { uploadEstimateFile } from "@/lib/estimate-import/upload";
import { reparseEstimateImport, runEstimateImport } from "@/lib/estimate-import/run.functions";
import { confirmMatch, matchImportedLines } from "@/lib/estimate-import/match.functions";
import { commitImportLines, loadReview, saveImportDecision, saveRowMatch, type ReviewImport, type ReviewRow, type RowMatch } from "@/lib/estimate-import/review-data";
import { categoryFor, payloadPrice, reconciliation, rowToPayload, type Decision, type GroupStrategy } from "@/lib/estimate-import/commit";
import { fileTarget } from "@/lib/estimate-import/parse";
import { rememberTemplate } from "@/lib/estimate-import/templates";
import { candidateLabel, convertPrice, priceDelta, type Candidate } from "@/lib/estimate-import/match";
import { changeReviewUnit, reviewedRow, REVIEW_UNITS } from "@/lib/estimate-import/review-units";
import { MAPPING_FIELDS, type ImportOptions, type Mapping, type MappingField } from "@/lib/estimate-import/types";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const select = "h-10 rounded-md border border-input bg-background px-2 text-sm";
const FIELD_LABEL: Record<MappingField, string> = {
  description: "Description", detail: "Detail", group_hint: "Group code", qty: "Quantity", uom: "Unit", total_qty: "Total quantity (with waste)", waste_pct: "Waste %",
  material_unit_cost: "Material unit cost", labour_unit_cost: "Labour unit cost", markup_pct: "Markup %", margin_pct: "Margin %", sell_unit: "Unit sell", line_total: "Line total (sell)",
  taxable: "Taxable", colour: "Colour", notes: "Notes", cost_waste_pct: "Waste % (cost)", material_total: "Material cost (extended)", material_sales: "Material sell (extended)", labour_total: "Labour cost (extended)",
};
const candKey = (c: Candidate) => c.catalogue_item_id ?? c.assembly_id ?? c.name;
const unitsFit = (c: Candidate, uom: string | null) => convertPrice(1, c.uom, uom) != null;
type Rates = { pstPct: number } | null;

/** The decision a row starts with: a saved one, else an exact earlier match whose price agrees, else the file's own numbers. */
function startingDecision(r: ReviewRow): Decision {
  if (r.match.decision) return r.match.decision;
  const top = r.match.candidates?.[0];
  if (r.match.status === "exact_alias" && top && r.parsed && unitsFit(top, r.parsed.uom) && !priceDelta(r.parsed, top).needs_verification) return { action: "catalogue", candidate: top };
  return { action: "keep_imported" };
}

export function EstimateImportWizard({ projectId, importId, catalogue, templates, rates, onClose, onDone }: { projectId: string; importId?: string; catalogue: CatalogueView; templates: Template[]; rates: Rates; onClose: () => void; onDone?: (versionId: string) => void }) {
  const [imp, setImp] = useState<ReviewImport | null>(null);
  const [step, setStep] = useState(importId ? 3 : 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [options, setOptions] = useState<ImportOptions>({ gross_up_pst_pct: null, default_markup_pct: null, category_strategy: "groups" });
  const [strategy, setStrategy] = useState<GroupStrategy>("groups");
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [ack, setAck] = useState(false);
  const [append, setAppend] = useState(false);
  const [saveLayout, setSaveLayout] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [newRow, setNewRow] = useState<string | null>(null);
  const saves = useRef(new Map<string, Promise<void>>());
  const [saving, setSaving] = useState(0);
  const { canAny } = useAuth();
  const qc = useQueryClient();
  const { data: versions = [] } = useEstimate(projectId);
  const runFn = useServerFn(runEstimateImport);
  const reparseFn = useServerFn(reparseEstimateImport);
  const matchFn = useServerFn(matchImportedLines);
  const confirmFn = useServerFn(confirmMatch);
  const readOnly = imp ? imp.status === "committed" || imp.status === "discarded" : !!importId;

  const items = useMemo(() => imp?.rows.filter((r) => r.kind === "item" && r.parsed).map((r) => reviewedRow(r, decisions[r.id])) ?? [], [imp, decisions]);
  const groups = useMemo(() => [...new Set(items.map((r) => r.group_name ?? "General"))], [items]);
  const sections = useMemo(() => [...new Set(versions.flatMap((v) => v.lines.map((l) => l.section)))], [versions]);
  const hasBase = versions.some((v) => v.is_base && v.kind === "estimate");

  const execute = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const load = async (id: string) => {
    const data = await loadReview(id);
    setImp(data);
    setMapping(data.mapping);
    setOptions({ ...data.options, default_markup_pct: data.options.default_markup_pct ?? versions.find((v) => v.is_base)?.default_markup_pct ?? null });
    setLayoutName(data.file_name);
    setDecisions(Object.fromEntries(data.rows.filter((r) => r.kind === "item").map((r) => [r.id, startingDecision(r)])));
    return data;
  };
  useEffect(() => {
    if (importId) void execute(async () => void (await load(importId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);

  /** Finds catalogue matches for every line and saves them on the rows. */
  const enterLines = async (data: ReviewImport) => {
    setProgress("Matching lines to the catalogue…");
    const rows = data.rows.filter((r) => r.kind === "item" && r.parsed);
    const found = await matchFn({ data: { lines: rows.map((r) => r.parsed!) } });
    const next: ReviewImport = { ...data, rows: data.rows.map((r) => ({ ...r })) };
    await Promise.all(
      rows.map(async (r, i) => {
        const m = found[i];
        if (!m) return;
        const target = next.rows.find((x) => x.id === r.id)!;
        target.match = { ...m };
        await saveRowMatch(r.id, target.match);
      }),
    );
    setImp(next);
    setDecisions(Object.fromEntries(next.rows.filter((r) => r.kind === "item").map((r) => [r.id, startingDecision(r)])));
    await db.from("estimate_imports").update({ status: "reviewing", updated_at: new Date().toISOString() }).eq("id", data.id).eq("status", "parsed");
    setStep(3);
  };

  const upload = (file: File) =>
    execute(async () => {
      setProgress("Uploading…");
      let result = await uploadEstimateFile(projectId, file, (s, t) => setProgress(`Uploading ${Math.round((s / Math.max(t, 1)) * 100)}%`));
      if (result.status === "needs_index") {
        setProgress("Reading the PDF…");
        const status = await enqueueFile("document", result.documentId, file, file.type, file.name);
        if (status !== "done") throw new Error(`The PDF could not be read (${status}). It is saved under Documents → Estimates (imported); try again from there.`);
        result = { documentId: result.documentId, ...(await runFn({ data: { projectId, documentId: result.documentId } })) };
      }
      if (result.status !== "parsed") throw new Error(result.message);
      const data = await load(result.importId);
      if (data.summary.mapping_source === "template" && result.mappingConfidence >= 0.9) await enterLines(data);
      else setStep(2);
    });

  const choose = (row: ReviewRow, d: Decision) => {
    const previous = decisions[row.id];
    const next = { ...(previous?.reviewed ? { reviewed: previous.reviewed, ...(previous.unitNote ? { unitNote: previous.unitNote } : {}) } : {}), ...d };
    setDecisions((cur) => ({ ...cur, [row.id]: next }));
    setAck(false);
    setSaving((n) => n + 1);
    const pending = (saves.current.get(row.id) ?? Promise.resolve()).catch(() => undefined).then(() => saveImportDecision(row.id, next));
    saves.current.set(row.id, pending);
    void pending.catch((e: unknown) => setError(`Could not save the choice for ${row.parsed?.description ?? "a line"}: ${e instanceof Error ? e.message : String(e)}`)).finally(() => setSaving((n) => n - 1));
  };
  const changeUnit = (row: ReviewRow, unit: string) => {
    if (!row.parsed) return;
    let result = changeReviewUnit(row.parsed, unit);
    if (result.needsConfirmation) {
      if (!window.confirm(`There is no fixed conversion from ${row.parsed.uom} to ${unit}. Keep the numbers and relabel this line?`)) return;
      result = changeReviewUnit(row.parsed, unit, true);
    }
    choose(row, { ...(decisions[row.id] ?? { action: "keep_imported" }), reviewed: result.fields, unitNote: result.note });
  };
  const applyCandidate = async (row: ReviewRow, c: Candidate, keepPrice: boolean, action: "catalogue" | "new_product" = "catalogue") => {
    if (!row.parsed) return;
    if (!unitsFit(c, row.parsed.uom)) throw new Error(`${row.parsed.description}: ${c.uom} cannot be converted to ${row.parsed.uom}`);
    await confirmFn({ data: { importRowId: row.id, line: row.parsed, candidate: c } });
    choose(row, { action, candidate: c, keepPrice });
  };

  const ctxFor = (r: ReviewRow) => ({ options, category: categoryFor(r.group_name, categories, strategy), catalogue, templates });
  const preview = useMemo(() => {
    let cost = 0, sell = 0;
    const issues: string[] = [];
    const counts = { catalogue: 0, keep_imported: 0, new_product: 0, skip: 0 };
    if (!rates) issues.push("Tax settings have not loaded yet.");
    for (const r of items) {
      const d = decisions[r.id] ?? { action: "keep_imported" };
      counts[d.action]++;
      if (d.action === "skip" || !rates) continue;
      try {
        const p = payloadPrice(rowToPayload(r, d, ctxFor(r), rates), rates);
        if (p.unknown) issues.push(`${r.parsed!.description}: ${p.unknownLabels.join(", ")} has no price`);
        cost += p.costCents / 100;
        sell += p.sellCents / 100;
      } catch (e) {
        issues.push(errText(e));
      }
    }
    return { cost, sell, issues, counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, decisions, options, categories, strategy, catalogue, templates, rates]);
  const target = imp ? fileTarget(imp.summary, options) : null;
  const rec = reconciliation(preview.sell, target, ack);
  const included = items.filter((r) => decisions[r.id]?.action !== "skip");

  const commit = () =>
    execute(async () => {
      if (!imp || !rates) return;
      await Promise.all(saves.current.values());
      const payload = included.map((r) => ({ ...rowToPayload(r, decisions[r.id]!, ctxFor(r), rates), import_row_id: r.id, decision: decisions[r.id] }));
      const versionId = await commitImportLines(imp.id, payload, append, ack, preview.sell);
      await qc.invalidateQueries({ queryKey: ["estimate", projectId] });
      await qc.invalidateQueries({ queryKey: ["estimate-imports", projectId] });
      toast.success(`Imported ${included.length} lines from ${imp.file_name}`);
      onDone?.(versionId);
      onClose();
    });

  const reparse = () =>
    execute(async () => {
      if (!imp) return;
      setProgress("Reading the file again…");
      const result = await reparseFn({ data: { importId: imp.id, mapping, options } });
      if (result.status !== "parsed") throw new Error(result.message);
      const fresh = await load(imp.id);
      if (saveLayout && layoutName.trim()) await rememberTemplate(db, { name: layoutName.trim(), signature: fresh.summary.header_signature, mapping: fresh.mapping, options: { category_strategy: fresh.options.category_strategy } }, null);
      setAck(false);
      await enterLines(fresh);
    });

  const header = imp?.summary.header ?? [];
  const width = Math.max(header.length, ...items.slice(0, 15).map((r) => r.raw.cells.length), 1);
  const fieldsAt = (i: number) => (Object.entries(mapping) as [MappingField, number][]).filter(([, n]) => n === i).map(([f]) => f);
  const newItem = items.find((r) => r.id === newRow);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[92dvh] w-[96vw] max-w-6xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? "Imported estimate" : "Import an estimate"}
            {imp ? ` · ${imp.file_name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? `This import is ${imp?.status ?? "…"}. Its lines are shown as they were read from the file.` : "Excel, CSV or PDF. The file is filed under Documents → Estimates (imported). Nothing reaches the estimate until you create it on the last step."}
          </DialogDescription>
        </DialogHeader>
        {!readOnly && (
          <nav className="flex flex-wrap gap-3 text-sm" aria-label="Steps">
            {["Upload", "Columns", "Lines", "Create"].map((name, i) => (
              <span key={name} className={step === i + 1 ? "font-semibold text-primary" : "text-muted-foreground"}>
                {i + 1}. {name}
              </span>
            ))}
          </nav>
        )}
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {busy && <p role="status" className="text-sm text-muted-foreground">{progress || "Working…"}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 1 && (
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f && !busy) void upload(f);
              }}
              className="flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-border p-4 text-center"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span>Drop an estimate here, or choose a file</span>
              <input disabled={busy} type="file" accept=".xlsx,.xls,.xlsm,.csv,.pdf" aria-label="Estimate file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} className="max-w-full text-sm" />
            </label>
          )}

          {imp && step === 2 && (
            <>
              <p className="mb-2 text-sm text-muted-foreground">Check what each column holds. Totals are copied from the file's own columns where it has them.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {Array.from({ length: width }, (_, i) => {
                        const fields = fieldsAt(i);
                        return (
                          <th key={i} className="p-2 text-left align-top font-normal">
                            <div className="mb-1 truncate font-medium" title={header[i]}>{header[i] || `Column ${i + 1}`}</div>
                            <select
                              aria-label={`Column ${header[i] || i + 1}`}
                              className={select}
                              value={fields[0] ?? ""}
                              disabled={readOnly}
                              onChange={(e) => {
                                const m = { ...mapping };
                                if (fields[0]) delete m[fields[0]];
                                if (e.target.value) m[e.target.value as MappingField] = i;
                                setMapping(m);
                              }}
                            >
                              <option value="">Not used</option>
                              {MAPPING_FIELDS.map((f) => (
                                <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                              ))}
                            </select>
                            {fields.length > 1 && <div className="mt-1 text-xs text-muted-foreground">Also: {fields.slice(1).map((f) => FIELD_LABEL[f]).join(", ")}</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 12).map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        {Array.from({ length: width }, (_, i) => (
                          <td key={i} className="max-w-48 truncate p-2" title={r.raw.cells[i]}>{r.raw.cells[i]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={!!options.gross_up_pst_pct} onChange={(e) => setOptions({ ...options, gross_up_pst_pct: e.target.checked ? (imp.summary.materials_tax_detected?.pct ?? rates?.pstPct ?? 7) : null })} />
                  <span>The file charges materials tax separately{imp.summary.materials_tax_detected?.pct ? ` (${imp.summary.materials_tax_detected.pct}% found)` : ""}. Carry it as PST on material costs, so the lines add up to the file's total with tax.</span>
                </label>
                <label className="flex flex-wrap items-center gap-3">
                  Markup for lines with none
                  <Input aria-label="Markup for lines with none" type="number" min={0} max={999} className="h-10 w-24" value={options.default_markup_pct ?? ""} placeholder="35" onChange={(e) => setOptions({ ...options, default_markup_pct: e.target.value === "" ? null : Number(e.target.value) })} />%
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={saveLayout} onChange={(e) => setSaveLayout(e.target.checked)} />
                  Remember these columns for files laid out the same way
                </label>
                {saveLayout && <Input aria-label="Layout name" className="h-10 max-w-sm" value={layoutName} onChange={(e) => setLayoutName(e.target.value)} />}
              </div>
            </>
          )}

          {imp && step >= 3 && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 py-3 text-sm">
                <span>Catalogue {preview.counts.catalogue + preview.counts.new_product}</span>
                <span>Kept as imported {preview.counts.keep_imported}</span>
                <span>Left out {preview.counts.skip}</span>
                <strong>Cost {money(preview.cost)} · Sell {money(preview.sell)}</strong>
                <span className="text-muted-foreground">File {target == null ? "states no total" : money(target)}</span>
              </div>
              {!readOnly && step === 3 && (
                <div className="flex flex-wrap gap-2 py-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void execute(async () => { for (const r of items) { const c = r.match.candidates?.[0]; if (r.match.status === "exact_alias" && c && unitsFit(c, r.parsed!.uom)) await applyCandidate(r, c, false); } })}>Use every exact match</Button>
                  <Button size="sm" variant="outline" onClick={() => items.forEach((r) => choose(r, { action: "keep_imported" }))}>Keep everything as imported</Button>
                  <Button size="sm" variant="ghost" onClick={() => items.forEach((r) => choose(r, { action: "skip" }))}>Leave everything out</Button>
                  <Button size="sm" variant="link" onClick={() => setStep(2)}>Check the columns</Button>
                </div>
              )}
              {step === 3 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        {["Include", "Line", "Qty", "Material / labour", "Markup", "Catalogue", ""].map((h) => (
                          <th key={h} className="p-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <GroupRows key={g} label={g} rows={items.filter((r) => (r.group_name ?? "General") === g)} decisions={decisions} readOnly={readOnly} busy={busy} canCatalogue={canAny("manage_catalogue")} choose={choose} changeUnit={changeUnit} use={(r, c, keep) => void execute(() => applyCandidate(r, c, keep))} onNew={setNewRow} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {step === 3 && preview.issues.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-destructive">
                  {preview.issues.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
                  {preview.issues.length > 12 && <li>…and {preview.issues.length - 12} more</li>}
                </ul>
              )}
              {!readOnly && rec.required && (
                <label className="my-3 flex gap-2 rounded-md border border-border p-3 text-sm">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  The lines come to {money(Math.abs(rec.difference))} {rec.difference > 0 ? "more" : "less"} than the file's total. Import anyway.
                </label>
              )}
              {step === 4 && (
                <div className="space-y-3 py-4 text-sm">
                  <p>{included.length} lines in {groups.length} {groups.length === 1 ? "group" : "groups"}.</p>
                  <p>{!hasBase ? "They become the Base estimate." : append ? "They are added to the Base estimate." : `They become a new alternate, “Imported from ${imp.file_name}”.`}</p>
                  {hasBase && (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />
                      Add them to the Base estimate instead
                    </label>
                  )}
                  <label className="flex flex-wrap items-center gap-2">
                    Categories
                    <select aria-label="Categories" className={select} value={strategy} onChange={(e) => setStrategy(e.target.value as GroupStrategy)}>
                      <option value="groups">One per group in the file</option>
                      <option value="map">Put each group in a category of this job</option>
                      <option value="single">All under “Imported”</option>
                    </select>
                  </label>
                  {strategy === "map" &&
                    groups.map((g) => (
                      <label key={g} className="flex flex-wrap items-center gap-3 pl-4">
                        <span className="min-w-48">{g}</span>
                        <select aria-label={`Category for ${g}`} className={select} value={categories[g] ?? ""} onChange={(e) => setCategories({ ...categories, [g]: e.target.value })}>
                          <option value="">General</option>
                          {sections.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </label>
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
          <Button variant="outline" disabled={busy} onClick={readOnly ? onClose : () => (step > 1 && step !== 3 ? setStep(step - 1) : step === 3 ? setStep(2) : onClose())}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {readOnly || step === 1 ? "Close" : "Back"}
          </Button>
          {!readOnly && step === 2 && (
            <Button disabled={busy || mapping.description === undefined} onClick={reparse}>
              Review lines <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {!readOnly && step === 3 && (
            <Button disabled={busy || saving > 0 || preview.issues.length > 0 || !rec.allowed || included.length === 0} onClick={() => setStep(4)}>
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {!readOnly && step === 4 && (
            <Button disabled={busy || saving > 0 || !rec.allowed || included.length === 0 || !rates} onClick={commit}>
              Create the estimate
            </Button>
          )}
        </footer>
        {newItem?.parsed && (
          <NewProductFromImportDialog
            line={newItem.parsed}
            onClose={() => setNewRow(null)}
            onCreated={(p: CreatedProduct) => {
              const c: Candidate = p.assemblyId
                ? { assembly_id: p.assemblyId, name: newItem.parsed!.description, score: 1, uom: newItem.parsed!.uom ?? "SF", material_unit_cost: newItem.parsed!.material_unit_cost, labour_unit_cost: newItem.parsed!.labour_unit_cost, reason: "new product" }
                : { catalogue_item_id: p.materialId, name: newItem.parsed!.description, score: 1, uom: newItem.parsed!.uom ?? "SF", material_unit_cost: newItem.parsed!.material_unit_cost, labour_unit_cost: null, reason: "new product" };
              choose(newItem, { action: "new_product", candidate: c, keepPrice: true });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GroupRows({ label, rows, decisions, readOnly, busy, canCatalogue, choose, changeUnit, use, onNew }: { label: string; rows: ReviewRow[]; decisions: Record<string, Decision>; readOnly: boolean; busy: boolean; canCatalogue: boolean; choose: (r: ReviewRow, d: Decision) => void; changeUnit: (r: ReviewRow, unit: string) => void; use: (r: ReviewRow, c: Candidate, keepPrice: boolean) => void; onNew: (id: string) => void }) {
  return (
    <>
      <tr className="bg-muted/60">
        <th colSpan={7} className="p-2 text-left">{label}</th>
      </tr>
      {rows.map((r) => {
        const p = r.parsed;
        if (!p) return null;
        const d = decisions[r.id] ?? { action: "keep_imported" as const };
        const candidates = (r.match as RowMatch).candidates ?? [];
        const shown = d.candidate ?? candidates[0];
        const delta = shown ? priceDelta(p, shown) : null;
        const fits = shown ? unitsFit(shown, p.uom) : false;
        const linked = d.action === "catalogue" || d.action === "new_product";
        return (
          <tr key={r.id} className="border-t border-border align-top">
            <td className="p-2">
              <input aria-label={`Include ${p.description}`} type="checkbox" disabled={readOnly} checked={d.action !== "skip"} onChange={(e) => choose(r, { action: e.target.checked ? "keep_imported" : "skip" })} />
            </td>
            <td className="max-w-64 p-2">
              <span className="font-medium">{p.description}</span>
              {p.detail && <p className="text-xs text-muted-foreground">{p.detail}</p>}
              {r.raw.page && <p className="text-xs text-muted-foreground">Page {r.raw.page}</p>}
            </td>
            <td className="p-2"><div className="flex items-center gap-1"><span>{p.qty == null ? "?" : Number(p.qty.toFixed(5))}</span><select aria-label={`Unit for ${p.description}`} className="h-8 rounded border border-input bg-background px-1 text-xs" disabled={readOnly || busy} value={p.uom ?? ""} onChange={(e) => changeUnit(r, e.target.value)}>{p.uom && !(REVIEW_UNITS as readonly string[]).includes(p.uom) && <option>{p.uom}</option>}{!p.uom && <option value="">Unit</option>}{REVIEW_UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>{d.unitNote && <p className="mt-1 text-xs text-muted-foreground">{d.unitNote}</p>}{p.waste_pct ? <span className="block text-xs text-muted-foreground">+{p.waste_pct}% waste</span> : null}</td>
            <td className="whitespace-nowrap p-2">{p.material_unit_cost == null ? "—" : money(p.material_unit_cost)} / {p.labour_unit_cost == null ? "—" : money(p.labour_unit_cost)}</td>
            <td className="p-2">{p.markup_pct == null ? "—" : `${Math.round(p.markup_pct * 100) / 100}%`}</td>
            <td className="min-w-64 p-2">
              <span className="rounded border border-border px-1.5 py-0.5 text-xs">
                {d.action === "skip" ? "Left out" : linked ? (d.keepPrice ? "Catalogue item, imported price" : "Catalogue") : r.match.status === "exact_alias" ? "Exact match found" : candidates.length ? "Possible match" : "No match"}
              </span>
              {shown && (
                <>
                  <p className="mt-1">{candidateLabel(shown, p.uom)}</p>
                  {delta?.material && <p className={delta.needs_verification ? "text-xs text-amber-700 dark:text-amber-400" : "text-xs text-muted-foreground"}>Imported is {money(Math.abs(delta.material.delta))}/{delta.uom} {delta.material.delta >= 0 ? "more" : "less"}{delta.needs_verification ? " — check the price" : ""}</p>}
                  {!fits && <p className="text-xs text-destructive">{shown.uom} cannot be converted to {p.uom}</p>}
                  {!readOnly && candidates.length > 1 && (
                    <select aria-label={`Match for ${p.description}`} className={`${select} mt-1 w-full`} value={candKey(shown)} onChange={(e) => { const c = candidates.find((x) => candKey(x) === e.target.value); if (c) choose(r, { ...d, action: d.action === "skip" ? "skip" : "keep_imported", candidate: c }); }}>
                      {candidates.map((c) => <option key={candKey(c)} value={candKey(c)}>{candidateLabel(c, p.uom)}</option>)}
                    </select>
                  )}
                </>
              )}
            </td>
            <td className="min-w-44 p-2">
              {!readOnly && (
                <div className="flex flex-col gap-1">
                  {shown && (
                    <>
                      <Button size="sm" variant={linked && !d.keepPrice ? "secondary" : "outline"} disabled={busy || !fits} onClick={() => use(r, shown, false)}>Use catalogue</Button>
                      <Button size="sm" variant={linked && d.keepPrice ? "secondary" : "outline"} disabled={busy || !fits} onClick={() => use(r, shown, true)}>Catalogue item, imported price</Button>
                    </>
                  )}
                  <Button size="sm" variant={d.action === "keep_imported" ? "secondary" : "outline"} onClick={() => choose(r, { action: "keep_imported", ...(d.candidate ? { candidate: d.candidate } : {}) })}>Keep as imported</Button>
                  {canCatalogue && <Button size="sm" variant="outline" onClick={() => onNew(r.id)}>New catalogue product</Button>}
                </div>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
