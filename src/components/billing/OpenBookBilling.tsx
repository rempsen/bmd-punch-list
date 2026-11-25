import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BillList, type Bill } from "@/components/billing/BillList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { releaseTotals } from "@/lib/billing/calc";
import { addLabour, addMaterial, removeLabour, removeMaterial, saveOpenBookTerms, useApprovedHours, useJobDocuments, useMaterialVendors, useOpenBookEntries, useOpenBookTerms, useBillPermission, type ApprovedHours } from "@/lib/billing/data";
import { buildOpenBookBill, checkLabourEntry, checkMaterialEntry, labourAmountCents, materialLine, openBookPosition, parseHours, toCents, type NamedRate, type Terms } from "@/lib/billing/openBook";
import { billDate, renderBillPdf } from "@/lib/billing/pdf";
import { useTaxSettings } from "@/lib/catalogue/data";
import { dollars } from "@/lib/estimating/data";
import { db, errText } from "@/lib/platform/db";

const field = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
const label = "block text-xs font-medium";
const rateText = (cents: number) => `${dollars(cents)}/h`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Winnipeg" });

/** Billing for an open-book job: the agreed terms, labour and supplier invoices waiting to be billed, and the bills made from them. */
export function OpenBookBilling({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const canSee = canAny("view_pricing");
  const { data: canBill = false } = useBillPermission(projectId);
  const canSetTerms = canSee && canAny("manage_projects");
  const qc = useQueryClient();
  const { data: tax } = useTaxSettings(canSee);
  const { data: terms, error: termsError } = useOpenBookTerms(projectId, canSee);
  const { data: entries, error: entriesError } = useOpenBookEntries(projectId, canSee);
  const { data: bills, error: billsError } = useQuery({
    queryKey: ["bills", projectId, "open-book"],
    enabled: canSee,
    queryFn: async () => {
      const { data, error: e } = await db.from("progress_bills").select("id,number,kind,period_note,lines,gross_cents,holdback_pct,holdback_cents,net_cents,gst_cents,total_cents,status,issued_at,created_at,open_book,bill_date,due_date,terms,client_notes,internal_notes,bill_type,gst_pct").eq("project_id", projectId).order("seq");
      if (e) throw e;
      return ((data ?? []) as Bill[]).map((b) => ({ ...b, holdback_pct: Number(b.holdback_pct) }));
    },
  });
  const { data: project } = useQuery({
    queryKey: ["bill-project", projectId],
    enabled: canSee,
    queryFn: async () => {
      const { data } = await db.from("projects").select("name,project_number,address,holdback_pct,client:clients(name,billing_address)").eq("id", projectId).maybeSingle();
      return data as { name: string; project_number: string | null; address: string | null; holdback_pct: number; client: { name: string; billing_address: string | null } | null } | null;
    },
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<"labour" | "material" | "hours" | null>(null);

  if (!canSee) return <p className="text-sm text-muted-foreground">You don't have access to billing on this project.</p>;
  const error = termsError ?? entriesError ?? billsError;
  if (error) return <p className="text-sm text-destructive">Could not load billing: {errText(error)}</p>;
  if (!tax || !project || !terms || !entries || !bills) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const jobHoldbackPct = Number(project.holdback_pct);
  const pos = openBookPosition(bills, entries.labour, entries.materials, terms);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bills", projectId] });
    void qc.invalidateQueries({ queryKey: ["open-book-entries", projectId] });
    void qc.invalidateQueries({ queryKey: ["open-book-approved-hours", projectId] });
    void qc.invalidateQueries({ queryKey: ["open-book-jobs"] });
  };
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, done: string) => {
    setBusy(true);
    try {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
      toast.success(done);
      refresh();
      return true;
    } catch (e) {
      toast.error(errText(e).includes("open_book_materials_invoice_once") ? "That supplier invoice is already entered on this job." : errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openLabour = entries.labour.filter((l) => !l.billId);
  const openMaterials = entries.materials.filter((m) => !m.billId);
  const billedLabour = entries.labour.filter((l) => l.billId);
  const billedMaterials = entries.materials.filter((m) => m.billId);
  const billNumber = (id: string | null) => bills.find((b) => b.id === id)?.number ?? "a bill";
  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const pickedLabour = openLabour.filter((l) => picked.has(l.id));
  const pickedMaterials = openMaterials.filter((m) => picked.has(m.id));
  const anyPicked = pickedLabour.length + pickedMaterials.length > 0;
  const draft = buildOpenBookBill(pickedLabour, pickedMaterials, terms, { holdbackPct: jobHoldbackPct, gstPct: tax.gst_pct });
  const allOpen = [...openLabour, ...openMaterials].map((e) => e.id);

  const pdf = (b: Bill) => {
    const upTo = bills.filter((x) => x.kind === "progress" && x.status !== "void" && x.created_at <= b.created_at).reduce((s, x) => s + x.gross_cents, 0);
    renderBillPdf(b, { project: { name: project.name, number: project.project_number, address: project.address }, client: { name: project.client?.name ?? "", address: project.client?.billing_address ?? null }, gstPct: tax.gst_pct, position: { contractCents: 0, billedCents: upTo } }).save(`${b.number} - ${project.name.replace(/[\\/:*?"<>|]+/g, " ")}.pdf`);
  };
  const release = () => {
    const t = releaseTotals(pos.holdbackOwingCents, tax.gst_pct);
    if (!window.confirm(`Create a draft bill releasing ${dollars(pos.holdbackOwingCents)} of holdback (${dollars(t.totalCents)} with GST)?`)) return;
    void run(() => db.rpc("create_progress_bill", { _project: projectId, _kind: "holdback_release", _lines: [{ description: "Release of holdback", amountCents: pos.holdbackOwingCents }], _period_note: null }), "Draft holdback bill created. Check it, then issue it.");
  };

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 lg:grid-cols-4">
        {(
          [
            ["Billed to date", pos.billedCents, null],
            ["Unbilled labour", pos.unbilledLabourCents, null],
            ["Unbilled materials, with markup", pos.unbilledMaterialsCents, pos.markupUnknown ? "Markup not set yet" : null],
            ["Holdback held", pos.holdbackOwingCents, null],
          ] as const
        ).map(([name, cents, warn]) => (
          <div key={name}>
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="text-lg font-semibold tabular-nums">{dollars(cents)}</dd>
            {warn && <dd className="text-xs text-amber-800">{warn}</dd>}
          </div>
        ))}
        <p className="col-span-full text-xs text-muted-foreground">Before GST. This is an open-book job: it is billed from hours worked and supplier invoices, not against a quote.</p>
      </dl>

      <TermsPanel projectId={projectId} terms={terms} jobHoldbackPct={jobHoldbackPct} canEdit={canSetTerms} />

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Labour to bill</h3>
          {canBill && (
            <div className="flex flex-wrap gap-2">
              <ApprovedHoursButton projectId={projectId} enabled={canBill} onOpen={() => setAdding("hours")} />
              <Button variant="outline" onClick={() => setAdding(adding === "labour" ? null : "labour")}>Add labour</Button>
            </div>
          )}
        </div>
        {adding === "labour" && <LabourForm terms={terms} busy={busy} onCancel={() => setAdding(null)} onSave={(w) => void run(() => addLabour(projectId, [w]), "Labour added.").then((ok) => ok && setAdding(null))} />}
        {adding === "hours" && <ApprovedHoursForm projectId={projectId} terms={terms} busy={busy} onCancel={() => setAdding(null)} onSave={(rows) => void run(() => addLabour(projectId, rows), `${rows.length} labour ${rows.length === 1 ? "line" : "lines"} added.`).then((ok) => ok && setAdding(null))} />}
        {openLabour.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{entries.labour.length === 0 ? "No labour yet. Add a line for the work done: what it was, the hours and the rate." : "All labour entered so far is on a bill."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {openLabour.map((l) => (
              <li key={l.id} className="flex items-start gap-3 py-2">
                {canBill && <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Put "${l.description}" on the bill`} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{l.description}</p>
                  <p className="text-xs text-muted-foreground">{billDate(l.workDate, l.workDateEnd)} · {l.hours} h × {rateText(l.rateCents)}{l.rateName ? ` (${l.rateName})` : ""}</p>
                </div>
                <p className="text-sm tabular-nums">{dollars(labourAmountCents(l.hours, l.rateCents))}</p>
                {canBill && <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Remove "${l.description}"?`) && void run(() => removeLabour(l.id), "Labour removed.")}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
        {billedLabour.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer py-2 text-xs text-muted-foreground">On a bill ({billedLabour.length}): locked</summary>
            <ul className="divide-y divide-border">
              {billedLabour.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-1.5 text-muted-foreground">
                  <span className="min-w-0 truncate">{l.description} · {l.hours} h × {rateText(l.rateCents)}</span>
                  <span className="shrink-0 tabular-nums">{dollars(labourAmountCents(l.hours, l.rateCents))} · {billNumber(l.billId)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Material invoices to bill</h3>
          {canBill && <Button variant="outline" onClick={() => setAdding(adding === "material" ? null : "material")}>Add supplier invoice</Button>}
        </div>
        {adding === "material" && <MaterialForm projectId={projectId} terms={terms} busy={busy} onCancel={() => setAdding(null)} onSave={(w) => void run(() => addMaterial(projectId, w), "Supplier invoice added.").then((ok) => ok && setAdding(null))} />}
        {openMaterials.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">{entries.materials.length === 0 ? "No supplier invoices yet. Add each invoice for materials bought for this job." : "All supplier invoices entered so far are on a bill."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {openMaterials.map((m) => {
              const line = materialLine(m, terms);
              return (
                <li key={m.id} className="flex items-start gap-3 py-2">
                  {canBill && <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={picked.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Put ${m.supplierName} invoice ${m.invoiceNumber} on the bill`} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{m.supplierName} · invoice {m.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {billDate(m.invoiceDate)} · {dollars(m.amountCents)} {line ? `+ ${line.markupPct}% markup ${dollars(line.markupCents)}` : "· markup not set yet"}
                      {m.attachmentName ? ` · Copy: ${m.attachmentName}` : ""}
                    </p>
                    {m.markupPct != null && (
                      <p className="text-xs text-amber-800">
                        Markup changed for this invoice{terms.markupPct != null ? ` (the job's is ${terms.markupPct}%)` : ""}{m.markupNote ? `: ${m.markupNote}` : ""}
                      </p>
                    )}
                  </div>
                  <p className="text-sm tabular-nums">{line ? dollars(line.totalCents) : "Unknown"}</p>
                  {canBill && <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Remove ${m.supplierName} invoice ${m.invoiceNumber}?`) && void run(() => removeMaterial(m.id), "Supplier invoice removed.")}>Remove</Button>}
                </li>
              );
            })}
          </ul>
        )}
        {billedMaterials.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer py-2 text-xs text-muted-foreground">On a bill ({billedMaterials.length}): locked</summary>
            <ul className="divide-y divide-border">
              {billedMaterials.map((m) => (
                <li key={m.id} className="flex justify-between gap-3 py-1.5 text-muted-foreground">
                  <span className="min-w-0 truncate">{m.supplierName} · invoice {m.invoiceNumber}</span>
                  <span className="shrink-0 tabular-nums">{dollars(m.amountCents)} · {billNumber(m.billId)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {canBill && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Create bill</h3>
            {allOpen.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setPicked(picked.size >= allOpen.length ? new Set() : new Set(allOpen))}>
                {picked.size >= allOpen.length ? "Untick all" : "Tick everything unbilled"}
              </Button>
            )}
          </div>
          {!anyPicked ? (
            <p className="text-sm text-muted-foreground">{allOpen.length === 0 ? "There is nothing waiting to be billed." : "Tick the labour and supplier invoices above to put on this bill."}</p>
          ) : "problem" in draft ? (
            <p role="alert" className="text-sm text-amber-800">{draft.problem}</p>
          ) : (
            <>
              <dl className="ml-auto max-w-xs text-sm">
                {draft.lines.map((l) => (
                  <div key={l.description} className="flex justify-between"><dt>{l.description}</dt><dd className="tabular-nums">{dollars(l.amountCents)}</dd></div>
                ))}
                <div className="flex justify-between border-t border-border pt-1"><dt>This bill</dt><dd className="tabular-nums">{dollars(draft.totals.grossCents)}</dd></div>
                {draft.holdbackPct > 0 && <div className="flex justify-between"><dt>Less {draft.holdbackPct}% holdback</dt><dd className="tabular-nums">({dollars(draft.totals.holdbackCents)})</dd></div>}
                <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{dollars(draft.totals.netCents)}</dd></div>
                <div className="flex justify-between"><dt>GST {tax.gst_pct}%</dt><dd className="tabular-nums">{dollars(draft.totals.gstCents)}</dd></div>
                <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>Amount due</dt><dd className="tabular-nums">{dollars(draft.totals.totalCents)}</dd></div>
              </dl>
              <label className={label}>
                Note on the invoice (optional)
                <Input className="mt-1 h-11" placeholder="e.g. Work to November 30" value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <Button
                className="h-11"
                disabled={busy}
                onClick={() =>
                  void run(() => db.rpc("create_open_book_bill", { _project: projectId, _labour: pickedLabour.map((l) => l.id), _materials: pickedMaterials.map((m) => m.id), _period_note: note }), "Draft bill created. Check it, then issue it.").then((ok) => {
                    if (ok) { setPicked(new Set()); setNote(""); }
                  })
                }
              >
                Create draft bill
              </Button>
            </>
          )}
          {pos.holdbackOwingCents > 0 && (
            <div className="border-t border-border pt-3">
              <Button variant="outline" disabled={busy} onClick={release}>Release holdback ({dollars(pos.holdbackOwingCents)})</Button>
            </div>
          )}
        </section>
      )}

      {bills.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing has been billed yet.</p>
      ) : (
        <BillList
          bills={bills}
          projectId={projectId}
          canBill={canBill}
          busy={busy}
          onPdf={pdf}
          onStatus={(b, to) => void run(() => db.rpc("set_progress_bill_status", { _id: b.id, _to: to }), to === "issued" ? `${b.number} issued.` : to === "void" ? `${b.number} voided. Its labour and invoices can be billed again.` : "Draft deleted. Its labour and invoices can be billed again.")}
        />
      )}
      <p className="text-xs text-muted-foreground">Bills are entered in QuickBooks by hand for now. Each bill above lists the figures to enter: labour, materials at supplier invoice, and the markup. The invoice PDF carries the detail.</p>
    </div>
  );
}

function TermsPanel({ projectId, terms, jobHoldbackPct, canEdit }: { projectId: string; terms: Terms; jobHoldbackPct: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = () => ({ markup: terms.markupPct == null ? "" : String(terms.markupPct), rate: terms.labourRateCents == null ? "" : (terms.labourRateCents / 100).toFixed(2), named: terms.namedRates.map((r) => ({ name: r.name, rate: (r.rateCents / 100).toFixed(2) })), holdback: terms.holdbackApplies });
  const [f, setF] = useState(blank);
  const save = async () => {
    const markup = f.markup.trim() === "" ? null : Number(f.markup);
    if (markup != null && (!Number.isFinite(markup) || markup < 0 || markup > 100)) return void toast.error("Markup must be between 0 and 100 percent.");
    const rate = f.rate.trim() === "" ? null : toCents(f.rate);
    if (rate != null && !(rate > 0)) return void toast.error("Enter the hourly rate as a dollar amount.");
    const named: NamedRate[] = [];
    for (const r of f.named) {
      if (!r.name.trim() && !r.rate.trim()) continue;
      if (!r.name.trim() || !(toCents(r.rate) > 0)) return void toast.error("Give each named rate a name and an hourly rate.");
      named.push({ name: r.name.trim(), rateCents: toCents(r.rate) });
    }
    setBusy(true);
    const { error } = await saveOpenBookTerms(projectId, { markupPct: markup, labourRateCents: rate, namedRates: named, holdbackApplies: f.holdback });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Terms saved. They apply to bills made from now on.");
    setEditing(false);
    void qc.invalidateQueries({ queryKey: ["open-book-terms", projectId] });
  };
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-semibold">Open-book terms</h3>
        {canEdit && !editing && <Button variant="outline" onClick={() => { setF(blank()); setEditing(true); }}>Change</Button>}
      </div>
      {!editing ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Materials markup</dt>
            <dd className={terms.markupPct == null ? "text-amber-800" : ""}>{terms.markupPct == null ? "Not set yet" : `${terms.markupPct}% on supplier invoices`}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Labour</dt>
            <dd>{terms.labourRateCents == null && terms.namedRates.length === 0 ? "No rate set: type one on each line" : [terms.labourRateCents != null ? rateText(terms.labourRateCents) : null, ...terms.namedRates.map((r) => `${r.name} ${rateText(r.rateCents)}`)].filter(Boolean).join(" · ")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Holdback</dt>
            <dd>{terms.holdbackApplies && jobHoldbackPct > 0 ? `${jobHoldbackPct}% held back on each bill` : "No holdback on this job"}</dd>
          </div>
        </dl>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Materials markup (%)
              <input className={`${field} mt-1`} inputMode="decimal" placeholder="e.g. 15" value={f.markup} onChange={(e) => setF({ ...f, markup: e.target.value })} />
            </label>
            <label className={label}>
              Hourly billing rate for this job ($)
              <input className={`${field} mt-1`} inputMode="decimal" placeholder="e.g. 85.00" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
            </label>
          </div>
          <div>
            <p className={label}>Named rates (optional)</p>
            {f.named.map((r, i) => (
              <div key={i} className="mt-1 flex gap-2">
                <input className={field} placeholder="e.g. Installer" aria-label={`Name of rate ${i + 1}`} value={r.name} onChange={(e) => setF({ ...f, named: f.named.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input className={`${field} w-28 shrink-0 text-right`} inputMode="decimal" placeholder="$ an hour" aria-label={`Hourly rate ${i + 1}`} value={r.rate} onChange={(e) => setF({ ...f, named: f.named.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} />
                <Button type="button" variant="ghost" className="h-11" onClick={() => setF({ ...f, named: f.named.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setF({ ...f, named: [...f.named, { name: "", rate: "" }] })}>Add a named rate</Button>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-6 w-6" checked={f.holdback} onChange={(e) => setF({ ...f, holdback: e.target.checked })} />
            Hold back {jobHoldbackPct}% on each bill, released later on its own invoice
          </label>
          <div className="flex gap-2">
            <Button className="h-11" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save terms"}</Button>
            <Button className="h-11" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The job's rates as choices, plus "Other" to type one. */
function RatePicker({ terms, rate, setRate, rateName, setRateName }: { terms: Terms; rate: string; setRate: (s: string) => void; rateName: string | null; setRateName: (s: string | null) => void }) {
  const choices: (NamedRate & { key: string })[] = [...(terms.labourRateCents != null ? [{ key: "job", name: "Job rate", rateCents: terms.labourRateCents }] : []), ...terms.namedRates.map((r, i) => ({ key: `n${i}`, ...r }))];
  const current = choices.find((c) => (c.key === "job" ? rateName == null : c.name === rateName) && (c.rateCents / 100).toFixed(2) === rate)?.key ?? "other";
  return (
    <>
      {choices.length > 0 && (
        <label className={label}>
          Rate
          <select
            className={`${field} mt-1`}
            value={current}
            onChange={(e) => {
              const c = choices.find((x) => x.key === e.target.value);
              setRateName(c && c.key !== "job" ? c.name : null);
              setRate(c ? (c.rateCents / 100).toFixed(2) : "");
            }}
          >
            {choices.map((c) => (
              <option key={c.key} value={c.key}>{c.name} · {rateText(c.rateCents)}</option>
            ))}
            <option value="other">Other rate</option>
          </select>
        </label>
      )}
      {(choices.length === 0 || current === "other") && (
        <label className={label}>
          Hourly rate ($)
          <input className={`${field} mt-1 text-right`} inputMode="decimal" placeholder="0.00" value={rate} onChange={(e) => { setRateName(null); setRate(e.target.value); }} />
        </label>
      )}
    </>
  );
}
const firstRate = (terms: Terms) => (terms.labourRateCents != null ? { rate: (terms.labourRateCents / 100).toFixed(2), rateName: null } : terms.namedRates[0] ? { rate: (terms.namedRates[0].rateCents / 100).toFixed(2), rateName: terms.namedRates[0].name } : { rate: "", rateName: null });

type LabourSave = Parameters<typeof addLabour>[1][number];
function LabourForm({ terms, busy, onSave, onCancel }: { terms: Terms; busy: boolean; onSave: (w: LabourSave) => void; onCancel: () => void }) {
  const [f, setF] = useState(() => ({ description: "", workDate: today(), workDateEnd: "", hours: "", ...firstRate(terms) }) as { description: string; workDate: string; workDateEnd: string; hours: string; rate: string; rateName: string | null });
  const [tried, setTried] = useState(false);
  const problem = checkLabourEntry(f);
  const hours = parseHours(f.hours);
  return (
    <form
      className="mb-3 space-y-3 rounded-md border border-border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!problem && hours != null) onSave({ description: f.description, workDate: f.workDate, workDateEnd: f.workDateEnd || null, hours, rateCents: toCents(f.rate), rateName: f.rateName });
      }}
    >
      <label className={label}>
        Description of the work
        <input className={`${field} mt-1`} placeholder="e.g. Remove carpet and prep floor, level 2 corridor" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={label}>
          Date
          <input type="date" className={`${field} mt-1`} value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} />
        </label>
        <label className={label}>
          Last day (if more than one)
          <input type="date" className={`${field} mt-1`} value={f.workDateEnd} onChange={(e) => setF({ ...f, workDateEnd: e.target.value })} />
        </label>
        <label className={label}>
          Hours
          <input className={`${field} mt-1 text-right`} inputMode="decimal" placeholder="e.g. 7.5" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
        </label>
        <RatePicker terms={terms} rate={f.rate} setRate={(rate) => setF((c) => ({ ...c, rate }))} rateName={f.rateName} setRateName={(rateName) => setF((c) => ({ ...c, rateName }))} />
      </div>
      <p className="text-sm">Amount: <strong className="tabular-nums">{hours != null && toCents(f.rate) > 0 ? dollars(labourAmountCents(hours, toCents(f.rate))) : "—"}</strong></p>
      {tried && problem && <p role="alert" className="text-sm text-amber-800">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="h-11" disabled={busy}>Add labour</Button>
        <Button type="button" className="h-11" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

type MaterialSave = Parameters<typeof addMaterial>[1];
function MaterialForm({ projectId, terms, busy, onSave, onCancel }: { projectId: string; terms: Terms; busy: boolean; onSave: (w: MaterialSave) => void; onCancel: () => void }) {
  const { data: vendors = [] } = useMaterialVendors(true);
  const { data: documents = [] } = useJobDocuments(projectId, true);
  const [f, setF] = useState({ supplierName: "", invoiceNumber: "", invoiceDate: today(), amount: "", markupPct: "", markupNote: "", documentId: "" });
  const [own, setOwn] = useState(false);
  const [tried, setTried] = useState(false);
  const input = { ...f, markupPct: own ? f.markupPct : "" };
  const problem = checkMaterialEntry(input) ?? (own && f.markupPct.trim() === "" ? "Enter the markup for this invoice, or untick the box to use the job's." : null);
  const pct = own && f.markupPct.trim() !== "" ? Number(f.markupPct) : terms.markupPct;
  const cents = toCents(f.amount);
  const preview = cents > 0 && pct != null && Number.isFinite(pct) ? materialLine({ id: "", supplierName: "", invoiceNumber: "", invoiceDate: "", amountCents: cents, markupPct: pct, markupNote: null, attachmentName: null, billId: null }, terms) : null;
  return (
    <form
      className="mb-3 space-y-3 rounded-md border border-border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (problem) return;
        const vendor = vendors.find((v) => v.name.toLowerCase() === f.supplierName.trim().toLowerCase());
        onSave({ supplierId: vendor?.id ?? null, supplierName: vendor?.name ?? f.supplierName, invoiceNumber: f.invoiceNumber, invoiceDate: f.invoiceDate, amountCents: cents, markupPct: own ? Number(f.markupPct) : null, markupNote: own ? f.markupNote : null, documentId: f.documentId || null });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Supplier
          <input className={`${field} mt-1`} list="open-book-vendors" placeholder="Pick from the catalogue or type" value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} />
          <datalist id="open-book-vendors">
            {vendors.map((v) => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
        </label>
        <label className={label}>
          Supplier's invoice number
          <input className={`${field} mt-1`} value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} />
        </label>
        <label className={label}>
          Invoice date
          <input type="date" className={`${field} mt-1`} value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} />
        </label>
        <label className={label}>
          Amount before GST, as invoiced to us ($)
          <input className={`${field} mt-1 text-right`} inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </label>
      </div>
      <label className={label}>
        Copy of the invoice (optional)
        <select className={`${field} mt-1`} value={f.documentId} onChange={(e) => setF({ ...f, documentId: e.target.value })}>
          <option value="">{documents.length === 0 ? "No files in this job's Documents yet" : "None"}</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>{d.file_name}</option>
          ))}
        </select>
        <span className="mt-1 block font-normal text-muted-foreground">Choose from files already in this job's Documents. To add a copy, upload it on the Documents tab first.</span>
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="h-6 w-6" checked={own} onChange={(e) => setOwn(e.target.checked)} />
        Use a different markup for this invoice{terms.markupPct != null ? ` (the job's is ${terms.markupPct}%)` : ""}
      </label>
      {own && (
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <label className={label}>
            Markup (%)
            <input className={`${field} mt-1 text-right`} inputMode="decimal" value={f.markupPct} onChange={(e) => setF({ ...f, markupPct: e.target.value })} />
          </label>
          <label className={label}>
            Why (office note, not shown to the client)
            <input className={`${field} mt-1`} placeholder="e.g. Agreed 10% on adhesive" value={f.markupNote} onChange={(e) => setF({ ...f, markupNote: e.target.value })} />
          </label>
        </div>
      )}
      <p className="text-sm">
        {preview ? <>Billed at <strong className="tabular-nums">{dollars(preview.totalCents)}</strong> ({dollars(preview.invoiceCents)} + {preview.markupPct}% markup {dollars(preview.markupCents)})</> : pct == null ? <span className="text-amber-800">The job's markup is not set yet. Set it in Open-book terms before billing this invoice.</span> : "Billed at —"}
      </p>
      {tried && problem && <p role="alert" className="text-sm text-amber-800">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="h-11" disabled={busy}>Add supplier invoice</Button>
        <Button type="button" className="h-11" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Shown only when a time clock provides approved hours for this job. */
function ApprovedHoursButton({ projectId, enabled, onOpen }: { projectId: string; enabled: boolean; onOpen: () => void }) {
  const { data } = useApprovedHours(projectId, enabled);
  if (!data) return null;
  return (
    <Button variant="outline" disabled={data.length === 0} title={data.length === 0 ? "No approved hours waiting for this job" : undefined} onClick={onOpen}>
      Add from approved hours{data.length > 0 ? ` (${data.length})` : ""}
    </Button>
  );
}

function ApprovedHoursForm({ projectId, terms, busy, onSave, onCancel }: { projectId: string; terms: Terms; busy: boolean; onSave: (rows: LabourSave[]) => void; onCancel: () => void }) {
  const { data: hours = [] } = useApprovedHours(projectId, true);
  const rows: ApprovedHours[] = hours ?? [];
  const [off, setOff] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [r, setR] = useState(() => firstRate(terms) as { rate: string; rateName: string | null });
  const chosen = rows.filter((h) => !off.has(h.id));
  const problem = !description.trim() ? "Describe the work." : !(toCents(r.rate) > 0) ? "Enter the hourly rate." : chosen.length === 0 ? "Tick at least one day." : null;
  const [tried, setTried] = useState(false);
  return (
    <form
      className="mb-3 space-y-3 rounded-md border border-border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!problem) onSave(chosen.map((h) => ({ description: `${description.trim()} · ${h.person}`, workDate: h.date, workDateEnd: null, hours: h.hours, rateCents: toCents(r.rate), rateName: r.rateName, sourceRef: `time:${h.id}` })));
      }}
    >
      <p className="text-sm font-medium">Approved hours not yet on this job's labour</p>
      <ul className="divide-y divide-border">
        {rows.map((h) => (
          <li key={h.id}>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="h-6 w-6" checked={!off.has(h.id)} onChange={() => setOff((cur) => { const next = new Set(cur); if (next.has(h.id)) next.delete(h.id); else next.add(h.id); return next; })} />
              <span className="flex-1">{h.person} · {billDate(h.date)}</span>
              <span className="tabular-nums">{h.hours} h</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Description of the work
          <input className={`${field} mt-1`} placeholder="e.g. Install LVT, level 2" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <RatePicker terms={terms} rate={r.rate} setRate={(rate) => setR((c) => ({ ...c, rate }))} rateName={r.rateName} setRateName={(rateName) => setR((c) => ({ ...c, rateName }))} />
      </div>
      {tried && problem && <p role="alert" className="text-sm text-amber-800">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="h-11" disabled={busy}>Add {chosen.length} to labour</Button>
        <Button type="button" className="h-11" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
