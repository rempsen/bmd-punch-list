import { Fragment, useMemo, useState } from "react";
import { ImportDialog } from "./ImportDialog";
import { ScopeProposals } from "./ScopeProposals";
import { finishLinks, offerQty, offerUom, takeoffOffers, totalsByFinish, useTakeoffQuantities, type Offer } from "@/lib/takeoff/quantities";
import { ArrowLeftRight, ChevronDown, ChevronRight, ClipboardPaste, Copy, GripVertical, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { selectCls } from "@/components/catalogue/fields";
import { CompareView, SwapFinishDialog } from "@/components/estimate/alternates";
import { AddLineDialog, PasteDialog, RefreshDialog, WindowScheduleDialog } from "@/components/estimate/dialogs";
import { FinishesPanel } from "@/components/estimate/FinishesPanel";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { saveMaterial, setUnitCost, useCostCodes, useLabourRates, useMaterials, useRefreshCatalogue, useSuppliers, useTaxSettings, useTemplates } from "@/lib/catalogue/data";
import { parseMoneyCents } from "@/lib/catalogue/logic";
import type { SnapComponent } from "@/lib/estimating/assemble";
import {
  catalogueView,
  copyVersion,
  createVersion,
  deleteLine,
  deleteVersion,
  dollars,
  isReload,
  saveFinish,
  saveLines,
  updateVersion,
  useEstimate,
  useFinishes,
  useRefreshEstimate,
  type EstLine,
  type EstVersion,
  type SaveItem,
} from "@/lib/estimating/data";
import { changeLineUnit, costInUnit, costTarget, lineFromFinish, lineWasteShown, partChoices, partFor, sectionChoices, setLineWaste, setPartCoverage, setPartWaste, simpleLine, unitChoices, wasteApplies, type PartKind } from "@/lib/estimating/lines";
import type { CatalogueView } from "@/lib/estimating/assemble";
import type { LabourRate, Material } from "@/lib/catalogue/data";
import type { Uom } from "@/lib/estimating/calc";
import { versionSummary, type Rates } from "@/lib/estimating/worksheet";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

const cell = "px-2 py-2 align-middle";
const numInput = "h-10 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent";

/** The project's estimate: Base and alternates, each a worksheet of priced lines. */
export function EstimateTab({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const canSee = canAny("view_pricing");
  const canEdit = canAny("manage_estimates");
  const { data: versions = [], isLoading, error } = useEstimate(projectId, canSee);
  const { data: finishes = [] } = useFinishes(projectId, canSee);
  const { data: materials = [] } = useMaterials(canSee);
  const { data: labour = [] } = useLabourRates(canSee);
  const { data: templates = [] } = useTemplates(canSee);
  const { data: suppliers = [] } = useSuppliers(canSee);
  const { data: costCodes = [] } = useCostCodes(canSee);
  const { data: tax } = useTaxSettings(canSee);
  const refresh = useRefreshEstimate(projectId);
  const refreshCatalogue = useRefreshCatalogue();
  const canCatalogue = canAny("manage_catalogue");
  const { data: measured } = useTakeoffQuantities(projectId, canSee);
  const takeoffTotals = useMemo(() => totalsByFinish(measured ?? []), [measured]);

  const estimates = versions.filter((v) => v.kind === "estimate");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Change orders are priced on the same worksheet, listed after the estimate prices.
  const shown = useMemo(() => [...estimates, ...versions.filter((v) => v.kind === "change_order")], [versions]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = shown.find((v) => v.id === activeId) ?? shown[0] ?? null;
  const [dialog, setDialog] = useState<"add" | "paste" | "windows" | "refresh" | "swap" | "import" | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ waste: "", markup: "" });
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);   // the line being dragged to another section
  const [dropOn, setDropOn] = useState<string | null>(null);

  const rates: Rates | null = tax ? { pstPct: tax.pst_pct, gstPct: tax.gst_pct, hstPct: tax.hst_pct } : null;
  const catalogue = useMemo(() => catalogueView(materials, labour), [materials, labour]);
  const summaries = useMemo(() => (rates ? Object.fromEntries(shown.map((v) => [v.id, versionSummary(v.lines, rates)])) : {}), [shown, rates]);

  if (!canSee) return <p className="text-sm text-muted-foreground">You don't have access to pricing on this project.</p>;
  if (isLoading || !rates) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Could not load the estimate: {errText(error)}</p>;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(isReload(e) ? errText(e).replace(/^RELOAD:\s*/, "") : errText(e));
    } finally {
      refresh();
      setBusy(false);
    }
  };
  const save = (items: SaveItem[], done?: string) => run(() => saveLines(items), done);
  /** Moves lines to another section (dragged there, picked on the line, or for everything selected). */
  const moveTo = (ids: string[], section: string) => {
    const name = section.trim();
    const moving = (active?.lines ?? []).filter((l) => ids.includes(l.id) && l.section !== name);
    setDragId(null);
    setDropOn(null);
    if (!name || moving.length === 0) return;
    void save(moving.map((l) => ({ id: l.id, row_version: l.row_version, line: { section: name } })), moving.length === 1 ? `Moved to ${name}` : `${moving.length} lines moved to ${name}`);
  };
  const askSection = () => window.prompt("Name for the new section", "")?.trim() ?? "";

  /**
   * A unit cost typed on a line. For a catalogue material, a labour rate or a finish it becomes the catalogue's price
   * (and so is queued for QuickBooks); a one-off stays on the line. Clearing a cost only clears it on the line.
   */
  const applyCost = (l: EstLine, i: number, cents: number | null) =>
    run(async () => {
      const c = l.components[i]!;
      const finish = finishes.find((f) => f.id === l.finish_id) ?? null;
      let target: ReturnType<typeof costTarget> = cents == null || !canCatalogue ? { kind: "line_only" } : costTarget(c, finish, l.components.length);
      // Another job may already have a catalogue material with this name. It is a different product, so it is not repriced from here.
      const newName = target.kind === "new_material" ? target.name.trim().toLowerCase() : null;
      const taken = newName != null && materials.some((m) => m.name.trim().toLowerCase() === newName);
      if (taken) target = { kind: "line_only" };
      let patch: Partial<SnapComponent> = { unit_cost_cents: cents, cost_overridden: cents != null };
      let said = cents == null ? "Cost cleared on this line" : "Cost saved on this line";
      if (target.kind === "material" || target.kind === "labour") {
        // The catalogue keeps each price in its own unit. A cost typed per SY for a material priced per SF is converted; an unrelated unit stays on the line.
        const id = target.id;
        const catUom = (target.kind === "material" ? materials.find((m) => m.id === id)?.cost_uom : labour.find((r) => r.id === id)?.uom) ?? c.cost_uom;
        const catCents = costInUnit(cents!, c.cost_uom, catUom);
        if (catCents == null) {
          said = `Cost saved on this line. The catalogue prices ${c.label} per ${catUom}, not per ${c.cost_uom}, so its price was not changed`;
          target = { kind: "line_only" };
        } else {
          await setUnitCost(target.kind, id, catCents);
          patch = { unit_cost_cents: cents, cost_overridden: false };
          said = `${dollars(catCents)} / ${catUom} is now the catalogue price for ${c.label}`;
        }
      } else if (target.kind === "new_material" && finish) {
        const id = await saveMaterial(null, {
          category: target.category as never, name: target.name, manufacturer: null, product_line: null, colour: null, sku: null, supplier_id: null, cost_uom: target.uom, unit_cost_cents: cents, purchase_uom: target.uom,
          coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: false, default_waste_pct: l.waste_pct, cost_code: l.cost_code, active: true, price_date: new Date().toISOString().slice(0, 10), price_source: "Entered on an estimate", notes: null, uom_confirmed: true,
        });
        await saveFinish(finish.id, { project_id: finish.project_id, tag: finish.tag, description: finish.description, assembly_template_id: finish.assembly_template_id, catalogue_material_id: id, sort_order: finish.sort_order });
        patch = { unit_cost_cents: cents, cost_overridden: false, catalogue_material_id: id, kind: "material", source: "catalogue" };
        said = `${target.name} added to the catalogue at ${dollars(cents!)} / ${target.uom}`;
      }
      await saveLines([{ id: l.id, row_version: l.row_version, line: {}, components: l.components.map((x, j) => (j === i ? { ...x, ...patch } : x)) }]);
      if (target.kind !== "line_only") refreshCatalogue();
      if (taken) toast.info(`${said}. The catalogue already has a material with this finish's name, so it was not changed. Pick the material on the finish above to link them.`, { duration: 9000 });
      else toast.success(target.kind === "line_only" ? said : `${said}. It will be sent to QuickBooks when that is connected.`);
    });

  /** A new line for something measured in the takeoff. It follows the takeoff until the estimator says otherwise. */
  const lineForOffer = (o: Offer, versionId: string, markupPct: number): SaveItem => {
    const finish = finishes.find((f) => f.id === o.finishId)!;
    const template = templates.find((t) => t.id === finish.assembly_template_id) ?? null;
    const uom = offerUom(o.measure, template?.driver_uom ?? null);
    const qty = offerQty(o.measure, uom);
    // The assembly prices the line when its unit fits what was measured. Otherwise the line goes on unpriced: an unknown cost is not zero.
    // What is measured in the takeoff is flooring unless the takeoff named an area for it.
    const section = o.section === "General" ? "Flooring" : o.section;
    const base = template && template.driver_uom === uom ? lineFromFinish({ versionId, finish, template, catalogue, qty, section, markupPct, source: "takeoff" }).item : simpleLine({ versionId, kind: "misc", section, description: [finish.tag, finish.description].filter(Boolean).join(" – "), qty, uom, unitCostCents: null, pst: false, markupPct, costCode: null });
    return { ...base, line: { ...base.line, finish_id: finish.id, source: "takeoff" } };
  };

  if (!active)
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="font-medium">No estimate yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Start the Base price. Alternates are made later by copying it.</p>
        {canEdit && (
          <Button className="mt-4 h-11" disabled={busy} onClick={() => void run(async () => setActiveId(await createVersion(projectId, "")))}>
            <Plus className="mr-2 h-4 w-4" /> Start the estimate
          </Button>
        )}
      </div>
    );

  const editable = canEdit && !active.locked;
  const sum = summaries[active.id]!;
  const sections = [...new Set(active.lines.map((l) => l.section))];
  const chosen = active.lines.filter((l) => selected.has(l.id));

  const applyBulk = () => {
    const waste = bulk.waste.trim() === "" ? null : Number(bulk.waste);
    const markup = bulk.markup.trim() === "" ? null : Number(bulk.markup);
    if ((waste != null && !(waste >= 0 && waste <= 100)) || (markup != null && !(markup >= 0 && markup <= 1000))) return void toast.error("Enter waste between 0 and 100 and markup between 0 and 1000");
    if (waste == null && markup == null) return;
    void save(
      chosen.map((l) => ({
        id: l.id,
        row_version: l.row_version,
        line: { ...(waste != null ? { waste_pct: waste } : {}), ...(markup != null ? { markup_pct: markup, price_basis: "markup" as const } : {}) },
        ...(waste != null ? { components: setLineWaste(l.components, waste) } : {}),
      })),
      `${chosen.length} lines updated`,
    ).then(() => {
      setSelected(new Set());
      setBulk({ waste: "", markup: "" });
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-stretch gap-3">
        {shown.map((v) => {
          const s = summaries[v.id]!;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={v.id === active.id}
              onClick={() => {
                setActiveId(v.id);
                setSelected(new Set());
              }}
              className={cn("min-w-52 rounded-lg border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", v.id === active.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50")}
            >
              <p className="text-sm font-semibold">
                {v.name}
                {v.kind === "change_order" && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Change order</span>}
                {v.locked && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{v.status === "accepted" ? "Accepted" : "Sent"}</span>}
              </p>
              {v.description && <p className="truncate text-xs text-muted-foreground">{v.description}</p>}
              <p className="mt-1 text-lg font-semibold tabular-nums">{dollars(s.totals.totalCents)}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                Cost {dollars(s.costCents)} · Sell {dollars(s.sellCents)} · Margin {s.marginPct.toFixed(1)}%
              </p>
              {s.unknownLines > 0 && <p className="mt-0.5 text-xs font-medium text-amber-700">{s.unknownLines} lines missing a cost</p>}
            </button>
          );
        })}
        {canEdit && (
          <Button
            variant="outline"
            className="h-auto min-h-11"
            disabled={busy}
            onClick={() => {
              const name = window.prompt("Name for the alternate", `Alternate ${estimates.length}`);
              if (name == null) return;
              const description = window.prompt("What is different about it? The client sees this on the quote, so keep it to what they should read (optional).", "") ?? "";
              void run(async () => setActiveId(await copyVersion(active.id, name, description || null)), "Alternate created");
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy as alternate
          </Button>
        )}
        {estimates.length > 1 && (
          <Button variant={comparing ? "default" : "outline"} className="h-auto min-h-11" aria-pressed={comparing} onClick={() => setComparing((c) => !c)}>
            Compare
          </Button>
        )}
      </div>

      {canEdit && !active.locked && measured && (() => {
        const offers = takeoffOffers(active.lines, takeoffTotals, finishes);
        if (offers.length === 0) return null;
        const qtyText = (o: Offer) => {
          const uom = offerUom(o.measure, templates.find((t) => t.id === finishes.find((f) => f.id === o.finishId)?.assembly_template_id)?.driver_uom ?? null);
          return `${offerQty(o.measure, uom).toLocaleString("en-CA")} ${uom}`;
        };
        return (
          <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 font-medium">Measured in the takeoff and not on {active.name || "this price"} yet. Quantities are as measured; set waste on the line.</p>
              {offers.length > 1 && (
                <Button size="sm" className="h-9" disabled={busy} onClick={() => void save(offers.map((o) => lineForOffer(o, active.id, active.default_markup_pct)), `${offers.length} lines added from the takeoff`)}>
                  Add all {offers.length}
                </Button>
              )}
            </div>
            <ul className="mt-2 space-y-1.5">
              {offers.map((o) => (
                <li key={`${o.finishId}|${o.section}`} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{o.tag}</span>
                    {o.section !== "General" ? ` · ${o.section}` : ""}: {qtyText(o)}
                  </span>
                  <Button size="sm" variant="outline" className="h-9 bg-white" disabled={busy} onClick={() => void save([lineForOffer(o, active.id, active.default_markup_pct)], `${o.tag} added from the takeoff`)}>
                    <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {canEdit && !active.locked && measured && (() => {
        const moved = finishLinks(active.lines, takeoffTotals).filter((l) => l.changed);
        if (moved.length === 0) return null;
        return (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">The takeoff has changed since these lines were priced. Each keeps its priced quantity until you accept the new one.</p>
            <ul className="mt-2 space-y-1.5">
              {moved.map((m) => {
                const line = active.lines.find((l) => l.id === m.lineId)!;
                return (
                  <li key={m.lineId} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {line.description}: priced at {m.pricedQty.toLocaleString("en-CA")} {line.driver_uom}, takeoff now {m.takeoffQty.toLocaleString("en-CA")} {line.driver_uom}
                    </span>
                    <Button size="sm" variant="outline" className="h-9 bg-white" disabled={busy} onClick={() => void save([{ id: line.id, row_version: line.row_version, line: { driver_qty: m.takeoffQty } }], "Quantity updated from the takeoff")}>
                      Accept {m.takeoffQty.toLocaleString("en-CA")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => void save([{ id: line.id, row_version: line.row_version, line: { detached: true } }], "Line no longer follows the takeoff")}>
                      Keep mine, stop following
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}
      {comparing && estimates.length > 1 && <CompareView versions={[...estimates].sort((a, b) => Number(b.is_base) - Number(a.is_base))} rates={rates} />}

      {active.locked && (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">This price has been {active.status === "accepted" ? "accepted" : "sent"} and is locked. Copy it as an alternate to keep working.</p>
      )}

      {canEdit && <ScopeProposals projectId={projectId} finishCount={finishes.length} onAccepted={refresh} />}
      <FinishesPanel projectId={projectId} finishes={finishes} templates={templates} materials={materials} suppliers={suppliers} costCodes={costCodes} canEdit={canEdit} canAddMaterial={canAny("manage_catalogue")} onChanged={refresh} />

      <section className="rounded-lg border border-border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <VersionName version={active} editable={editable} onSaved={refresh} />
          <div className="ml-auto flex flex-wrap gap-2">
            {editable && (
              <>
                <Button className="h-10" onClick={() => setDialog("add")}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add line
                </Button>
                <Button variant="outline" className="h-10" onClick={() => setDialog("windows")}>
                  Window schedule
                </Button>
                <Button variant="outline" className="h-10" onClick={() => setDialog("import")}>
                  Import prices
                </Button>
                <Button variant="outline" className="h-10" onClick={() => setDialog("paste")}>
                  <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste quantities
                </Button>
                <Button variant="outline" className="h-10" onClick={() => setDialog("swap")}>
                  <ArrowLeftRight className="mr-1.5 h-4 w-4" /> Swap finish
                </Button>
                <Button variant="outline" className="h-10" onClick={() => setDialog("refresh")}>
                  <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh prices
                </Button>
              </>
            )}
          </div>
        </header>

        {editable && chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-primary/5 px-4 py-2 text-sm">
            <span className="font-medium">{chosen.length} selected</span>
            <label className="flex items-center gap-2">
              Waste %
              <input aria-label="Waste for selected lines" className={numInput} inputMode="decimal" value={bulk.waste} onChange={(e) => setBulk({ ...bulk, waste: e.target.value })} />
            </label>
            <label className="flex items-center gap-2">
              Markup %
              <input aria-label="Markup for selected lines" className={numInput} inputMode="decimal" value={bulk.markup} onChange={(e) => setBulk({ ...bulk, markup: e.target.value })} />
            </label>
            <Button size="sm" disabled={busy} onClick={applyBulk}>
              Apply
            </Button>
            <label className="flex items-center gap-2">
              Move to
              <select
                aria-label="Move selected lines to a section"
                className={cn(selectCls, "h-9 w-44")}
                value=""
                disabled={busy}
                onChange={(e) => {
                  const to = e.target.value === "__new" ? askSection() : e.target.value;
                  if (to) moveTo([...selected], to);
                }}
              >
                <option value="">Choose a section…</option>
                {sectionChoices(sections).map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
                <option value="__new">New section…</option>
              </select>
            </label>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {active.lines.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No lines yet. Add the job's finishes above, then add a line for each area.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-2 py-2 font-medium">Line</th>
                  <th className="px-2 py-2 text-right font-medium">Quantity</th>
                  <th className="px-2 py-2 text-right font-medium">Waste %</th>
                  <th className="px-2 py-2 text-right font-medium">Unit cost</th>
                  <th className="px-2 py-2 text-right font-medium">Cost</th>
                  <th className="px-2 py-2 text-right font-medium whitespace-nowrap">Markup %</th>
                  <th className="px-2 py-2 text-right font-medium">Margin</th>
                  <th className="px-2 py-2 text-right font-medium">Sell</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => {
                  const lines = active.lines.filter((l) => l.section === section);
                  const sub = sum.sections.find((s) => s.section === section);
                  return (
                    <Fragment key={section}>
                      <tr
                        className={cn("border-y border-border bg-muted/50", dragId && dropOn === section && "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary")}
                        onDragOver={(e) => {
                          if (!dragId) return;
                          e.preventDefault();
                          setDropOn(section);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId) moveTo([dragId], section);
                        }}
                      >
                        <th colSpan={8} scope="rowgroup" className="px-3 py-1.5 text-left text-sm font-semibold">
                          {section}
                          {dragId && <span className="ml-2 text-xs font-normal text-muted-foreground">drop here to move it to {section}</span>}
                        </th>
                        <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums">{dollars(sub?.sellCents ?? 0)}</td>
                        <td />
                      </tr>
                      {lines.map((l) => (
                        <LineRows
                          key={l.id}
                          line={l}
                          priced={sum.priced[l.id]!}
                          editable={editable}
                          expanded={open.has(l.id)}
                          selected={selected.has(l.id)}
                          onToggle={() => setOpen((s) => toggle(s, l.id))}
                          onSelect={() => setSelected((s) => toggle(s, l.id))}
                          onSave={(line, components) => void save([{ id: l.id, row_version: l.row_version, line, ...(components ? { components } : {}) }])}
                          onCost={(i, cents) => void applyCost(l, i, cents)}
                          sections={sections}
                          materials={materials}
                          labour={labour}
                          catalogue={catalogue}
                          dragging={dragId != null}
                          dropTarget={dragId != null && dropOn === section}
                          onDragLine={(on) => {
                            setDragId(on ? l.id : null);
                            if (!on) setDropOn(null);
                          }}
                          onDragOverLine={() => setDropOn(section)}
                          onDropLine={() => dragId && moveTo([dragId], section)}
                          onMove={(to) => moveTo([l.id], to === "__new" ? askSection() : to)}
                          onOpen={() => setOpen((s) => (s.has(l.id) ? s : toggle(s, l.id)))}
                          onDelete={() => window.confirm(`Delete "${l.description || "this line"}"?`) && void run(() => deleteLine(l.id, l.row_version))}
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border text-sm">
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-right font-medium">
                    Subtotal
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{dollars(sum.costCents)}</td>
                  <td />
                  <td className="px-2 py-2 text-right tabular-nums">{sum.marginPct.toFixed(1)}%</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{dollars(sum.sellCents)}</td>
                  <td />
                </tr>
                {Object.entries(sum.totals.taxByCode)
                  .filter(([, cents]) => cents > 0)
                  .map(([code, cents]) => (
                    <tr key={code}>
                      <td colSpan={8} className="px-2 py-1 text-right text-muted-foreground">
                        {code} {code === "GST" ? rates.gstPct : rates.hstPct}%
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{dollars(cents)}</td>
                      <td />
                    </tr>
                  ))}
                <tr>
                  <td colSpan={8} className="px-2 py-2 text-right font-semibold">
                    Total
                  </td>
                  <td className="px-2 py-2 text-right text-base font-semibold tabular-nums">{dollars(sum.totals.totalCents)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {canEdit && !active.is_base && !active.locked && (
        <Button variant="ghost" className="text-destructive" onClick={() => window.confirm(`Delete ${active.name}? Its lines are removed. The Base and other alternates are not touched.`) && void run(() => deleteVersion(active.id), "Alternate deleted")}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete this alternate
        </Button>
      )}

      {dialog === "add" && <AddLineDialog version={active} finishes={finishes} templates={templates} catalogue={catalogue} costCodes={costCodes} sections={sections} onClose={() => setDialog(null)} onAdd={(items, note) => save(items, note).then(() => setDialog(null))} />}
      {dialog === "windows" && <WindowScheduleDialog version={active} sections={sections} onClose={() => setDialog(null)} onAdd={(items) => save(items, `${items.length} window types added`).then(() => setDialog(null))} />}
      {dialog === "import" && (
        <ImportDialog
          version={active}
          onClose={() => setDialog(null)}
          onDone={() => {
            refresh();
            setDialog(null);
          }}
        />
      )}
      {dialog === "paste" && <PasteDialog version={active} finishes={finishes} templates={templates} catalogue={catalogue} onClose={() => setDialog(null)} onAdd={(items) => save(items, `${items.length} lines added`).then(() => setDialog(null))} />}
      {dialog === "swap" && <SwapFinishDialog version={active} finishes={finishes} templates={templates} catalogue={catalogue} rates={rates} onClose={() => setDialog(null)} onApply={(items, note) => save(items, note).then(() => setDialog(null))} />}
      {dialog === "refresh" && <RefreshDialog version={active} catalogue={catalogue} rates={rates} onClose={() => setDialog(null)} onApply={(items) => save(items, "Prices refreshed").then(() => setDialog(null))} />}
    </div>
  );
}

const toggle = (s: Set<string>, id: string) => {
  const next = new Set(s);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

function VersionName({ version, editable, onSaved }: { version: EstVersion; editable: boolean; onSaved: () => void }) {
  const commit = async (patch: Parameters<typeof updateVersion>[1]) => {
    try {
      await updateVersion(version.id, patch);
      onSaved();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        key={`${version.id}-n`}
        aria-label="Name of this price"
        disabled={!editable}
        defaultValue={version.name}
        onBlur={(e) => e.target.value.trim() && e.target.value !== version.name && void commit({ name: e.target.value.trim() })}
        className="h-10 w-48 rounded-md border border-input bg-background px-2 text-sm font-semibold disabled:border-transparent disabled:bg-transparent"
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Default markup %
        <input
          key={`${version.id}-m`}
          disabled={!editable}
          inputMode="decimal"
          defaultValue={version.default_markup_pct}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (n >= 0 && n <= 1000 && n !== version.default_markup_pct) void commit({ default_markup_pct: n });
          }}
          className={numInput}
        />
      </label>
    </div>
  );
}

function LineRows({
  line,
  priced,
  editable,
  expanded,
  selected,
  onToggle,
  onSelect,
  onSave,
  onCost,
  onDelete,
  sections,
  materials,
  labour,
  catalogue,
  dragging,
  dropTarget,
  onDragLine,
  onDragOverLine,
  onDropLine,
  onMove,
  onOpen,
}: {
  line: EstLine;
  priced: ReturnType<typeof versionSummary>["priced"][string];
  editable: boolean;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onSave: (line: SaveItem["line"], components?: SnapComponent[]) => void;
  onCost: (index: number, cents: number | null) => void;
  onDelete: () => void;
  sections: string[];
  materials: Material[];
  labour: LabourRate[];
  catalogue: CatalogueView;
  dragging: boolean;
  dropTarget: boolean;
  onDragLine: (on: boolean) => void;
  onDragOverLine: () => void;
  onDropLine: () => void;
  onMove: (section: string) => void;
  onOpen: () => void;
}) {
  const fixed = line.price_basis === "fixed_sell";
  const commitNumber = (raw: string, current: number, max: number, make: (n: number) => [SaveItem["line"], SnapComponent[]?]) => {
    const n = Number(raw.replace(/,/g, ""));
    if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > max) return void toast.error("Enter a number in range");
    if (n !== current) onSave(...make(n));
  };
  const saveComponent = (i: number, p: Partial<SnapComponent>) => onSave({}, line.components.map((c, j) => (j === i ? { ...c, ...p } : c)));
  /** Adds install labour, adhesive or prep to this line, from the catalogue or with its cost still to type. */
  const addPart = (kind: PartKind, value: string) => {
    const pick = value === "__unknown" ? null : (partChoices(kind, materials, labour, line.driver_uom).find((c) => `${c.type}:${c.id}` === value) ?? null);
    if (value !== "__unknown" && !pick) return;
    const next = Math.max(0, ...line.components.map((c) => c.sort_order)) + 1;
    onSave({}, [...line.components, partFor(kind, pick, line.driver_uom, catalogue, next)]);
    onOpen();
    toast.success(pick ? `${pick.name} added to ${line.description || "the line"}` : `Added. Type its cost in the list below the line.`);
  };
  const commitCost = (i: number, raw: string) => {
    const c = line.components[i]!;
    const cents = raw.trim() === "" ? null : parseMoneyCents(raw);
    if (raw.trim() !== "" && cents == null) return void toast.error("Enter the cost in dollars, or leave it blank if unknown");
    if (cents !== c.unit_cost_cents) onCost(i, cents);
  };
  /** Waste typed on one part. On the line's main part it is the line's waste; it is kept on the line and never changes the catalogue. */
  const commitPartWaste = (i: number, raw: string) => {
    const c = line.components[i]!;
    commitNumber(raw, wasteApplies(c) ? c.waste_pct : 0, 100, (n) => {
      const r = setPartWaste(line.components, i, n);
      return [r.lineWastePct == null ? {} : { waste_pct: r.lineWastePct }, r.components];
    });
  };
  const commitCoverage = (i: number, raw: string) => {
    const n = Number(raw.replace(/,/g, ""));
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) return void toast.error("Enter how much one covers, above zero");
    if (n !== line.components[i]!.coverage_per_purchase_unit) onSave({}, setPartCoverage(line.components, i, n));
  };
  /** A selling price set by hand (an imported line). Blank means not known yet, never zero. */
  const commitFixedSell = (raw: string) => {
    const cents = raw.trim() === "" ? null : parseMoneyCents(raw);
    if (raw.trim() !== "" && cents == null) return void toast.error("Enter the selling price in dollars, or leave it blank if unknown");
    if (cents !== line.fixed_sell_cents) onSave({ fixed_sell_cents: cents });
  };
  const wasteShown = lineWasteShown(line.waste_pct, line.components);
  // A line made of one thing has its unit cost right on the row. A line made of several opens to show each.
  const needed = line.components.map((c, i) => ({ c, i })).filter((x) => !x.c.not_applicable);
  const single = needed.length === 1 ? needed[0]! : null;

  return (
    <>
      <tr
        className={cn("border-b border-border", !priced.included && "opacity-60", dropTarget && "bg-primary/5")}
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          onDragOverLine();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDropLine();
        }}
      >
        <td className={cell}>
          <div className="flex items-center gap-1">
            {editable && (
              <span
                draggable
                role="img"
                aria-label={`Drag ${line.description || "this line"} to another section`}
                title="Drag to another section"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", line.description || "line");
                  onDragLine(true);
                }}
                onDragEnd={() => onDragLine(false)}
                className="grid h-9 w-5 cursor-grab place-items-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" aria-hidden />
              </span>
            )}
            {editable && <input type="checkbox" aria-label={`Select ${line.description}`} className="h-4 w-4" checked={selected} onChange={onSelect} />}
            <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} what makes up ${line.description}`} onClick={onToggle} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </td>
        <td className={cell}>
          <input
            key={`${line.id}-d-${line.row_version}`}
            aria-label="Description"
            disabled={!editable}
            defaultValue={line.description}
            onBlur={(e) => e.target.value !== line.description && onSave({ description: e.target.value })}
            className="h-10 w-full min-w-48 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-input focus:border-input disabled:hover:border-transparent"
          />
          <div className="flex flex-wrap items-center gap-x-2 px-2 text-xs text-muted-foreground">
            <span>{line.cost_code ?? "No cost code"}</span>
            {editable && (
              <select aria-label={`Section for ${line.description || "this line"}`} value={line.section} onChange={(e) => onMove(e.target.value)} className="h-7 max-w-40 rounded border border-transparent bg-transparent px-1 text-xs hover:border-input">
                {sectionChoices(sections).map((x) => (
                  <option key={x} value={x}>
                    in {x}
                  </option>
                ))}
                <option value="__new">New section…</option>
              </select>
            )}
            {editable && !fixed && (
              <span className="inline-flex items-center gap-1">
                {(["install", "adhesive", "prep"] as const).map((kind) => (
                  <select key={kind} aria-label={`Add ${kind} to ${line.description || "this line"}`} value="" onChange={(e) => e.target.value && addPart(kind, e.target.value)} className="h-7 w-20 rounded border border-input bg-background px-1 text-xs">
                    <option value="">+ {kind === "install" ? "Install" : kind === "adhesive" ? "Adhesive" : "Prep"}</option>
                    {partChoices(kind, materials, labour, line.driver_uom).map((c) => (
                      <option key={c.id} value={`${c.type}:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                    <option value="__unknown">Not in the catalogue yet (type the cost)</option>
                  </select>
                ))}
              </span>
            )}
            {line.source !== "manual" && <span>· from {line.source}</span>}
            {line.selection !== "required" && <span>· {line.selection === "optional" ? "optional" : `choose one (${line.selection_group ?? "group"})`}</span>}
            {fixed && <span>· selling price set by hand</span>}
            {(priced.unknown || priced.error) && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                <TriangleAlert className="h-3 w-3" /> {priced.error ?? `Cost missing: ${priced.unknownLabels.join(", ")}`}
              </span>
            )}
          </div>
        </td>
        <td className={cn(cell, "whitespace-nowrap text-right")}>
          <input key={`${line.id}-q-${line.row_version}`} aria-label="Quantity" disabled={!editable} inputMode="decimal" defaultValue={line.driver_qty} onBlur={(e) => commitNumber(e.target.value, line.driver_qty, 1e9, (n) => [{ driver_qty: n }])} className={cn(numInput, "w-20")} />
          <select
            key={`${line.id}-uom-${line.row_version}`}
            aria-label={`Unit of measure for ${line.description || "this line"}`}
            disabled={!editable || fixed || unitChoices(line.driver_uom, line.components.length).length < 2}
            value={line.driver_uom}
            onChange={(e) => {
              try {
                const r = changeLineUnit({ driver_qty: line.driver_qty, driver_uom: line.driver_uom }, line.components, e.target.value as Uom);
                onSave(r.line, r.components);
                toast.success(r.converted ? `Changed to ${r.line.driver_uom}. The quantity and cost were converted, so the line total is the same.` : `Changed to ${r.line.driver_uom}. The quantity and cost are as typed; check they are right per ${r.line.driver_uom}.`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              }
            }}
            className="ml-1 h-10 rounded-md border border-input bg-background px-1 text-xs disabled:border-transparent disabled:bg-transparent disabled:opacity-100"
          >
            {unitChoices(line.driver_uom, line.components.length).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </td>
        <td className={cn(cell, "text-right")}>
          <input key={`${line.id}-w-${line.row_version}`} aria-label="Waste percent" disabled={!editable || fixed} inputMode="decimal" defaultValue={wasteShown} onBlur={(e) => commitNumber(e.target.value, wasteShown, 100, (n) => [{ waste_pct: n }, setLineWaste(line.components, n)])} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={numInput} />
        </td>
        <td className={cn(cell, "text-right")}>
          {single && !fixed ? (
            (editable || single.c.unit_cost_cents != null) && (
              <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                <span className="text-xs text-muted-foreground">$</span>
                <input
                  key={`${line.id}-u-${line.row_version}`}
                  aria-label={`Unit cost of ${line.description || single.c.label} per ${single.c.cost_uom}`}
                  disabled={!editable}
                  inputMode="decimal"
                  placeholder="Add cost"
                  defaultValue={single.c.unit_cost_cents == null ? "" : (single.c.unit_cost_cents / 100).toFixed(2)}
                  onBlur={(e) => commitCost(single.i, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={cn(numInput, "w-20", single.c.unit_cost_cents == null && "border-amber-400 bg-amber-50 placeholder:text-amber-800")}
                />
                <span className="w-9 text-left text-xs text-muted-foreground">/ {single.c.cost_uom}</span>
              </div>
            )
          ) : (
            line.components.length > 0 && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={onToggle}
                title={priced.unknown ? "Some costs are not known yet" : "Show each part and its unit cost"}
                className={cn("h-10 whitespace-nowrap rounded-md border px-2 text-xs", priced.unknown ? "border-amber-400 bg-amber-50 font-medium text-amber-800 hover:bg-amber-100" : "border-transparent text-muted-foreground hover:border-input hover:text-foreground")}
              >
                {expanded ? "Hide parts" : priced.unknown && editable ? "Add costs" : `${needed.length} ${needed.length === 1 ? "part" : "parts"}`}
              </button>
            )
          )}
        </td>
        <td className={cn(cell, "whitespace-nowrap text-right tabular-nums", priced.unknown && "font-medium text-amber-800")} title={priced.unknown ? "Some costs are not known yet, so this is not the whole cost" : undefined}>
          {dollars(priced.costCents)}
          {priced.unknown ? "+" : ""}
        </td>
        <td className={cn(cell, "text-right")}>
          {fixed ? (
            <span className="tabular-nums text-muted-foreground">{priced.unknown ? "—" : priced.markupPct.toFixed(1)}</span>
          ) : (
            <input key={`${line.id}-m-${line.row_version}`} aria-label="Markup percent" disabled={!editable} inputMode="decimal" defaultValue={line.price_basis === "margin" ? priced.markupPct : line.markup_pct} onBlur={(e) => commitNumber(e.target.value, line.price_basis === "margin" ? priced.markupPct : line.markup_pct, 1000, (n) => [{ markup_pct: n, price_basis: "markup" }])} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={numInput} />
          )}
        </td>
        <td className={cn(cell, "text-right tabular-nums text-muted-foreground")}>{priced.unknown ? "—" : `${priced.marginPct.toFixed(1)}%`}</td>
        <td className={cn(cell, "whitespace-nowrap text-right font-medium tabular-nums")}>
          {fixed && editable ? (
            <>
              <span className="text-xs font-normal text-muted-foreground">$ </span>
              <input
                key={`${line.id}-fs-${line.row_version}`}
                aria-label={`Selling price of ${line.description || "this line"}`}
                inputMode="decimal"
                placeholder="Set price"
                defaultValue={line.fixed_sell_cents == null ? "" : (line.fixed_sell_cents / 100).toFixed(2)}
                onBlur={(e) => commitFixedSell(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={cn(numInput, "w-28 font-medium")}
              />
            </>
          ) : (
            dollars(priced.sellCents)
          )}
        </td>
        <td className="px-1">
          {editable && (
            <button type="button" aria-label={`Delete ${line.description}`} onClick={onDelete} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-muted/30">
          <td />
          <td colSpan={9} className="px-3 py-3">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Made up of</th>
                  <th className="py-1 text-right font-medium">Unit cost</th>
                  <th className="py-1 text-right font-medium">Order</th>
                  <th className="py-1 text-right font-medium">Waste %</th>
                  <th className="py-1 text-right font-medium">Cost</th>
                  <th className="py-1 pl-4 font-medium">Not needed</th>
                </tr>
              </thead>
              <tbody>
                {line.components.map((c, i) => (
                  <tr key={i} className={c.not_applicable ? "opacity-50" : undefined}>
                    <td className="py-1">
                      {c.label}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.kind === "labour" ? "labour" : c.pst_applies ? "plus PST" : ""}
                        {c.cost_overridden ? " · typed here" : ""}
                      </span>
                    </td>
                    <td className="py-1">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <span className="text-xs text-muted-foreground">$</span>
                        <input
                          key={`${line.id}-c${i}-${line.row_version}`}
                          aria-label={`Unit cost of ${c.label}`}
                          disabled={!editable}
                          inputMode="decimal"
                          placeholder="Unknown"
                          defaultValue={c.unit_cost_cents == null ? "" : (c.unit_cost_cents / 100).toFixed(2)}
                          onBlur={(e) => commitCost(i, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          className={cn(numInput, "w-24")}
                        />
                        <span className="w-12 text-left text-xs text-muted-foreground">/ {c.cost_uom}</span>
                      </div>
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {priced.components[i]!.purchaseQty.toLocaleString("en-CA")} {c.purchase_uom}
                      {c.coverage_per_purchase_unit != null && (
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          one covers
                          <input
                            key={`${line.id}-cv${i}-${line.row_version}`}
                            aria-label={`${line.driver_uom} covered by one ${c.purchase_uom} of ${c.label}`}
                            disabled={!editable}
                            inputMode="decimal"
                            defaultValue={c.coverage_per_purchase_unit}
                            onBlur={(e) => commitCoverage(i, e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            className={cn(numInput, "h-8 w-20 text-xs")}
                          />
                          {line.driver_uom}
                        </div>
                      )}
                    </td>
                    <td className="py-1 text-right">
                      <input
                        key={`${line.id}-w${i}-${line.row_version}`}
                        aria-label={`Waste percent on ${c.label}`}
                        disabled={!editable || fixed}
                        inputMode="decimal"
                        defaultValue={wasteApplies(c) ? c.waste_pct : 0}
                        onBlur={(e) => commitPartWaste(i, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        className={numInput}
                      />
                    </td>
                    <td className="py-1 text-right tabular-nums">{c.unit_cost_cents == null && !c.not_applicable ? "Unknown" : dollars(priced.components[i]!.costCents)}</td>
                    <td className="py-1 pl-4">
                      <input type="checkbox" aria-label={`${c.label} is not needed on this line`} className="h-4 w-4" disabled={!editable} checked={c.not_applicable} onChange={(e) => saveComponent(i, { not_applicable: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {editable && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  Section
                  <input key={`${line.id}-s-${line.row_version}`} defaultValue={line.section} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== line.section && onSave({ section: e.target.value.trim() })} className="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm" />
                </label>
                <label className="flex items-center gap-1.5">
                  Client choice
                  <select className={cn(selectCls, "h-9 w-36")} value={line.selection} onChange={(e) => onSave({ selection: e.target.value as EstLine["selection"], ...(e.target.value === "choose_one" && !line.selection_group ? { selection_group: line.section } : {}) })}>
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                    <option value="choose_one">Choose one</option>
                  </select>
                </label>
                {line.selection === "choose_one" && (
                  <label className="flex items-center gap-1.5">
                    Group
                    <input key={`${line.id}-g-${line.row_version}`} defaultValue={line.selection_group ?? ""} onBlur={(e) => e.target.value.trim() !== (line.selection_group ?? "") && onSave({ selection_group: e.target.value.trim() || null })} className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm" />
                  </label>
                )}
                <label className="flex items-center gap-1.5">
                  Tax
                  <select className={cn(selectCls, "h-9 w-28")} value={line.tax_code} onChange={(e) => onSave({ tax_code: e.target.value as EstLine["tax_code"] })}>
                    <option value="GST">GST</option>
                    <option value="HST">HST</option>
                    <option value="EXEMPT">Exempt</option>
                    <option value="ZERO">Zero-rated</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" className="h-4 w-4" checked={line.subject_to_measure} onChange={(e) => onSave({ subject_to_measure: e.target.checked })} /> Subject to final measure
                </label>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
