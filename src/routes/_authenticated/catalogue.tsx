import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { Pencil, Plus, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssemblyDialog } from "@/components/catalogue/AssemblyDialog";
import { CostCell, CostCodeSelect, DeleteButton, F, MoneyInput, Unknown, UomSelect, selectCls } from "@/components/catalogue/fields";
import { MaterialDialog } from "@/components/catalogue/MaterialDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import {
  centsToInput,
  importMaterials,
  priceLabel,
  saveLabourRate,
  saveSupplier,
  saveTaxSettings,
  sellsMaterials,
  SUPPLIES,
  useCostCodes,
  useLabourRates,
  useMaterials,
  useRefreshCatalogue,
  useSuppliers,
  useTaxSettings,
  useTemplates,
  type LabourRate,
  type Material,
  type Supplier,
  type Supplies,
  type Template,
} from "@/lib/catalogue/data";
import { CATEGORIES, categoryLabel, parseMaterialRows, parseMoneyCents, planMaterialImport, type MaterialInput } from "@/lib/catalogue/logic";
import type { Uom } from "@/lib/estimating/calc";
import { isPriceListFile } from "@/lib/nav";
import { errText } from "@/lib/platform/db";
import { pullSummary } from "@/components/settings/QuickBooksPanel";
import { qboPullProducts } from "@/lib/qbo/qbo.functions";

export const Route = createFileRoute("/_authenticated/catalogue")({
  head: () => ({ meta: [{ title: "Catalogue — BMD Projects" }] }),
  component: CataloguePage,
});

const th = "px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const td = "px-4 py-3 align-middle";

function CataloguePage() {
  const { canAny } = useAuth();
  const canSee = canAny("view_pricing");
  const canEdit = canAny("manage_catalogue");
  const { data: materials = [], error } = useMaterials(canSee);
  const { data: labour = [] } = useLabourRates(canSee);
  const { data: suppliers = [] } = useSuppliers(canSee);
  const { data: templates = [] } = useTemplates(canSee);
  const { data: costCodes = [] } = useCostCodes(canSee);
  const { data: tax } = useTaxSettings(canSee);
  const refresh = useRefreshCatalogue();

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [material, setMaterial] = useState<Material | "new" | null>(null);
  const [rate, setRate] = useState<LabourRate | "new" | null>(null);
  const [supplier, setSupplier] = useState<Supplier | "new" | null>(null);
  const [vendorKind, setVendorKind] = useState<"" | Supplies>("");
  const [template, setTemplate] = useState<Template | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const pullFn = useServerFn(qboPullProducts);
  const [pulling, setPulling] = useState(false);
  /** Reads products and vendors from QuickBooks into the review area. The catalogue itself is not changed here. */
  const pullQuickBooks = async () => {
    setPulling(true);
    try {
      const r = await pullFn();
      if (r.ok) toast.success(`Read from QuickBooks: ${pullSummary(r.counts)}. They are held for review under Company settings → Integrations; nothing has been added to the catalogue yet.`, { duration: 9000 });
      else toast.error(r.reason === "error" ? r.message : `${r.message} Go to Company settings → Integrations.`, { duration: 9000 });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setPulling(false);
    }
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return materials.filter(
      (m) =>
        (showInactive || m.active) &&
        (!cat || m.category === cat) &&
        (!s || `${m.name} ${m.manufacturer ?? ""} ${m.colour ?? ""} ${m.sku ?? ""}`.toLowerCase().includes(s)),
    );
  }, [materials, q, cat, showInactive]);
  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? "—";
  const unconfirmed = materials.filter((m) => m.active && !m.uom_confirmed).length + labour.filter((l) => l.active && !l.uom_confirmed).length;
  const unknownCount = materials.filter((m) => m.active && m.unit_cost_cents == null).length + labour.filter((l) => l.active && l.unit_cost_cents == null).length;

  if (!canSee) return <p className="p-6 text-sm text-muted-foreground">You don't have access to the catalogue.</p>;

  const saved = () => {
    refresh();
    setMaterial(null);
    setRate(null);
    setSupplier(null);
    setTemplate(null);
  };

  return (
    <div>
      <PageHeader
        title="Catalogue"
        subtitle={[unknownCount ? `${unknownCount} ${unknownCount === 1 ? "price is" : "prices are"} still unknown` : null, unconfirmed ? `${unconfirmed} imported ${unconfirmed === 1 ? "item needs its" : "items need their"} unit confirmed` : null].filter(Boolean).join(" · ") || "Materials, labour rates and assemblies used to build estimates"}
      />
      <div className="p-4 md:p-6">
        {error && <p className="mb-3 text-sm text-destructive">Could not load the catalogue: {errText(error)}</p>}
        <Tabs defaultValue="materials">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="materials">Materials</TabsTrigger>
            <TabsTrigger value="labour">Labour</TabsTrigger>
            <TabsTrigger value="assemblies">Assemblies</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers &amp; subcontractors</TabsTrigger>
            <TabsTrigger value="tax">Tax rates</TabsTrigger>
          </TabsList>

          <TabsContent value="materials" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search materials…" className="h-11 w-full sm:w-64" />
              <select aria-label="Category" className={`${selectCls} sm:w-56`} value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
              </label>
              {canEdit && (
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" className="h-11" disabled={pulling} onClick={() => void pullQuickBooks()}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${pulling ? "animate-spin" : ""}`} aria-hidden /> {pulling ? "Reading QuickBooks…" : "Pull from QuickBooks"}
                  </Button>
                  <Button variant="outline" className="h-11" onClick={() => setImporting(true)}>
                    <Upload className="mr-2 h-4 w-4" /> Import price list
                  </Button>
                  <Button className="h-11" onClick={() => setMaterial("new")}>
                    <Plus className="mr-2 h-4 w-4" /> New material
                  </Button>
                </div>
              )}
            </div>
            {shown.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
                {materials.length === 0 ? "No materials yet. Add one, or import a supplier price list from Excel." : "No materials match."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="border-b border-border bg-muted/50">
                    <tr>
                      <th className={th}>Material</th>
                      <th className={th}>Category</th>
                      <th className={th}>Supplier</th>
                      <th className={th}>Price</th>
                      <th className={th}>Bought by</th>
                      <th className={th}>Waste</th>
                      <th className={th}>Cost code</th>
                      {canEdit && <th className={th} />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shown.map((m) => (
                      <tr key={m.id} className={m.active ? "hover:bg-muted/40" : "opacity-60"}>
                        <td className={td}>
                          <button type="button" onClick={() => setMaterial(m)} className="text-left font-medium hover:underline">
                            {m.name}
                          </button>
                          <div className="text-xs text-muted-foreground">{[m.manufacturer, m.product_line, m.colour, m.sku].filter(Boolean).join(" · ")}</div>
                          {!m.uom_confirmed && <ConfirmUnit onClick={() => setMaterial(m)} />}
                        </td>
                        <td className={td}>{categoryLabel(m.category)}</td>
                        <td className={td}>{supplierName(m.supplier_id)}</td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>
                          {canEdit ? <CostCell kind="material" id={m.id} name={m.name} cents={m.unit_cost_cents} uom={m.cost_uom} onSaved={refresh} /> : m.unit_cost_cents == null ? <Unknown /> : priceLabel(m.unit_cost_cents, m.cost_uom)}
                          {m.unit_cost_cents != null && <div className="text-xs text-muted-foreground">{m.pst_applies ? "plus PST" : "PST included"}</div>}
                        </td>
                        <td className={td}>
                          {m.purchase_uom}
                          {m.coverage_per_purchase_unit ? ` (${m.coverage_per_purchase_unit} ${m.coverage_uom ?? m.cost_uom})` : ""}
                        </td>
                        <td className={`${td} tabular-nums`}>{m.default_waste_pct}%</td>
                        <td className={td}>{m.cost_code ?? "—"}</td>
                        {canEdit && (
                          <td className={`${td} text-right`}>
                            <Button variant="outline" size="sm" className="h-9" onClick={() => setMaterial(m)} aria-label={`Edit ${m.name}`}>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="labour" className="space-y-3">
            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">Type a cost in the table and press Enter to save it. Use Edit to change the name, unit or cost code, or to delete.</p>
                <Button className="h-11" onClick={() => setRate("new")}>
                  <Plus className="mr-2 h-4 w-4" /> New labour rate
                </Button>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className={th}>Labour</th>
                    <th className={th}>Cost</th>
                    <th className={th}>Cost code</th>
                    {canEdit && <th className={th} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {labour.map((l) => (
                    <tr key={l.id} className={l.active ? "hover:bg-muted/40" : "opacity-60"}>
                      <td className={td}>
                        <button type="button" onClick={() => setRate(l)} className="text-left font-medium hover:underline">
                          {l.name}
                        </button>
                        {!l.uom_confirmed && <ConfirmUnit onClick={() => setRate(l)} />}
                      </td>
                      <td className={`${td} tabular-nums`}>{canEdit ? <CostCell kind="labour" id={l.id} name={l.name} cents={l.unit_cost_cents} uom={l.uom} onSaved={refresh} /> : l.unit_cost_cents == null ? <Unknown /> : priceLabel(l.unit_cost_cents, l.uom)}</td>
                      <td className={td}>{l.cost_code ?? "—"}</td>
                      {canEdit && (
                          <td className={`${td} text-right`}>
                            <Button variant="outline" size="sm" className="h-9" onClick={() => setRate(l)} aria-label={`Edit ${l.name}`}>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                            </Button>
                          </td>
                        )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="assemblies" className="space-y-3">
            {canEdit && (
              <div className="flex justify-end">
                <Button className="h-11" onClick={() => setTemplate("new")}>
                  <Plus className="mr-2 h-4 w-4" /> New assembly
                </Button>
              </div>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {templates.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setTemplate(t)} className="h-full w-full rounded-lg border border-border bg-card p-4 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <p className="font-semibold">
                      {t.name}
                      {!t.active && <span className="ml-2 text-xs font-normal text-muted-foreground">inactive</span>}
                      {canEdit && (
                        <span className="float-right inline-flex items-center text-xs font-medium text-primary">
                          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Edit
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Measured in {t.driver_uom} · waste {t.default_waste_pct}% · {t.cost_code ?? "no cost code"}
                    </p>
                    <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                      {t.components.map((c, i) => (
                        <li key={i}>{c.label}</li>
                      ))}
                    </ul>
                  </button>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="suppliers" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
                {([["", "All"], ["materials", "Materials"], ["labour", "Labour"], ["both", "Both"]] as const).map(([v, label]) => (
                  <Button key={v} size="sm" variant={vendorKind === v ? "default" : "outline"} className="h-9" aria-pressed={vendorKind === v} onClick={() => setVendorKind(v)}>
                    {label} ({(v ? suppliers.filter((s) => s.supplies === v) : suppliers).length})
                  </Button>
                ))}
              </div>
              {canEdit && (
                <Button className="h-11" onClick={() => setSupplier("new")}>
                  <Plus className="mr-2 h-4 w-4" /> New vendor
                </Button>
              )}
            </div>
            {suppliers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">No suppliers or subcontractors yet.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {suppliers.filter((s) => !vendorKind || s.supplies === vendorKind).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSupplier(s)} className="flex min-h-14 w-full flex-wrap items-center gap-x-4 px-4 py-3 text-left hover:bg-muted/60">
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{SUPPLIES.find((x) => x.value === s.supplies)?.short}</span>
                      <span className="truncate text-sm text-muted-foreground">{[s.contact_name, s.email, s.phone].filter(Boolean).join(" · ")}</span>
                      {canEdit && (
                        <span className="inline-flex items-center text-xs font-medium text-primary">
                          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Edit
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="tax">{tax && <TaxPanel tax={tax} canEdit={canEdit} onSaved={refresh} />}</TabsContent>
        </Tabs>
      </div>

      {material && (
        <MaterialDialog material={material === "new" ? null : material} suppliers={suppliers} costCodes={costCodes} canEdit={canEdit} onClose={() => setMaterial(null)} onSaved={saved} />
      )}
      {template && (
        <AssemblyDialog template={template === "new" ? null : template} materials={materials} labour={labour} costCodes={costCodes} canEdit={canEdit} onClose={() => setTemplate(null)} onSaved={saved} />
      )}
      {rate && <LabourDialog rate={rate === "new" ? null : rate} costCodes={costCodes} canEdit={canEdit} onClose={() => setRate(null)} onSaved={saved} />}
      {supplier && <SupplierDialog supplier={supplier === "new" ? null : supplier} canEdit={canEdit} onClose={() => setSupplier(null)} onSaved={saved} />}
      {importing && (
        <ImportDialog
          existing={materials}
          suppliers={suppliers}
          onClose={() => setImporting(false)}
          onDone={() => {
            refresh();
            setImporting(false);
          }}
        />
      )}
    </div>
  );
}

/** Shown on a record imported from QuickBooks until someone opens it, checks the unit and saves. */
function ConfirmUnit({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-0 mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200">
      Unit to confirm
    </button>
  );
}

function LabourDialog({ rate, costCodes, canEdit, onClose, onSaved }: { rate: LabourRate | null; costCodes: { code: string; name: string; qbo_item_id: string | null }[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rate?.name ?? "");
  const [uom, setUom] = useState<Uom>(rate?.uom ?? "SF");
  const [price, setPrice] = useState(centsToInput(rate?.unit_cost_cents ?? null));
  const [code, setCode] = useState<string | null>(rate?.cost_code ?? null);
  const [active, setActive] = useState(rate?.active ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const cents = price.trim() === "" ? null : parseMoneyCents(price);
    if (price.trim() !== "" && cents == null) return void toast.error("Enter the cost as a dollar amount, or leave it blank if unknown");
    setBusy(true);
    try {
      await saveLabourRate(rate?.id ?? null, { name: name.trim(), uom, unit_cost_cents: cents, cost_code: code, active, uom_confirmed: true });
      toast.success("Labour rate saved");
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{rate ? rate.name : "New labour rate"}</DialogTitle>
          <DialogDescription>What BMD pays to have one unit installed.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!canEdit} className="grid gap-4">
          <F label="Name">
            <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Cost">
              <MoneyInput value={price} onChange={setPrice} />
            </F>
            <F label="Per">
              <UomSelect value={uom} onChange={(v) => setUom(v as Uom)} />
            </F>
          </div>
          <F label="Cost code">
            <CostCodeSelect value={code} onChange={setCode} codes={costCodes} />
          </F>
          {rate && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
            </label>
          )}
        </fieldset>
        <DialogFooter>
          {canEdit && rate && <DeleteButton kind="labour" id={rate.id} name={rate.name} onDeleted={onSaved} />}
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button disabled={busy || !name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierDialog({ supplier, canEdit, onClose, onSaved }: { supplier: Supplier | null; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: supplier?.name ?? "",
    contact_name: supplier?.contact_name ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    account_number: supplier?.account_number ?? "",
    notes: supplier?.notes ?? "",
    active: supplier?.active ?? true,
    supplies: supplier?.supplies ?? ("materials" as Supplies),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      const n = (s: string) => s.trim() || null;
      await saveSupplier(supplier?.id ?? null, { name: f.name.trim(), contact_name: n(f.contact_name), email: n(f.email), phone: n(f.phone), account_number: n(f.account_number), notes: n(f.notes), active: f.active, supplies: f.supplies });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{supplier ? supplier.name : "New vendor"}</DialogTitle>
          <DialogDescription>Vendor names stay inside BMD; they never appear on a quote.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!canEdit} className="grid gap-4">
          <F label="Name">
            <Input className="h-11" value={f.name} onChange={set("name")} />
          </F>
          <F label="Supplies BMD with">
            <select className={selectCls} value={f.supplies} onChange={(e) => setF((cur) => ({ ...cur, supplies: e.target.value as Supplies }))}>
              {SUPPLIES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </F>
          <F label="Contact">
            <Input className="h-11" value={f.contact_name} onChange={set("contact_name")} />
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Email">
              <Input className="h-11" type="email" value={f.email} onChange={set("email")} />
            </F>
            <F label="Phone">
              <Input className="h-11" value={f.phone} onChange={set("phone")} />
            </F>
          </div>
          <F label="BMD account number">
            <Input className="h-11" value={f.account_number} onChange={set("account_number")} />
          </F>
          <F label="Notes">
            <Input className="h-11" value={f.notes} onChange={set("notes")} />
          </F>
        </fieldset>
        <DialogFooter>
          {canEdit && supplier && <DeleteButton kind="supplier" id={supplier.id} name={supplier.name} onDeleted={onSaved} />}
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button disabled={busy || !f.name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaxPanel({ tax, canEdit, onSaved }: { tax: { pst_pct: number; gst_pct: number; hst_pct: number }; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ pst: String(tax.pst_pct), gst: String(tax.gst_pct), hst: String(tax.hst_pct) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = { pst_pct: Number(f.pst), gst_pct: Number(f.gst), hst_pct: Number(f.hst) };
    if (Object.values(v).some((n) => !(n >= 0 && n <= 100))) return void toast.error("Each rate must be between 0 and 100%");
    setBusy(true);
    try {
      await saveTaxSettings(v);
      toast.success("Tax rates saved");
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="max-w-xl rounded-lg border border-border bg-card p-4 md:p-5">
      <p className="text-sm text-muted-foreground">
        PST is added to material costs that are flagged for it and stays inside BMD's cost; it is never shown to the client. Every quote line is charged GST unless
        the line is set to HST, exempt or zero-rated.
      </p>
      <fieldset disabled={!canEdit} className="mt-4 grid grid-cols-3 gap-3">
        <F label="PST %">
          <Input className="h-11" inputMode="decimal" value={f.pst} onChange={(e) => setF({ ...f, pst: e.target.value })} />
        </F>
        <F label="GST %">
          <Input className="h-11" inputMode="decimal" value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })} />
        </F>
        <F label="HST %">
          <Input className="h-11" inputMode="decimal" value={f.hst} onChange={(e) => setF({ ...f, hst: e.target.value })} />
        </F>
      </fieldset>
      {canEdit && (
        <Button className="mt-4 h-11" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save rates"}
        </Button>
      )}
    </section>
  );
}

function ImportDialog({ existing, suppliers, onClose, onDone }: { existing: Material[]; suppliers: Supplier[]; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ rows: MaterialInput[]; problems: string[]; fileName: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [over, setOver] = useState(false);
  const [accept, setAccept] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const plan = parsed ? planMaterialImport(parsed.rows, existing) : null;

  const read = async (file: File) => {
    setProblem(null);
    setParsed(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("The file has no sheets.");
      const out = parseMaterialRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
      if (out.rows.length === 0) throw new Error("No products were found in that file.");
      setParsed({ ...out, fileName: file.name });
      setAccept(new Set());
    } catch (e) {
      setProblem(errText(e));
    }
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const res = await importMaterials(parsed.rows, { supplier_id: supplierId || null, price_source: parsed.fileName }, accept);
      toast.success(`${res.added} added, ${res.repriced} repriced`);
      onDone();
    } catch (e) {
      toast.error(`Import failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import a supplier price list</DialogTitle>
          <DialogDescription>
            Excel or CSV with one product per row. New products are added. Price differences on products already here are listed for you to accept one by one; nothing
            is removed.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (!f) return;
            if (!isPriceListFile(f.name)) return setProblem(`${f.name} is not an Excel or CSV file.`);
            void read(f);
          }}
          className={`flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${over ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
        >
          <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="font-medium">{parsed ? parsed.fileName : "Drag a price list here"}</span>
          <span className="text-muted-foreground">
            {parsed ? "Drop another file here, or " : "or "}
            <span className="font-medium text-primary underline">browse for a file</span> (Excel or CSV)
          </span>
        </button>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {parsed && plan && (
          <div className="space-y-3 text-sm">
            <F label="Supplier for the new products">
              <select className={selectCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Not set</option>
                {suppliers.filter((s) => s.active && sellsMaterials(s)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </F>
            <p className="rounded-md border border-border bg-muted/40 p-3">
              <strong>{parsed.fileName}</strong>: {parsed.rows.length} products read. {plan.inserts.length} new, {plan.priceChanges.length} with a different price,{" "}
              {plan.unchanged} unchanged.
            </p>
            {parsed.problems.length > 0 && (
              <details className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                <summary className="cursor-pointer font-medium">{parsed.problems.length} rows need a look</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {parsed.problems.slice(0, 50).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
            {plan.priceChanges.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Price changes to accept</p>
                <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {plan.priceChanges.map((c) => (
                    <li key={c.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={accept.has(c.id)}
                          onChange={(e) => {
                            const next = new Set(accept);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            setAccept(next);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {c.fromCents == null ? "unknown" : `$${(c.fromCents / 100).toFixed(2)}`} → <strong className="text-foreground">${(c.toCents / 100).toFixed(2)}</strong>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!plan || busy || (plan.inserts.length === 0 && accept.size === 0)} onClick={() => void run()}>
            {busy ? "Importing…" : plan ? `Add ${plan.inserts.length}, reprice ${accept.size}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
