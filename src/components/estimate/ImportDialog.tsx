import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dollars, saveLines, type EstVersion } from "@/lib/estimating/data";
import { importRowToSaveItem, parseGraberQuote, parseProcoreEstimate, reconcile, type ImportRow } from "@/lib/estimating/import";
import { db, errText } from "@/lib/platform/db";

type Parsed = { kind: "procore" | "graber"; fileName: string; rows: ImportRow[]; skipped: string[]; sourceCents: number; sourceLabel: string; sourceTotals: Record<string, number | null> };

async function parseFile(file: File): Promise<Parsed> {
  const buf = await file.arrayBuffer();
  if (/\.xlsx?$/i.test(file.name)) {
    const XLSX = await import("xlsx");
    const r = parseProcoreEstimate(XLSX.read(buf), XLSX.utils);
    return { kind: "procore", fileName: file.name, rows: r.rows, skipped: r.skipped, sourceCents: r.sourceTotals.preTaxCents, sourceLabel: "Workbook total before tax", sourceTotals: r.sourceTotals };
  }
  if (/\.pdf$/i.test(file.name)) {
    const { pdfTextLines } = await import("@/lib/estimating/pdf-text");
    const r = parseGraberQuote(await pdfTextLines(buf));
    if (r.rows.length === 0) throw new Error("No priced lines were found. This reads Graber quotation PDFs with selectable text; a scan or another supplier's layout has to be entered by hand.");
    return { kind: "graber", fileName: file.name, rows: r.rows, skipped: r.skipped, sourceCents: r.sourceTotals.subtotalCents, sourceLabel: "Quotation subtotal", sourceTotals: r.sourceTotals };
  }
  throw new Error("Choose a Procore estimate workbook (.xlsx) or a Graber quotation (.pdf).");
}

/** Brings prices prepared elsewhere into the open price, after staff check them against the source. */
export function ImportDialog({ version, onClose, onDone }: { version: EstVersion; onClose: () => void; onDone: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const chosen = useMemo(() => parsed?.rows.filter((r) => !off.has(r.sourceRef)) ?? [], [parsed, off]);
  const rec = parsed ? reconcile(chosen, parsed.sourceCents) : null;
  const unknown = chosen.filter((r) => r.materialCostCents == null || r.labourCostCents == null).length;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const next = await parseFile(file);
      setParsed(next);
      // A row with no selling price in the file is left out unless someone ticks it on purpose.
      setOff(new Set(next.rows.filter((r) => /Selling price is missing/.test(r.issue ?? "")).map((r) => r.sourceRef)));
      setAck(false);
    } catch (e) {
      setParsed(null);
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!parsed || !rec) return;
    setBusy(true);
    try {
      const start = version.lines.reduce((m, l) => Math.max(m, l.sort_order), 0);
      const items = chosen.map((r, i) => importRowToSaveItem(r, version.id, parsed.fileName, start + i + 1));
      await saveLines(items);
      // The record of the import is kept for reference; the lines are already saved, so a failure here is reported, not fatal.
      const { data, error: e1 } = await db.from("estimate_imports").insert({ project_id: version.project_id, version_id: version.id, kind: parsed.kind, file_name: parsed.fileName, source_totals: parsed.sourceTotals, reconciliation: { ...rec, skipped: parsed.skipped } }).select("id").single();
      const id = (data as { id: string } | null)?.id;
      const e2 = id ? (await db.from("estimate_import_rows").insert(parsed.rows.map((r) => ({ import_id: id, source_ref: r.sourceRef, raw: r, proposed: off.has(r.sourceRef) ? null : (items[chosen.indexOf(r)]?.line ?? null), issue: r.issue, decision: off.has(r.sourceRef) ? "left_out" : "imported" })))).error : null;
      if (e1 || e2) toast.warning(`Lines added, but the import record could not be saved: ${(e1 ?? e2)!.message}`);
      else toast.success(`${items.length} lines imported at their source prices.`);
      onDone();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Import prices into {version.name}</DialogTitle>
          <DialogDescription>
            Reads a Procore estimate workbook (.xlsx) or a Graber quotation (.pdf). Selling prices come in exactly as written: no markup, waste or tax is added on top. Costs the file does not state stay unknown until you enter them.
          </DialogDescription>
        </DialogHeader>
        <label className="block text-sm font-medium">
          File
          <input type="file" accept=".xlsx,.xls,.pdf" disabled={busy} className="mt-1 block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-input file:bg-background file:px-3" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {parsed && rec && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            <dl className="grid grid-cols-3 gap-3 rounded-md border border-border p-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{parsed.sourceLabel}</dt>
                <dd className="font-semibold tabular-nums">{dollars(rec.sourceCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{chosen.length} lines ticked</dt>
                <dd className="font-semibold tabular-nums">{dollars(rec.linesCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Difference</dt>
                <dd className={`font-semibold tabular-nums ${Math.abs(rec.differenceCents) > 100 ? "text-amber-700" : ""}`}>{dollars(rec.differenceCents)}</dd>
              </div>
              <p className="col-span-3 text-xs text-muted-foreground">
                {Math.abs(rec.differenceCents) <= 100 ? "The ticked lines match the source total (cents differ only by rounding each line)." : "The ticked lines do not add up to the source total. Check what is unticked before importing."}
                {parsed.sourceTotals["sourceTaxCents"] != null && ` The file's own tax (${dollars(parsed.sourceTotals["sourceTaxCents"]!)}) is not imported; the quote applies GST.`}
                {parsed.sourceTotals["taxCents"] != null && ` The file's own tax (${dollars(parsed.sourceTotals["taxCents"]!)}) is not imported; the quote applies GST.`}
              </p>
            </dl>
            {unknown > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{unknown} lines have a cost the file does not state. They import with that cost unknown, and the quote cannot be sent until each is entered or marked not needed.</p>}
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 py-1"><span className="sr-only">Import</span></th>
                  <th>Source</th>
                  <th>Section / line</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Sell</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parsed.rows.map((r) => (
                  <tr key={r.sourceRef} className={off.has(r.sourceRef) ? "opacity-50" : ""}>
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`Import ${r.description}`}
                        checked={!off.has(r.sourceRef)}
                        onChange={(e) => {
                          const next = new Set(off);
                          if (e.target.checked) next.delete(r.sourceRef);
                          else next.add(r.sourceRef);
                          setOff(next);
                        }}
                      />
                    </td>
                    <td className="whitespace-nowrap pr-2 text-xs text-muted-foreground">{r.sourceRef}</td>
                    <td>
                      <span className="text-xs text-muted-foreground">{r.section} · </span>
                      {r.description}
                      {r.issue && <span className="block text-xs font-medium text-amber-700">{r.issue}</span>}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {r.qty.toLocaleString("en-CA", { maximumFractionDigits: 2 })} {r.uom}
                    </td>
                    <td className="text-right tabular-nums">{r.materialCostCents == null || r.labourCostCents == null ? <span className="text-amber-700">unknown</span> : dollars(r.materialCostCents + r.labourCostCents)}</td>
                    <td className="text-right tabular-nums">{dollars(r.sellCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.skipped.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{parsed.skipped.length} rows in the file were not treated as chargeable lines</summary>
                <ul className="mt-1 list-disc pl-5">
                  {parsed.skipped.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {rec && Math.abs(rec.differenceCents) > 100 && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Import even though the lines differ from the source total by {dollars(rec.differenceCents)}
            </label>
          )}
          <Button disabled={busy || chosen.length === 0 || (!!rec && Math.abs(rec.differenceCents) > 100 && !ack)} onClick={() => void apply()}>
            {busy ? "Working…" : `Import ${chosen.length} lines`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
