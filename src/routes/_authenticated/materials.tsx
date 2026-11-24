import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useMaterials, useSuppliers } from "@/lib/catalogue/data";
import { useAddMaterial, useMaterialOrders, useMoveMaterials, useRefreshMaterials, type MaterialOrder } from "@/lib/materials/data";
import { isMaterialStatus, MATERIAL_STATUSES, poBlock, STATUS_LABEL, type MaterialStatus } from "@/lib/materials/logic";
import { createPurchaseOrder } from "@/lib/materials/materials.functions";
import { errText } from "@/lib/platform/db";
import { money, shortDate, staffName, useBmdStaff, usePipelineProjects } from "@/lib/projects/data";

type Search = { stage?: MaterialStatus | undefined; job?: string | undefined; q?: string | undefined };

export const Route = createFileRoute("/_authenticated/materials")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    stage: isMaterialStatus(s["stage"]) ? s["stage"] : undefined,
    job: typeof s["job"] === "string" && s["job"] ? s["job"] : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Materials · BMD Materials" },
      { name: "description", content: "Material for every won job: on order, received at the warehouse, and delivered to site." },
      { property: "og:title", content: "Materials · BMD Materials" },
      { property: "og:description", content: "Ordered, received, and on site." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MaterialsPage,
});

const field = "h-10 rounded-md border border-input bg-background px-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);
const toIso = (d: string) => new Date(`${d}T12:00:00`).toISOString();

function MaterialsPage() {
  const { canAny } = useAuth();
  if (!canAny("view_pipeline")) return <Navigate to="/" replace />;
  return <Materials />;
}

type Dlg = null | "po" | "receive" | "site" | "add";

function Materials() {
  const { canAny, user } = useAuth();
  const canManage = canAny("manage_materials") || canAny("manage_projects");
  const search = Route.useSearch();
  const stage: MaterialStatus = search.stage ?? "on_order";
  const navigate = useNavigate({ from: "/materials" });
  const set = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const orders = useMaterialOrders();
  const projects = usePipelineProjects();
  const suppliers = useSuppliers();
  const catalogue = useMaterials();
  const staff = useBmdStaff();
  const move = useMoveMaterials();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dlg>(null);

  const jobs = useMemo(() => (projects.data ?? []).filter((p) => p.stage === "won" || p.stage === "in_progress"), [projects.data]);
  const projectOf = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
  const supplierOf = useMemo(() => new Map((suppliers.data ?? []).map((s) => [s.id, s])), [suppliers.data]);
  const catOf = useMemo(() => new Map((catalogue.data ?? []).map((m) => [m.id, m])), [catalogue.data]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").toLowerCase();
    return (orders.data ?? []).filter((o) => {
      if (search.job && o.project_id !== search.job) return false;
      if (!q) return true;
      const p = projectOf.get(o.project_id);
      return [o.description, o.po_number, supplierOf.get(o.supplier_id ?? "")?.name, p?.name, p?.project_number].some((v) => v?.toLowerCase().includes(q));
    });
  }, [orders.data, search.job, search.q, projectOf, supplierOf]);
  const counts = Object.fromEntries(MATERIAL_STATUSES.map((s) => [s, filtered.filter((o) => o.status === s).length])) as Record<MaterialStatus, number>;
  const rows = filtered.filter((o) => o.status === stage);
  const groups = useMemo(() => {
    const g = new Map<string, MaterialOrder[]>();
    for (const r of rows) g.set(r.project_id, [...(g.get(r.project_id) ?? []), r]);
    return [...g.entries()];
  }, [rows]);
  const chosen = rows.filter((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const done = () => { setSelected(new Set()); setDlg(null); };

  const undo = async (to: MaterialStatus) => {
    try { await move.mutateAsync({ rows: chosen, to }); toast.success(`Moved back to ${STATUS_LABEL[to]}`); done(); } catch (e) { toast.error(errText(e)); }
  };

  return (
    <div>
      <PageHeader title="Materials" subtitle="Ordered, received, and on site" actions={canManage ? <Button size="sm" onClick={() => setDlg("add")}><Plus className="mr-1 h-4 w-4" />Add material</Button> : undefined} />
      <div className="space-y-4 p-4 md:p-6">
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
          {MATERIAL_STATUSES.map((s) => (
            <button key={s} role="tab" aria-selected={stage === s} onClick={() => { setSelected(new Set()); set({ stage: s }); }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${stage === s ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>
              {STATUS_LABEL[s]} <span className="ml-1 rounded bg-muted px-1.5 text-xs">{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Job" className={field} value={search.job ?? ""} onChange={(e) => set({ job: e.target.value || undefined })}>
            <option value="">All jobs</option>
            {jobs.map((p) => <option key={p.id} value={p.id}>{[p.project_number, p.name].filter(Boolean).join(" · ")}</option>)}
          </select>
          <Input aria-label="Search" placeholder="Search material, supplier, PO, job" className="h-10 max-w-xs" value={search.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} />
          {canManage && (
            <div className="ml-auto flex flex-wrap gap-2">
              {stage === "on_order" && <>
                <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => { const b = poBlock(chosen); if (b) toast.error(b); else setDlg("po"); }}>Create PO in QuickBooks</Button>
                <Button size="sm" disabled={!chosen.length} onClick={() => setDlg("receive")}>Mark received</Button>
              </>}
              {stage === "received" && <>
                <Button size="sm" variant="outline" disabled={!chosen.length || move.isPending} onClick={() => undo("on_order")}>Back to ordering</Button>
                <Button size="sm" disabled={!chosen.length} onClick={() => setDlg("site")}>Deliver to site</Button>
              </>}
              {stage === "on_site" && <Button size="sm" variant="outline" disabled={!chosen.length || move.isPending} onClick={() => undo("received")}>Back to received</Button>}
            </div>
          )}
        </div>

        {orders.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : orders.error ? <p className="text-sm text-destructive">{errText(orders.error)}</p>
          : groups.length === 0 ? <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing in {STATUS_LABEL[stage]}.</p>
          : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 p-2" />
                  <th className="p-2">Material</th><th className="p-2">Qty</th><th className="p-2">Supplier</th><th className="p-2">PO</th>
                  <th className="p-2">Ordered</th>{stage !== "on_order" && <th className="p-2">Received</th>}{stage === "on_site" && <th className="p-2">On site</th>}
                  <th className="p-2">Who</th><th className="p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([pid, list]) => {
                  const p = projectOf.get(pid);
                  return [
                    <tr key={pid} className="border-t border-border bg-muted/30">
                      <td colSpan={10} className="p-2 font-semibold">
                        <Link to="/projects/$id" params={{ id: pid }} className="underline-offset-2 hover:underline">{[p?.project_number, p?.name ?? "Job"].filter(Boolean).join(" · ")}</Link>
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{list.length} line{list.length === 1 ? "" : "s"}</span>
                      </td>
                    </tr>,
                    ...list.map((o) => {
                      const cat = o.catalogue_item_id ? catOf.get(o.catalogue_item_id) : undefined;
                      const who = stage === "on_site" ? o.on_site_by : stage === "received" ? o.received_by : null;
                      return (
                        <tr key={o.id} className="border-t border-border">
                          <td className="p-2">{canManage && <input type="checkbox" aria-label={`Select ${o.description}`} checked={selected.has(o.id)} onChange={() => toggle(o.id)} />}</td>
                          <td className="p-2"><div className="font-medium">{o.description}</div>{cat && <div className="text-xs text-muted-foreground">{cat.name}{cat.sku ? ` · ${cat.sku}` : ""}</div>}</td>
                          <td className="p-2 whitespace-nowrap">{o.status !== "on_order" && o.received_qty != null && o.received_qty !== o.quantity ? `${o.received_qty} of ${o.quantity}` : o.quantity} {o.unit}{o.unit_cost_cents != null && <div className="text-xs text-muted-foreground">{money(o.unit_cost_cents)} each</div>}</td>
                          <td className="p-2">{supplierOf.get(o.supplier_id ?? "")?.name ?? <span className="text-muted-foreground">No supplier</span>}</td>
                          <td className="p-2 whitespace-nowrap">{o.po_number ? <>{o.po_number}<div className="text-xs text-muted-foreground">{o.qbo_po_sent_at ? `Sent ${shortDate(o.qbo_po_sent_at)}` : "Not sent"}</div></> : <span className="text-muted-foreground">Not sent</span>}</td>
                          <td className="p-2 whitespace-nowrap">{shortDate(o.ordered_at)}</td>
                          {stage !== "on_order" && <td className="p-2 whitespace-nowrap">{shortDate(o.received_at)}</td>}
                          {stage === "on_site" && <td className="p-2 whitespace-nowrap">{shortDate(o.on_site_at)}</td>}
                          <td className="p-2">{who ? staffName(staff.data ?? [], who) : "—"}</td>
                          <td className="p-2 text-muted-foreground">{[o.received_note, o.notes].filter(Boolean).join(" · ") || "—"}</td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dlg === "po" && <PoDialog rows={chosen} supplier={supplierOf.get(chosen[0]?.supplier_id ?? "")} onClose={() => setDlg(null)} onDone={done} />}
      {dlg === "receive" && <MoveDialog title="Mark received" rows={chosen} to="received" askQty staff={staff.data ?? []} me={user?.id ?? null} onClose={() => setDlg(null)} onDone={done} />}
      {dlg === "site" && <MoveDialog title="Deliver to site" rows={chosen} to="on_site" staff={staff.data ?? []} me={user?.id ?? null} onClose={() => setDlg(null)} onDone={done} />}
      {dlg === "add" && <AddDialog jobs={jobs} suppliers={(suppliers.data ?? []).filter((s) => s.active !== false)} defaultJob={search.job} onClose={() => setDlg(null)} />}
    </div>
  );
}

function Shell({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">{children}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;

function PoDialog({ rows, supplier, onClose, onDone }: { rows: MaterialOrder[]; supplier: { name: string; email: string | null } | undefined; onClose: () => void; onDone: () => void }) {
  const create = useServerFn(createPurchaseOrder);
  const refresh = useRefreshMaterials();
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await create({ data: { ids: rows.map((x) => x.id), email } });
      void refresh();
      if (r.ok) { toast.success(r.message); onDone(); } else setErr(r.message);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create PO in QuickBooks" onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !email.trim()} onClick={go}>{busy ? "Working…" : "Create & send"}</Button></>}>
      <p><span className="text-muted-foreground">Supplier:</span> <strong>{supplier?.name ?? "—"}</strong></p>
      <Row label="Vendor email (the PO is emailed here)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@supplier.com" /></Row>
      <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-border p-2">
        {rows.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>{r.description}</span><span className="whitespace-nowrap text-muted-foreground">{r.quantity} {r.unit}</span></li>)}
      </ul>
      {err && <p role="alert" className="rounded bg-destructive/10 p-2 text-destructive">{err}</p>}
    </Shell>
  );
}

function MoveDialog({ title, rows, to, askQty, staff, me, onClose, onDone }: { title: string; rows: MaterialOrder[]; to: MaterialStatus; askQty?: boolean; staff: { id: string; full_name: string | null; email: string | null }[]; me: string | null; onClose: () => void; onDone: () => void }) {
  const move = useMoveMaterials();
  const [date, setDate] = useState(today());
  const [by, setBy] = useState(me ?? "");
  const [qty, setQty] = useState(String(rows[0]?.quantity ?? ""));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const one = rows.length === 1;
  const go = async () => {
    setErr(null);
    try {
      await move.mutateAsync({ rows, to, at: toIso(date), by: by || null, qty: askQty && one && qty !== "" ? Number(qty) : null, note: note || null });
      toast.success(`${rows.length} line${one ? "" : "s"} moved to ${STATUS_LABEL[to]}`);
      onDone();
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <Shell title={title} onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={move.isPending} onClick={go}>{title}</Button></>}>
      <p className="text-muted-foreground">{rows.length} line{one ? "" : "s"} selected.</p>
      {askQty && (one
        ? <Row label={`Received quantity (${rows[0]?.unit ?? ""})`}><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Row>
        : <p className="text-xs text-muted-foreground">Each line is received at its full ordered quantity. Select one line to record a different amount.</p>)}
      <Row label={askQty ? "Received by" : "Delivered by"}>
        <select className={`${field} w-full`} value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">—</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
        </select>
      </Row>
      <Row label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Row>
      {askQty && <Row label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Damaged box, short shipped…" /></Row>}
      {err && <p role="alert" className="rounded bg-destructive/10 p-2 text-destructive">{err}</p>}
    </Shell>
  );
}

function AddDialog({ jobs, suppliers, defaultJob, onClose }: { jobs: { id: string; name: string; project_number: string | null }[]; suppliers: { id: string; name: string }[]; defaultJob: string | undefined; onClose: () => void }) {
  const add = useAddMaterial();
  const [f, setF] = useState({ job: defaultJob ?? "", description: "", qty: "", unit: "", supplier: "", cost: "" });
  const [err, setErr] = useState<string | null>(null);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => {
    setErr(null);
    if (!f.job || !f.description.trim() || !(Number(f.qty) > 0)) return setErr("Choose a job, describe the material and enter a quantity.");
    try {
      await add.mutateAsync({ project_id: f.job, description: f.description.trim(), quantity: Number(f.qty), unit: f.unit.trim(), supplier_id: f.supplier || null, unit_cost_cents: f.cost ? Math.round(Number(f.cost) * 100) : null });
      toast.success("Material added to Ordering");
      onClose();
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <Shell title="Add material" onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={add.isPending} onClick={go}>Add</Button></>}>
      <Row label="Job"><select className={`${field} w-full`} value={f.job} onChange={up("job")}><option value="">Choose a job</option>{jobs.map((j) => <option key={j.id} value={j.id}>{[j.project_number, j.name].filter(Boolean).join(" · ")}</option>)}</select></Row>
      <Row label="Description"><Input value={f.description} onChange={up("description")} /></Row>
      <div className="grid grid-cols-2 gap-2"><Row label="Quantity"><Input type="number" min="0" step="any" value={f.qty} onChange={up("qty")} /></Row><Row label="Unit"><Input value={f.unit} onChange={up("unit")} placeholder="BOX, SF, EA" /></Row></div>
      <Row label="Supplier"><select className={`${field} w-full`} value={f.supplier} onChange={up("supplier")}><option value="">None yet</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Row>
      <Row label="Unit cost ($)"><Input type="number" min="0" step="0.01" value={f.cost} onChange={up("cost")} /></Row>
      {err && <p role="alert" className="rounded bg-destructive/10 p-2 text-destructive">{err}</p>}
    </Shell>
  );
}
