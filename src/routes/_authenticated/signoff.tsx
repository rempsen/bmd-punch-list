import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { SignaturePad } from "@/components/signoff/SignaturePad";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { billingPosition, type BillKind } from "@/lib/billing/calc";
import { useInvalidateDeficiencies } from "@/lib/data";
import { uploadDocument } from "@/lib/documents/upload";
import { useInstallationRooms } from "@/lib/installation/data";
import { scopeLabel } from "@/lib/job-wizard";
import { useAwaitingMaterial } from "@/lib/materials/data";
import { db, errText } from "@/lib/platform/db";
import { useInspectionItems, useInspections, useRefreshSignoff, useSignoffs, type Inspection, type InspectionItem, type Signoff } from "@/lib/signoff/data";
import {
  buildChecklist, closeBlock, deriveOutcome, KIND_LABEL, linkState, METHOD_LABEL, OUTCOME_LABEL, RESULT_LABEL, signoffEligibility,
  type InspectionKind, type ItemResult, type Outcome, type SignMethod,
} from "@/lib/signoff/logic";
import { renderSignoffPdf } from "@/lib/signoff/pdf";
import { sendSignoffLink } from "@/lib/signoff/signoff.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/signoff")({
  head: () => ({
    meta: [
      { title: "Inspections & Sign-off · BMD Materials" },
      { name: "description", content: "Walk the job with the client, record the outcome, get sign-off and release the holdback." },
      { property: "og:title", content: "Inspections & Sign-off · BMD Materials" },
      { property: "og:description", content: "Inspections, client sign-off and holdback release for the job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignoffPage,
});

const OUTCOME_CHIP: Record<Outcome, string> = {
  pending: "bg-muted text-muted-foreground",
  passed: "bg-emerald-100 text-emerald-900",
  passed_with_items: "bg-amber-100 text-amber-900",
  failed: "bg-destructive/10 text-destructive",
};
const field = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—");

function SignoffPage() {
  const { can, currentJob } = useAuth();
  if (!currentJob) return <Navigate to="/jobs" replace />;
  if (!can("view_dashboard") && !can("manage_projects")) return <Navigate to="/" replace />;
  return <Signoffs projectId={currentJob.id} jobName={currentJob.name} />;
}

function Signoffs({ projectId, jobName }: { projectId: string; jobName: string }) {
  const { can } = useAuth();
  const canManage = can("manage_projects");
  const inspections = useInspections(projectId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = inspections.data?.find((i) => i.id === openId) ?? null;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <PageHeader title="Inspections & Sign-off" subtitle={jobName} />
      <ReadinessPanel projectId={projectId} />
      {open ? (
        <InspectionDetail inspection={open} projectId={projectId} canManage={canManage} onBack={() => setOpenId(null)} />
      ) : (
        <InspectionsPanel projectId={projectId} canManage={canManage} list={inspections.data ?? []} loading={inspections.isLoading} onOpen={setOpenId} />
      )}
      <SignoffPanel projectId={projectId} jobName={jobName} inspections={inspections.data ?? []} canManage={canManage} />
    </div>
  );
}

function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{actions}</div>
      {children}
    </section>
  );
}

/* ---------- 1. Readiness ---------- */
function ReadinessPanel({ projectId }: { projectId: string }) {
  const install = useInstallationRooms(projectId);
  const material = useAwaitingMaterial(projectId);
  const mustFix = [...install.rooms].reduce((s, r) => s + r.mustFix, 0);
  const counts = { installed: 0, in_progress: 0, blocked: 0, not_ready: 0 };
  for (const r of install.rooms) counts[r.ready.state]++;
  const notOnSite = (material.data ?? []).length;
  const ready = install.rooms.length > 0 && counts.installed === install.rooms.length && mustFix === 0;
  const stat = (label: string, n: number, tone: string) => (
    <div className={cn("rounded-lg border p-3", tone)}><div className="text-2xl font-semibold tabular-nums">{n}</div><div className="text-xs font-medium">{label}</div></div>
  );
  return (
    <Panel title="Readiness check">
      {install.loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {stat("Rooms installed", counts.installed, "border-emerald-200 bg-emerald-50 text-emerald-900")}
            {stat("In progress", counts.in_progress, "border-blue-200 bg-blue-50 text-blue-900")}
            {stat("Blocked", counts.blocked, "border-destructive/30 bg-destructive/5 text-destructive")}
            {stat("Open must-fix", mustFix, mustFix ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-muted/40")}
            {stat("Material not on site", notOnSite, notOnSite ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-muted/40")}
          </div>
          {ready ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Ready for walkthrough</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {counts.installed < install.rooms.length && <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />{install.rooms.length - counts.installed} of {install.rooms.length} rooms not installed — <Link to="/installation" search={{ job: projectId }} className="text-primary underline">Installation Progress</Link></li>}
              {!install.rooms.length && <li className="text-muted-foreground">No rooms set up for this job.</li>}
              {mustFix > 0 && <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />{mustFix} open must-fix deficienc{mustFix === 1 ? "y" : "ies"} — <Link to="/board" className="text-primary underline">Board</Link></li>}
              {notOnSite > 0 && <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />{notOnSite} material line{notOnSite === 1 ? "" : "s"} not on site</li>}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------- 2. Inspections ---------- */
function InspectionsPanel({ projectId, canManage, list, loading, onOpen }: { projectId: string; canManage: boolean; list: Inspection[]; loading: boolean; onOpen: (id: string) => void }) {
  const { user } = useAuth();
  const install = useInstallationRooms(projectId);
  const refresh = useRefreshSignoff();
  const [dlg, setDlg] = useState(false);
  const [f, setF] = useState({ kind: "walkthrough" as InspectionKind, date: new Date().toISOString().slice(0, 10), attendees: "", generate: true });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await db.from("inspections").insert({ project_id: projectId, kind: f.kind, scheduled_for: f.date || null, attendees: f.attendees.trim() || null, created_by: user?.id ?? null }).select("id").single();
      if (error) throw error;
      if (f.generate) {
        const items = buildChecklist(install.rooms.map((r) => ({ id: r.id, name: r.name, floorLabel: r.floorLabel, status: Object.fromEntries(install.scopes.map((s) => [s, r.rows[s]?.status])) })), install.scopes);
        if (items.length) {
          const { error: e2 } = await db.from("inspection_items").insert(items.map((i) => ({ ...i, inspection_id: data.id, project_id: projectId })));
          if (e2) throw e2;
        }
      }
      toast.success("Inspection created.");
      setDlg(false);
      refresh();
      onOpen(data.id);
    } catch (e) {
      toast.error(`Could not create the inspection: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Inspections" actions={canManage ? <Button size="sm" onClick={() => setDlg(true)}><Plus className="mr-1 h-4 w-4" />New inspection</Button> : undefined}>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : !list.length ? (
        <p className="text-sm text-muted-foreground">No inspections yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Kind</th><th>Date</th><th>Outcome</th><th>Items</th><th /></tr></thead>
            <tbody>
              {list.map((i) => {
                const ok = i.inspection_items.filter((x) => x.result === "ok").length;
                const def = i.inspection_items.filter((x) => x.result === "deficient").length;
                return (
                  <tr key={i.id} className="border-t">
                    <td className="py-2 font-medium">{KIND_LABEL[i.kind]}</td>
                    <td>{i.held_at ? `Held ${fmt(i.held_at)}` : fmt(i.scheduled_for)}</td>
                    <td><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", OUTCOME_CHIP[i.outcome])}>{OUTCOME_LABEL[i.outcome]}</span></td>
                    <td className="tabular-nums">{ok} OK · {def} deficient · {i.inspection_items.length} total</td>
                    <td className="text-right"><Button size="sm" variant="outline" onClick={() => onOpen(i.id)}>Open</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>New inspection</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block">Kind<select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as InspectionKind })}>{(Object.keys(KIND_LABEL) as InspectionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
            <label className="block">Date<Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className="block">Attendees<Input value={f.attendees} placeholder="e.g. Dan (BMD), Azim (Hyatt)" onChange={(e) => setF({ ...f, attendees: e.target.value })} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.generate} onChange={(e) => setF({ ...f, generate: e.target.checked })} />Generate checklist ({install.rooms.length} rooms × {install.scopes.length} scope{install.scopes.length === 1 ? "" : "s"}, skipping Not required)</label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDlg(false)}>Cancel</Button><Button disabled={busy || install.loading} onClick={() => void create()}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function InspectionDetail({ inspection, projectId, canManage, onBack }: { inspection: Inspection; projectId: string; canManage: boolean; onBack: () => void }) {
  const { user } = useAuth();
  const items = useInspectionItems(inspection.id);
  const install = useInstallationRooms(projectId);
  const refresh = useRefreshSignoff();
  const invalidateDefs = useInvalidateDeficiencies();
  const [closing, setClosing] = useState(false);
  const [markFailed, setMarkFailed] = useState(false);
  const [notes, setNotes] = useState(inspection.notes ?? "");
  const closed = !!inspection.held_at;
  const editable = canManage && !closed;
  const list = items.data ?? [];
  const roomOf = useMemo(() => new Map(install.rooms.map((r) => [r.id, r])), [install.rooms]);
  const groups = useMemo(() => {
    const m = new Map<string, InspectionItem[]>();
    for (const i of list) { const k = (i.room_id && roomOf.get(i.room_id)?.floorLabel) || "Other"; (m.get(k) ?? m.set(k, []).get(k)!).push(i); }
    return [...m];
  }, [list, roomOf]);

  const update = async (id: string, patch: Partial<InspectionItem>) => {
    const { error } = await db.from("inspection_items").update(patch).eq("id", id);
    if (error) toast.error(`Could not save: ${errText(error)}`);
    refresh();
  };
  const createDeficiency = async (i: InspectionItem) => {
    if (!i.room_id) return void toast.error("This item has no room, so a deficiency can't be placed.");
    const scope = i.scope ? scopeLabel(i.scope) : "Inspection";
    const { data, error } = await supabase.from("deficiencies").insert({
      project_id: projectId, location_id: i.room_id, area: scope, material: scope, issue_type: "Inspection finding",
      description: i.note?.trim() || `Found at ${KIND_LABEL[inspection.kind].toLowerCase()}: ${i.description}`,
      assessment: "must_fix", responsible_party: "unassigned", source: "inspection", created_by: user?.id ?? null,
    }).select("id,item_number").maybeSingle();
    if (error || !data) return void toast.error(`Could not create the deficiency: ${errText(error ?? new Error("no row"))}`);
    await update(i.id, { deficiency_id: data.id });
    invalidateDefs();
    toast.success(`Deficiency D-${String(data.item_number).padStart(4, "0")} created.`);
  };
  const close = async () => {
    const block = closeBlock(list, markFailed);
    if (block) return void toast.error(block);
    const outcome = deriveOutcome(list, markFailed);
    const { error } = await db.from("inspections").update({ held_at: new Date().toISOString(), held_by: user?.id ?? null, outcome, notes: notes.trim() || null, updated_at: new Date().toISOString() }).eq("id", inspection.id);
    if (error) return void toast.error(`Could not close: ${errText(error)}`);
    toast.success(`Inspection closed: ${OUTCOME_LABEL[outcome]}.`);
    setClosing(false);
    refresh();
  };

  return (
    <Panel title={`${KIND_LABEL[inspection.kind]} · ${inspection.held_at ? `held ${fmt(inspection.held_at)}` : fmt(inspection.scheduled_for)}`} actions={
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onBack}>Back to list</Button>
        {editable && <Button size="sm" onClick={() => setClosing(true)}><ClipboardCheck className="mr-1 h-4 w-4" />Close inspection</Button>}
      </div>
    }>
      <p className="mb-3 text-sm text-muted-foreground">
        Outcome <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs font-medium", OUTCOME_CHIP[inspection.outcome])}>{OUTCOME_LABEL[inspection.outcome]}</span>
        {inspection.attendees && <> · Attendees: {inspection.attendees}</>}
      </p>
      {items.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : !list.length ? <p className="text-sm text-muted-foreground">No checklist items.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Room</th><th>Scope</th><th>Result</th><th>Note</th><th>Deficiency</th></tr></thead>
            <tbody>
              {groups.map(([floor, rows]) => (
                <FloorGroup key={floor} floor={floor}>
                  {rows.map((i) => (
                    <tr key={i.id} className={cn("border-t", i.result === "deficient" && "bg-destructive/5")}>
                      <td className="py-2 font-medium">{(i.room_id && roomOf.get(i.room_id)?.name) || i.description}</td>
                      <td>{i.scope ? scopeLabel(i.scope) : "—"}</td>
                      <td>
                        <div className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Result">
                          {(["ok", "deficient", "not_inspected"] as ItemResult[]).map((r) => (
                            <button key={r} type="button" disabled={!editable} onClick={() => void update(i.id, { result: r })}
                              className={cn("px-2 py-1 text-xs", i.result === r ? (r === "ok" ? "bg-emerald-100 text-emerald-900" : r === "deficient" ? "bg-destructive/15 text-destructive" : "bg-muted") : "bg-card text-muted-foreground")}>
                              {RESULT_LABEL[r]}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td><Input className="h-8" disabled={!editable} defaultValue={i.note ?? ""} onBlur={(e) => e.target.value !== (i.note ?? "") && void update(i.id, { note: e.target.value.trim() || null })} /></td>
                      <td>
                        {i.deficiency_id ? <Link to="/item/$id" params={{ id: i.deficiency_id }} className="text-primary underline">Open item</Link>
                          : i.result === "deficient" && canManage ? <Button size="sm" variant="outline" onClick={() => void createDeficiency(i)}>Create deficiency</Button> : "—"}
                      </td>
                    </tr>
                  ))}
                </FloorGroup>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close inspection</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>Outcome will be <b>{OUTCOME_LABEL[deriveOutcome(list, markFailed)]}</b>.</p>
            {closeBlock(list, markFailed) && <p className="text-destructive">{closeBlock(list, markFailed)}</p>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={markFailed} onChange={(e) => setMarkFailed(e.target.checked)} />Mark as failed</label>
            <label className="block">Notes<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setClosing(false)}>Cancel</Button><Button onClick={() => void close()}>Close inspection</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function FloorGroup({ floor, children }: { floor: string; children: React.ReactNode }) {
  return (<><tr className="border-t bg-muted/30"><td colSpan={5} className="px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{floor}</td></tr>{children}</>);
}

/* ---------- 3. Sign-off ---------- */
function SignoffPanel({ projectId, jobName, inspections, canManage }: { projectId: string; jobName: string; inspections: Inspection[]; canManage: boolean }) {
  const { can } = useAuth();
  const signoffs = useSignoffs(projectId);
  const refresh = useRefreshSignoff();
  const [dlg, setDlg] = useState(false);
  const [busy, setBusy] = useState(false);
  const signed = (signoffs.data ?? []).find((s) => s.signed_at) ?? null;
  const pending = (signoffs.data ?? []).filter((s) => !s.signed_at && s.method === "emailed_link");
  const elig = signoffEligibility(inspections);
  const latest = inspections.filter((i) => i.held_at).sort((a, b) => (a.held_at! < b.held_at! ? 1 : -1))[0] ?? null;
  const canRelease = canManage && can("view_pricing");
  const job = useQuery({
    queryKey: ["signoff-job", projectId],
    queryFn: async () => {
      const { data } = await db.from("projects").select("name,project_number,address,holdback_pct,client:clients(name)").eq("id", projectId).maybeSingle();
      return data as { name: string; project_number: string | null; address: string | null; holdback_pct: number; client: { name: string } | null } | null;
    },
  });

  const releaseHoldback = async (s: Signoff) => {
    setBusy(true);
    try {
      if (!job.data || Number(job.data.holdback_pct) <= 0) { toast.info("This job has no holdback configured, so there is nothing to release."); return; }
      const { data: bills, error } = await db.from("progress_bills").select("kind,status,gross_cents,holdback_cents").eq("project_id", projectId);
      if (error) throw error;
      const pos = billingPosition(0, (bills ?? []) as { kind: BillKind; status: "draft" | "issued" | "void"; gross_cents: number; holdback_cents: number }[]);
      if (pos.holdbackOwingCents <= 0) { toast.info("No holdback is being held yet — it builds up as progress bills are issued."); return; }
      const { data: billId, error: e2 } = await db.rpc("create_progress_bill", { _project: projectId, _kind: "holdback_release", _lines: [{ description: "Release of holdback", amountCents: pos.holdbackOwingCents }], _period_note: `Released on client sign-off by ${s.signed_by_name}` });
      if (e2) throw e2;
      const { error: e3 } = await db.from("signoffs").update({ holdback_released: true, holdback_bill_id: billId as string, holdback_released_at: new Date().toISOString() }).eq("id", s.id);
      if (e3) throw e3;
      toast.success("Draft holdback bill created. Check it in Billing, then issue it.");
      refresh();
    } catch (e) {
      toast.error(`Could not release the holdback: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async (s: Signoff) => {
    setBusy(true);
    try {
      const insp = inspections.find((i) => i.id === s.inspection_id) ?? latest;
      const logo = await fetch("/bmd-logo.png").then((r) => r.blob()).then((b) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b); })).catch(() => null);
      const doc = renderSignoffPdf({
        job: { name: job.data?.name ?? jobName, number: job.data?.project_number ?? null, address: job.data?.address ?? null },
        client: job.data?.client?.name ?? null,
        inspection: insp ? { kind: insp.kind, held_at: insp.held_at, attendees: insp.attendees, outcome: insp.outcome, notes: insp.notes, ok: insp.inspection_items.filter((x) => x.result === "ok").length, deficient: insp.inspection_items.filter((x) => x.result === "deficient").length, notInspected: insp.inspection_items.filter((x) => x.result === "not_inspected").length } : null,
        signoff: { name: s.signed_by_name, email: s.signed_by_email, signed_at: s.signed_at, method: s.method, signature: s.signature_data, notes: s.notes },
        logoDataUrl: logo,
      });
      const name = `Sign-off ${(job.data?.name ?? jobName).replace(/[^\w -]+/g, "")} ${(s.signed_at ?? "").slice(0, 10)}.pdf`;
      const blob = doc.output("blob");
      doc.save(name);
      if (canManage) {
        await uploadDocument({ projectId, section: "contract", file: new File([blob], name, { type: "application/pdf" }), note: "Client sign-off", onProgress: () => {} }).done;
        toast.success("Saved to Documents → Contract.");
      }
    } catch (e) {
      toast.error(`PDF downloaded but could not be filed to Documents: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Sign-off" actions={canManage && !signed ? <Button size="sm" disabled={!elig.ok} onClick={() => setDlg(true)}>Record sign-off</Button> : undefined}>
      {signoffs.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : signed ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Signed by {signed.signed_by_name}{signed.signed_by_email ? ` (${signed.signed_by_email})` : ""} on {fmt(signed.signed_at)} · {METHOD_LABEL[signed.method]}</p>
          {signed.signature_data && <img src={signed.signature_data} alt={`Signature of ${signed.signed_by_name}`} className="h-16 rounded border bg-background" />}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void downloadPdf(signed)}><Download className="mr-1 h-4 w-4" />Download sign-off PDF</Button>
            {signed.holdback_released ? (
              <Link to="/projects/$id" params={{ id: projectId }} search={{ tab: "billing" }} className="inline-flex items-center text-sm text-primary underline">Holdback released — view in Billing</Link>
            ) : canRelease ? <Button size="sm" disabled={busy} onClick={() => void releaseHoldback(signed)}>Release holdback</Button> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Not signed yet.</p>
          {!elig.ok && <p className="flex items-center gap-2 text-amber-800"><AlertTriangle className="h-4 w-4" />{elig.reason}</p>}
          {pending.map((p) => (
            <p key={p.id} className="text-muted-foreground">Link emailed to {p.signed_by_email} {fmt(p.created_at)} — {linkState(p) === "open" ? `waiting, expires ${fmt(p.link_expires_at)}` : "expired"}</p>
          ))}
        </div>
      )}
      {dlg && latest && <RecordDialog projectId={projectId} inspectionId={latest.id} onClose={() => { setDlg(false); refresh(); }} />}
    </Panel>
  );
}

function RecordDialog({ projectId, inspectionId, onClose }: { projectId: string; inspectionId: string; onClose: () => void }) {
  const { user } = useAuth();
  const sendLink = useServerFn(sendSignoffLink);
  const [method, setMethod] = useState<SignMethod>("in_app");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sig, setSig] = useState<string | null>(null);
  const [scan, setScan] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return void toast.error("Enter the client's name.");
    setBusy(true);
    try {
      if (method === "emailed_link") {
        await sendLink({ data: { projectId, inspectionId, name, email } });
        toast.success(`Sign-off link emailed to ${email}.`);
      } else {
        if (method === "in_app" && !sig) throw new Error("Ask the client to sign in the box.");
        let documentId: string | null = null;
        if (method === "on_paper") {
          if (!scan) throw new Error("Attach the signed paper copy.");
          await uploadDocument({ projectId, section: "contract", file: scan, note: `Signed sign-off — ${name.trim()}`, onProgress: () => {} }).done;
          const { data: doc } = await db.from("project_documents").select("id").eq("project_id", projectId).eq("file_name", scan.name).order("created_at", { ascending: false }).limit(1).maybeSingle();
          documentId = (doc as { id: string } | null)?.id ?? null;
        }
        const { error } = await db.from("signoffs").insert({
          project_id: projectId, inspection_id: inspectionId, signed_by_name: name.trim(), signed_by_email: email.trim() || null, method,
          signed_at: method === "on_paper" ? new Date(`${date}T12:00:00`).toISOString() : new Date().toISOString(),
          signature_data: method === "in_app" ? sig : null, notes: notes.trim() || null, document_id: documentId, recorded_by: user?.id ?? null,
        });
        if (error) throw error;
        toast.success("Sign-off recorded.");
      }
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record sign-off</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-1 rounded-md border p-1" role="radiogroup" aria-label="Method">
            {(["in_app", "emailed_link", "on_paper"] as SignMethod[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={cn("rounded px-2 py-1.5 text-xs font-medium", method === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {m === "in_app" ? "In app" : m === "emailed_link" ? "Emailed link" : "On paper"}
              </button>
            ))}
          </div>
          <label className="block">Client name<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block">Email{method !== "emailed_link" && " (optional)"}<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {method === "in_app" && <SignaturePad onChange={setSig} />}
          {method === "emailed_link" && <p className="text-muted-foreground">The client gets an email with a link that works for 14 days. They sign in with their BMD account and sign on screen.</p>}
          {method === "on_paper" && (
            <>
              <label className="block">Date signed<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="block">Scan of the signed copy<Input type="file" accept="application/pdf,image/*" onChange={(e) => setScan(e.target.files?.[0] ?? null)} /></label>
            </>
          )}
          {method !== "emailed_link" && <label className="block">Notes<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void save()}>{method === "emailed_link" ? "Send link" : "Record sign-off"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
