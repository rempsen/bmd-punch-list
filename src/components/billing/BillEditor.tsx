import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Bill } from "./BillList";
import { billingPosition } from "@/lib/billing/calc";
import { BILL_TYPES, editorTotals, lineAmount, mayEditBill, progressHelper, requiresOverbillConfirmation, setLineAmount, shapeBillLine, validateBill, type BillLine, type BillType } from "@/lib/billing/editor";
import { useTaxSettings } from "@/lib/catalogue/data";
import { dollars } from "@/lib/estimating/data";
import { db, errText } from "@/lib/platform/db";
import { useQuotes } from "@/lib/quotes/data";
import { contractValue } from "@/lib/quotes/logic";

export function BillEditor({ bill, bills, projectId, onPdf, onClose }: { bill: Bill; bills: Bill[]; projectId: string; onPdf: (bill: Bill) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(bill);
  const [lines, setLines] = useState<BillLine[]>(bill.lines.map(shapeBillLine));
  const [description, setDescription] = useState(bill.period_note ?? "");
  const [type, setType] = useState<BillType>(bill.kind === "holdback_release" ? "holdback" : bill.bill_type ?? "progress");
  const [date, setDate] = useState(bill.bill_date ?? (bill.issued_at ?? bill.created_at).slice(0, 10));
  const [due, setDue] = useState(bill.due_date ?? "");
  const [terms, setTerms] = useState(bill.terms ?? "");
  const [holdback, setHoldback] = useState(Number(bill.holdback_pct));
  const [clientNotes, setClientNotes] = useState(bill.client_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(bill.internal_notes ?? "");
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data: permissions } = useQuery({ queryKey: ["bill-permissions", projectId], queryFn: async () => {
    const [manage, price] = await Promise.all([db.rpc("has_capability", { _capability: "manage_projects", _project: projectId }), db.rpc("has_capability", { _capability: "view_pricing", _project: projectId })]);
    return mayEditBill(manage.data === true && !manage.error, price.data === true && !price.error);
  }});
  const { data: project } = useQuery({ queryKey: ["bill-editor-project", projectId], queryFn: async () => {
    const { data, error } = await db.from("projects").select("holdback_pct,contract_type").eq("id", projectId).single();
    if (error) throw error;
    return data as { holdback_pct: number; contract_type: string };
  }});
  const { data: tax } = useTaxSettings(true);
  const { data: quotes = [] } = useQuotes(projectId, true);
  const canManage = permissions === true;
  const editable = canManage && saved.status === "draft";
  const gst = saved.gst_pct ?? tax?.gst_pct ?? 5;
  const total = editable ? editorTotals(lines, saved.kind, holdback, tax?.gst_pct ?? gst) : { grossCents: saved.gross_cents, holdbackCents: saved.holdback_cents, netCents: saved.net_cents, gstCents: saved.gst_cents, totalCents: saved.total_cents };
  const contract = contractValue(quotes).currentCents;
  const position = billingPosition(contract, bills.filter(b => b.id !== saved.id));
  const patchLine = (i: number, patch: Partial<BillLine>) => setLines(cur => cur.map((l, n) => n === i ? { ...l, ...patch } : l));
  const move = (i: number, delta: number) => setLines(cur => {
    const next = [...cur]; const item = next[i]; const other = next[i + delta];
    if (!item || !other) return cur;
    next[i] = other; next[i + delta] = item; return next;
  });
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["bills", projectId] }), qc.invalidateQueries({ queryKey: ["pipeline-project", projectId, "events"] }), qc.invalidateQueries({ queryKey: ["open-book-entries", projectId] }), qc.invalidateQueries({ queryKey: ["open-book-jobs"] })]);
  };
  const save = async (issue = false, copy = false) => {
    const validation = validateBill(lines, date, due, holdback);
    if (validation) return setProblem(validation);
    const pos = copy ? billingPosition(contract, bills) : position;
    const t = editorTotals(lines, saved.kind, holdback, tax?.gst_pct ?? gst);
    const over = requiresOverbillConfirmation(t.netCents, pos.remainingCents, saved.kind, project?.contract_type === "open_book");
    if (over && !window.confirm(`Net ${dollars(t.netCents)} exceeds Left to bill (${dollars(Math.max(0, pos.remainingCents))}). Save this over-billing amount anyway?`)) return;
    if (copy && !over && !window.confirm(`Copy ${saved.number} to a new draft?`)) return;
    setBusy(true); setProblem(null);
    try {
      const { data: id, error } = await db.rpc("save_bill_draft", { _id: saved.id, _bill: { lines, period_note: description, bill_type: type, bill_date: date, due_date: due, terms, holdback_pct: holdback, client_notes: clientNotes, internal_notes: internalNotes }, _issue: issue, _copy: copy, _confirm_over: over });
      if (error) throw error;
      const { data: row, error: readError } = await db.from("progress_bills").select("*").eq("id", id).single();
      if (readError) throw readError;
      setSaved(row as Bill);
      await refresh();
      toast.success(copy ? "Copied to a new draft." : issue ? "Bill saved and issued." : "Draft saved.");
      if (copy) onClose();
    } catch (e) { setProblem(errText(e)); } finally { setBusy(false); }
  };
  const status = async (to: "void" | "deleted") => {
    if (!window.confirm(to === "void" ? `Void ${saved.number}? It stays on record.` : `Delete draft ${saved.number}? This cannot be undone.`)) return;
    setBusy(true);
    try { const { error } = await db.rpc("set_progress_bill_status", { _id: saved.id, _to: to }); if (error) throw error; await refresh(); onClose(); toast.success(to === "void" ? "Bill voided." : "Draft deleted."); }
    catch (e) { setProblem(errText(e)); } finally { setBusy(false); }
  };
  const pullMaterials = async () => {
    setBusy(true); setProblem(null);
    try {
      const { data, error } = await db.from("material_orders").select("description,quantity,unit,unit_cost_cents").eq("project_id", projectId).in("status", ["on_order", "received"]).order("created_at");
      if (error) throw error;
      const additions = (data ?? []).map((m: { description: string; quantity: number; unit: string; unit_cost_cents: number | null }) => shapeBillLine({ description: m.description, quantity: Number(m.quantity), unit: m.unit, unitPriceCents: m.unit_cost_cents ?? 0, amountCents: 0 }));
      if (!additions.length) toast.message("No on-order or received materials on this job.");
      else { setLines(cur => [...cur, ...additions]); toast.success(`${additions.length} materials added. Check their selling prices before saving.`); }
    } catch (e) { setProblem(errText(e)); } finally { setBusy(false); }
  };
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-5xl">
      <SheetHeader><SheetTitle>{editable ? "Bill editor" : "Bill details"} · {saved.number}</SheetTitle><SheetDescription>{BILL_TYPES[type]} · <span className="rounded bg-muted px-2 py-1 capitalize">{saved.status}</span></SheetDescription></SheetHeader>
      <fieldset disabled={!editable || busy} className="mt-6 min-w-0 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium">Kind<select aria-label="Bill kind" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={type} disabled={saved.kind === "holdback_release"} onChange={e => setType(e.target.value as BillType)}>{Object.entries(BILL_TYPES).filter(([k]) => saved.kind === "holdback_release" ? k === "holdback" : k !== "holdback").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs font-medium sm:col-span-2">Description<Input value={description} onChange={e => setDescription(e.target.value)} /></label>
          <label className="text-xs font-medium">Bill date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="text-xs font-medium">Due date<Input type="date" min={date} value={due} onChange={e => setDue(e.target.value)} /></label>
          <label className="text-xs font-medium">Terms<Input value={terms} onChange={e => setTerms(e.target.value)} /></label>
        </div>
        {editable && type === "progress" && project?.contract_type !== "open_book" && <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-medium">% complete this bill<Input className="w-32" type="number" min={0} max={100} value={pct} onChange={e => setPct(Number(e.target.value))} /></label><Button variant="outline" disabled={pct <= 0 || pct > 100 || contract <= 0} onClick={() => { if (!window.confirm("Replace the current lines with this percentage of the contract?")) return; setLines([progressHelper(contract, pct)]); }}>Apply percentage</Button><span className="text-xs text-muted-foreground">Contract {dollars(contract)}</span></div>}
        {editable && type === "materials" && <Button variant="outline" onClick={() => void pullMaterials()}>Pull from Materials</Button>}
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="pb-2">Description</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th className="text-right">Amount</th>{editable && <th />}</tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-b border-border"><td className="min-w-52 py-2 pr-2"><Input aria-label={`Line ${i + 1} description`} value={l.description} onChange={e => patchLine(i, { description: e.target.value })} /></td><td className="w-24 pr-2"><Input type="number" min={0} step="any" aria-label={`Line ${i + 1} quantity`} value={l.quantity} onChange={e => patchLine(i, { quantity: Number(e.target.value) })} /></td><td className="w-20 pr-2"><Input aria-label={`Line ${i + 1} unit`} value={l.unit} onChange={e => patchLine(i, { unit: e.target.value })} /></td><td className="w-28 pr-2"><Input type="number" min={0} step="any" aria-label={`Line ${i + 1} unit price`} value={l.unitPriceCents / 100} onChange={e => patchLine(i, { unitPriceCents: Math.round(Number(e.target.value) * 100) })} /></td><td className="w-28 text-right tabular-nums">{editable ? <Input type="number" min={0} step="any" className="text-right" aria-label={`Line ${i + 1} amount`} value={lineAmount(l) / 100} onChange={e => patchLine(i, setLineAmount(l, Math.round(Number(e.target.value) * 100)))} /> : dollars(lineAmount(l))}</td>{editable && <td className="w-28 pl-2"><div className="flex"><Button size="icon" variant="ghost" title="Move line up" aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Move line down" aria-label={`Move line ${i + 1} down`} disabled={i === lines.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Remove line" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(cur => cur.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></Button></div></td>}</tr>)}</tbody></table></div>
        {editable && <Button variant="outline" size="sm" onClick={() => setLines(cur => [...cur, shapeBillLine({ description: "", amountCents: 0 })])}><Plus className="mr-2 h-4 w-4" />Add line</Button>}
        <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-3"><label className="block text-xs font-medium">Notes to client<Textarea value={clientNotes} onChange={e => setClientNotes(e.target.value)} /></label><label className="block text-xs font-medium">Internal notes<Textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} /></label></div><div><label className="block text-xs font-medium">Holdback held (%) — this bill only<Input className="my-1 w-28" type="number" min={0} max={50} step="any" value={holdback} disabled={saved.kind === "holdback_release"} onChange={e => setHoldback(Number(e.target.value))} /><span className="font-normal text-muted-foreground">Job default: {project ? Number(project.holdback_pct) : "…"}%</span></label><dl className="mt-3 space-y-2 text-sm">{[["Subtotal", total.grossCents], ["Holdback held", -total.holdbackCents], ["Net", total.netCents], [`GST ${editable ? tax?.gst_pct ?? gst : gst}%`, total.gstCents], ["Total", total.totalCents]].map(([label, value]) => <div key={label as string} className="flex justify-between border-b border-border py-1"><dt>{label}</dt><dd className="tabular-nums">{dollars(value as number)}</dd></div>)}</dl>{project?.contract_type !== "open_book" && <p className="mt-2 text-xs text-muted-foreground">Left to bill, excluding this bill: {dollars(Math.max(0, position.remainingCents))}</p>}</div></div>
      </fieldset>
      {problem && <p role="alert" className="mt-4 text-sm text-destructive">{problem}</p>}
      <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
        {editable && <><Button disabled={busy || !tax || !project} onClick={() => void save()}>Save</Button><Button disabled={busy || !tax || !project} onClick={() => void save(true)}>Save &amp; Issue</Button></>}
        <Button variant="outline" disabled={busy} onClick={() => onPdf(saved)}>Invoice PDF</Button>
        {editable && <Button variant="ghost" disabled={busy} onClick={() => void status("deleted")}>Delete</Button>}
        {canManage && saved.status === "issued" && <><Button variant="outline" disabled={busy} onClick={() => void save(false, true)}>Copy to new draft</Button><Button variant="ghost" disabled={busy} onClick={() => void status("void")}>Void</Button></>}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Bills are entered in QuickBooks by hand for now.</p>
    </SheetContent>
  </Sheet>;
}