import { Fragment, useEffect, useMemo, useState } from "react";
import { ImportDialog } from "./ImportDialog";
import { ScopeProposals } from "./ScopeProposals";
import { areasText, lineAreas, useTakeoffAreas, useTakeoffWalls } from "@/lib/takeoff/areas";
import { edgeText, lineWallEdges, type WallEdges } from "@/lib/takeoff/walls";
import { finishLinks, offerQty, offerUom, takeoffOffers, totalsByFinish, useTakeoffQuantities, type Offer } from "@/lib/takeoff/quantities";
import { ArrowLeftRight, ChevronDown, ChevronRight, ClipboardPaste, Copy, GripVertical, History, LockOpen, Plus, RefreshCw, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { ChangesSheet, keyCommit, TypedBadge, UnlockDialog, UnlockedBar } from "@/components/estimate/editing";
import { categoryMarkup, followsCategory, marginToMarkup, markupFromSell, markupToMargin, ORDER_UNITS, parseMargin, perUnit, revertPatch } from "@/lib/estimating/overrides";
import { UOMS } from "@/lib/catalogue/logic";
import { staffName, useBmdStaff } from "@/lib/projects/data";
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
  isEditable,
  isReload,
  logChanges,
  markReverted,
  relockVersion,
  saveFinish,
  unlockVersion,
  useAcceptedQuotes,
  useEstimateChanges,
  type EstChange,
  type NewChange,
  saveLines,
  updateVersion,
  useEstimate,
  useFinishes,
  useRefreshEstimate,
  type EstLine,
  type EstVersion,
  type SaveItem,
} from "@/lib/estimating/data";
import { changeLineUnit, costInUnit, costTarget, lineFromFinish, lineWasteShown, partChoices, partFor, sectionChoices, setLineWaste, setPartCoverage, setPartWaste, simpleLine, unitChoices, wasteApplies, type PartKind, answerExtra, extrasOf, templateForOffer } from "@/lib/estimating/lines";
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
  const { canAny, user } = useAuth();
  const canUnlock = canAny("manage_projects");
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
  const { data: measured } = useTakeoffQuantities(projectId, canSee);
  const takeoffTotals = useMemo(() => totalsByFinish(measured ?? []), [measured]);
  // Base by area (suites, common areas, washrooms) under each line that follows the takeoff in LF. A view setting,
  // remembered on this computer; it never changes a quantity or a price.
  const { data: takeoffAreas } = useTakeoffAreas(projectId, canSee);
  const { data: takeoffWalls } = useTakeoffWalls(projectId, canSee);
  const [byArea, setByArea] = useState(true);
  useEffect(() => {
    try {
      setByArea(window.localStorage.getItem(BY_AREA_KEY) !== "off");
    } catch {
      /* storage blocked: the breakdown just starts shown */
    }
  }, []);
  const toggleByArea = () => {
    const next = !byArea;
    setByArea(next);
    try {
      window.localStorage.setItem(BY_AREA_KEY, next ? "on" : "off");
    } catch {
      /* not remembered */
    }
  };

  const estimates = versions.filter((v) => v.kind === "estimate");
  const [activeId, setActiveId] = useState<string | null>(null);
  // Change orders are priced on the same worksheet, listed after the estimate prices.
  const shown = useMemo(() => [...estimates, ...versions.filter((v) => v.kind === "change_order")], [versions]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = shown.find((v) => v.id === activeId) ?? shown[0] ?? null;
  const [dialog, setDialog] = useState<"add" | "paste" | "windows" | "refresh" | "swap" | "import" | "unlock" | "changes" | null>(null);
  const { data: changes = [] } = useEstimateChanges(active?.id ?? null, canSee);
  const { data: acceptedQuotes = [] } = useAcceptedQuotes(projectId, canSee);
  const { data: staff = [] } = useBmdStaff(canSee);
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
  /** Saves lines and records what was typed in the change history. */
  const saveLogged = (items: SaveItem[], log: NewChange[], done?: string) =>
    run(async () => {
      await saveLines(items);
      await logChanges(log, user?.id ?? null);
    }, done);
  const changeFor = (l: EstLine, field: string, field_label: string, from_value: unknown, to_value: unknown, component_index: number | null = null): NewChange => ({ version_id: l.version_id, line_id: l.id, component_index, line_label: l.description, field, field_label, from_value, to_value });

  /** A unit cost typed on a part. It stays on this line ("typed here") until pushed to the catalogue or reset from it. */
  const typeCost = (l: EstLine, i: number, cents: number | null) => {
    const c = l.components[i]!;
    const patch: Partial<SnapComponent> = { unit_cost_cents: cents, cost_overridden: cents != null, overridden_by: null, overridden_at: null };
    void saveLogged(
      [{ id: l.id, row_version: l.row_version, line: {}, components: l.components.map((x, j) => (j === i ? { ...x, ...patch } : x)) }],
      [changeFor(l, "unit_cost_cents", `${c.label}: unit cost`, { unit_cost_cents: c.unit_cost_cents, cost_overridden: c.cost_overridden }, { unit_cost_cents: cents, cost_overridden: cents != null }, i)],
      cents == null ? "Cost cleared on this line" : undefined,
    );
  };
  /** Puts a part back to the catalogue's current price and unit. */
  const resetFromCatalogue = (l: EstLine, i: number) => {
    const c = l.components[i]!;
    const m = c.catalogue_material_id ? catalogue.materials[c.catalogue_material_id] : null;
    const r = c.labour_rate_id ? catalogue.labour[c.labour_rate_id] : null;
    if (!m && !r) return;
    const patch: Partial<SnapComponent> = m
      ? { unit_cost_cents: m.unit_cost_cents, cost_uom: m.cost_uom, purchase_uom: m.purchase_uom, cost_overridden: false, order_uom: null, order_uom_factor: null, price_per: "cost_unit" }
      : { unit_cost_cents: r!.unit_cost_cents, cost_uom: r!.uom, purchase_uom: r!.uom, cost_overridden: false };
    void saveLogged(
      [{ id: l.id, row_version: l.row_version, line: {}, components: l.components.map((x, j) => (j === i ? { ...x, ...patch } : x)) }],
      [changeFor(l, "reset_from_catalogue", `${c.label}: reset from catalogue`, { unit_cost_cents: c.unit_cost_cents, cost_uom: c.cost_uom, cost_overridden: c.cost_overridden }, { unit_cost_cents: patch.unit_cost_cents ?? null }, i)],
      `${c.label} reset to the catalogue price`,
    );
  };
  /** A typed part edit other than its cost (cost unit, order unit, conversion, priced per). */
  const typePart = (l: EstLine, i: number, patch: Partial<SnapComponent>, label: string) => {
    const c = l.components[i]!;
    const from = Object.fromEntries(Object.keys(patch).map((k) => [k, (c as Record<string, unknown>)[k] ?? null]));
    void saveLogged([{ id: l.id, row_version: l.row_version, line: {}, components: l.components.map((x, j) => (j === i ? { ...x, ...patch } : x)) }], [changeFor(l, Object.keys(patch).join(","), `${c.label}: ${label}`, from, patch, i)]);
  };
  /** A line-level figure: markup, margin, sell, or the line's unit cost. */
  const typeLine = (l: EstLine, patch: SaveItem["line"], field: string, label: string, done?: string) => {
    const from = Object.fromEntries(Object.keys(patch).map((k) => [k, (l as Record<string, unknown>)[k] ?? null]));
    void saveLogged([{ id: l.id, row_version: l.row_version, line: patch }], [changeFor(l, field, label, from, patch)], done);
  };
  const revert = (c: EstChange) => {
    const l = active?.lines.find((x) => x.id === c.line_id);
    if (!l) return void toast.error("That line is no longer on this price");
    const p = revertPatch(c, l.components);
    if (!p) return void toast.error("This change cannot be reverted");
    void run(async () => {
      await saveLines([{ id: l.id, row_version: l.row_version, line: p.line as SaveItem["line"], ...(p.components ? { components: p.components } : {}) }]);
      await markReverted(c.id, user?.id ?? null);
    }, "Change reverted");
  };

  /** "Push to catalogue": the cost typed on a part becomes the catalogue's price, and is queued for QuickBooks. */
  const pushToCatalogue = (l: EstLine, i: number) =>
    run(async () => {
      const c = l.components[i]!;
      const cents = c.unit_cost_cents;
      const finish = finishes.find((f) => f.id === l.finish_id) ?? null;
      let target: ReturnType<typeof costTarget> = cents == null ? { kind: "line_only" } : costTarget(c, finish, l.components.length);
      if (target.kind === "line_only") throw new Error(`${c.label} is not linked to a catalogue item, so its cost stays on this line`);
      // Another job may already have a catalogue material with this name. It is a different product, so it is not repriced from here.
      const newName = target.kind === "new_material" ? target.name.trim().toLowerCase() : null;
      const taken = newName != null && materials.some((m) => m.name.trim().toLowerCase() === newName);
      if (taken) target = { kind: "line_only" };
      let patch: Partial<SnapComponent> = { unit_cost_cents: cents, cost_overridden: true };
      let said = "Cost kept on this line";
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
      await logChanges([changeFor(l, "push_to_catalogue", `${c.label}: pushed to catalogue`, null, { unit_cost_cents: cents })], user?.id ?? null);
      if (target.kind !== "line_only") refreshCatalogue();
      if (taken) toast.info(`${said}. The catalogue already has a material with this finish's name, so it was not changed. Pick the material on the finish above to link them.`, { duration: 9000 });
      else toast.success(target.kind === "line_only" ? said : `${said}. It will be sent to QuickBooks when that is connected.`);
    });

  /** A new line for something measured in the takeoff. It follows the takeoff until the estimator says otherwise. */
  const lineForOffer = (o: Offer, versionId: string, markupPct: number): SaveItem => {
    const finish = finishes.find((f) => f.id === o.finishId)!;
    // Walls measured in the takeoff are priced with the wall tile assembly: wall install labour and its Schluter question.
    const template = templateForOffer(templates.find((t) => t.id === finish.assembly_template_id) ?? null, o.section, templates);
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

  const editable = canEdit && isEditable(active);
  const unlocked = active.locked && active.unlocked_at != null;
  const quote = acceptedQuotes.find((q) => q.accepted_version_id === active.id);
  const changedSinceUnlock = unlocked && changes.some((c) => c.changed_at > active.unlocked_at! && c.line_id != null && !c.reverted_at);
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
        line: { ...(waste != null ? { waste_pct: waste } : {}), ...(markup != null ? { markup_pct: markup, price_basis: "markup" as const, markup_overridden: true, sell_override_cents: null } : {}) },
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

      {active.locked && !unlocked && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
          <p className="min-w-0 flex-1">This price has been {active.status === "accepted" ? "accepted" : "sent"} and is locked. Copy it as an alternate to keep working.</p>
          {canUnlock && canEdit && (
            <Button size="sm" variant="outline" className="h-9" onClick={() => setDialog("unlock")}>
              <LockOpen className="mr-1.5 h-4 w-4" /> Unlock to fix an error
            </Button>
          )}
        </div>
      )}
      {unlocked && (
        <UnlockedBar
          by={staffName(staff, active.unlocked_by ?? undefined) ?? "someone"}
          reason={active.unlock_reason ?? ""}
          canRelock={canUnlock}
          onRelock={() => void run(() => relockVersion(active.id), "Price re-locked")}
          projectId={projectId}
          quoteMismatch={quote && changedSinceUnlock ? `This price has been changed since quote ${quote.number ?? ""} was accepted${quote.accepted_value_cents != null ? ` at ${dollars(quote.accepted_value_cents)}` : ""}, so the quote total no longer matches.` : null}
        />
      )}

      {canEdit && <ScopeProposals projectId={projectId} finishCount={finishes.length} onAccepted={refresh} />}
      <FinishesPanel projectId={projectId} finishes={finishes} templates={templates} materials={materials} suppliers={suppliers} costCodes={costCodes} canEdit={canEdit} canAddMaterial={canAny("manage_catalogue")} onChanged={refresh} />

      <section className="rounded-lg border border-border bg-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <VersionName version={active} editable={editable} onSaved={refresh} />
          <div className="ml-auto flex flex-wrap gap-2">
            {active.lines.some((l) => lineAreas(l, active.lines, takeoffAreas ?? {})) && (
              <Button variant="outline" className="h-10" aria-pressed={byArea} onClick={toggleByArea} title="Show where each base line's LF is: suites, common areas, washrooms">
                Base by area: {byArea ? "On" : "Off"}
              </Button>
            )}
            <Button variant="outline" className="h-10" onClick={() => setDialog("changes")}>
              <History className="mr-1.5 h-4 w-4" /> Changes{changes.length > 0 ? ` · ${changes.filter((c) => !c.reverted_at).length}` : ""}
            </Button>
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
                  const catMarkup = categoryMarkup(section, active.section_markups, lines, active.default_markup_pct);
                  /** A category markup: saved on the price and applied to every line in it not set individually. */
                  const setCategory = (markup: number) => {
                    if (markup === catMarkup && active.section_markups[section] != null) return;
                    const follow = lines.filter((l) => followsCategory(l, section) && l.markup_pct !== markup);
                    void run(async () => {
                      await updateVersion(active.id, { section_markups: { ...active.section_markups, [section]: markup } });
                      await saveLines(follow.map((l) => ({ id: l.id, row_version: l.row_version, line: { markup_pct: markup, price_basis: "markup" as const } })));
                      await logChanges([{ version_id: active.id, line_id: null, component_index: null, line_label: section, field: "section_markup", field_label: "Category markup", from_value: { markup_pct: catMarkup }, to_value: { markup_pct: markup } }], user?.id ?? null);
                    }, `${section}: ${markup}% markup on ${follow.length} ${follow.length === 1 ? "line" : "lines"}`);
                  };
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
                        <th colSpan={6} scope="rowgroup" className="px-3 py-1.5 text-left text-sm font-semibold">
                          {section}
                          {dragId && <span className="ml-2 text-xs font-normal text-muted-foreground">drop here to move it to {section}</span>}
                        </th>
                        <td className="px-2 py-1.5 text-right">
                          <PctInput key={`${section}-cm-${catMarkup}`} label={`Markup for ${section}`} value={catMarkup} disabled={!editable} onCommit={(n) => setCategory(n)} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <PctInput key={`${section}-cg-${catMarkup}`} label={`Margin for ${section}`} value={markupToMargin(catMarkup)} margin disabled={!editable} onCommit={(n) => setCategory(marginToMarkup(n))} />
                        </td>
                        <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums">{dollars(sub?.sellCents ?? 0)}</td>
                        <td />
                      </tr>
                      {lines.map((l) => (
                        <LineRows
                          key={l.id}
                          line={l}
                          areas={byArea ? lineAreas(l, active.lines, takeoffAreas ?? {}) : null}
                          wallEdges={lineWallEdges(l, active.lines, takeoffWalls ?? {})}
                          priced={sum.priced[l.id]!}
                          editable={editable}
                          expanded={open.has(l.id)}
                          selected={selected.has(l.id)}
                          onToggle={() => setOpen((s) => toggle(s, l.id))}
                          onSelect={() => setSelected((s) => toggle(s, l.id))}
                          onSave={(line, components) => void save([{ id: l.id, row_version: l.row_version, line, ...(components ? { components } : {}) }])}
                          onCost={(i, cents) => typeCost(l, i, cents)}
                          onLine={(patch, field, label, done) => typeLine(l, patch, field, label, done)}
                          onPart={(i, patch, label) => typePart(l, i, patch, label)}
                          onPush={(i) => window.confirm(`Make ${dollars(l.components[i]!.unit_cost_cents ?? 0)} / ${l.components[i]!.cost_uom} the catalogue price for ${l.components[i]!.label}? Every new estimate will start from it, and it is sent to QuickBooks when that is connected.`) && void pushToCatalogue(l, i)}
                          onReset={(i) => resetFromCatalogue(l, i)}
                          canPush={canSee}
                          categoryMarkup={catMarkup}
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

      {dialog === "unlock" && (
        <UnlockDialog
          onClose={() => setDialog(null)}
          onUnlock={async (reason) => {
            try {
              await unlockVersion(active.id, reason);
              toast.success("Unlocked for corrections");
              setDialog(null);
            } catch (e) {
              toast.error(errText(e));
            } finally {
              refresh();
            }
          }}
        />
      )}
      {dialog === "changes" && <ChangesSheet changes={changes} staff={staff} canRevert={editable} onRevert={revert} onClose={() => setDialog(null)} />}
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
          onKeyDown={keyCommit}
          className={numInput}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Margin %
        <PctInput key={`${version.id}-g-${version.default_markup_pct}`} label="Default margin percent" value={markupToMargin(version.default_markup_pct)} margin disabled={!editable} onCommit={(g) => void commit({ default_markup_pct: marginToMarkup(g) })} />
      </label>
    </div>
  );
}

/** A percentage typed in place. Margins must be below 100%. Commits on blur or Enter; Esc cancels. */
function PctInput({ label, value, onCommit, disabled, margin }: { label: string; value: number; onCommit: (n: number) => void; disabled?: boolean; margin?: boolean }) {
  return (
    <input
      aria-label={label}
      disabled={disabled}
      inputMode="decimal"
      defaultValue={Number(value.toFixed(2))}
      onKeyDown={keyCommit}
      onBlur={(e) => {
        const raw = e.target.value;
        if (margin) {
          const r = parseMargin(raw);
          if (!r.ok) {
            e.target.value = e.target.defaultValue;
            return void toast.error(r.error);
          }
          if (Math.abs(r.value - value) > 0.004) onCommit(r.value);
          return;
        }
        const n = Number(raw.replace(/[%,]/g, ""));
        if (raw.trim() === "" || !Number.isFinite(n) || n < 0 || n > 1000) {
          e.target.value = e.target.defaultValue;
          return void toast.error("Enter a markup between 0 and 1000");
        }
        if (Math.abs(n - value) > 0.004) onCommit(n);
      }}
      className={numInput}
    />
  );
}

const BY_AREA_KEY = "bmd.estimate.byArea";

function LineRows({
  line,
  areas,
  wallEdges,
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
  onLine,
  onPart,
  onPush,
  onReset,
  canPush,
  categoryMarkup: catMarkup,
}: {
  line: EstLine;
  areas: ReturnType<typeof lineAreas>;
  wallEdges: WallEdges | null;
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
  onLine: (patch: SaveItem["line"], field: string, label: string, done?: string) => void;
  onPart: (index: number, patch: Partial<SnapComponent>, label: string) => void;
  onPush: (index: number) => void;
  onReset: (index: number) => void;
  canPush: boolean;
  categoryMarkup: number;
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
  // Extras asked about on each line (a Schluter edge on wall tile): yes with its own LF and cost per LF, or no.
  const extras = extrasOf(line.components, line.driver_uom);
  const [typingExtra, setTypingExtra] = useState<number | null>(null);   // Yes was pressed with no takeoff length to offer: the LF box is open
  const answer = (index: number, yes: boolean, qty = 0) => {
    try {
      onSave({}, answerExtra(line.components, index, yes, qty));
      setTypingExtra(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const sayYes = (x: (typeof extras)[number]) => {
    if (x.qty > 0) return answer(x.index, true, x.qty);
    if (wallEdges && x.uom === "LF") {
      answer(x.index, true, wallEdges.allLf);
      return void toast.success(`${x.label}: ${wallEdges.allLf.toLocaleString("en-CA")} LF from the takeoff (the top and both ends of each run). Change it if only some edges are exposed.`, { duration: 8000 });
    }
    setTypingExtra(x.index);
  };
  const commitExtraQty = (x: (typeof extras)[number], raw: string) => {
    const n = Number(raw.replace(/,/g, ""));
    if (raw.trim() === "" && x.state !== "yes") return setTypingExtra(null);
    if (!Number.isFinite(n) || n <= 0) return void toast.error(`Enter how many ${x.uom}, above zero. Choose No if there is none.`);
    if (n !== x.qty || x.state !== "yes") answer(x.index, true, n);
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
  const shownMarkup = line.price_basis === "margin" || line.sell_override_cents != null ? priced.markupPct : line.markup_pct;
  /** Markup, margin or sell typed on the line: markup is stored, the other two follow. */
  const setMarkup = (markup: number, field: string, label: string) => onLine({ markup_pct: markup, price_basis: "markup", sell_override_cents: null, markup_overridden: true }, field, label);
  const commitSell = (raw: string) => {
    const cents = raw.trim() === "" ? null : parseMoneyCents(raw);
    if (raw.trim() !== "" && cents == null) return void toast.error("Enter the selling price in dollars");
    if (cents == null) return line.sell_override_cents != null ? onLine({ sell_override_cents: null }, "sell_override_cents", "Sell (cleared)") : undefined;
    if (cents === priced.sellCents) return;
    onLine({ sell_override_cents: cents, markup_pct: markupFromSell(priced.costCents, cents) ?? line.markup_pct, price_basis: "markup", markup_overridden: true }, "sell_override_cents", "Sell");
  };
  const commitLineCost = (raw: string) => {
    const cents = raw.trim() === "" ? null : parseMoneyCents(raw);
    if (raw.trim() !== "" && cents == null) return void toast.error("Enter the unit cost in dollars, or leave it blank to use the parts");
    if (cents !== (line.unit_cost_override_cents ?? null)) onLine({ unit_cost_override_cents: cents }, "unit_cost_override_cents", "Line unit cost");
  };
  const partsPerUnit = perUnit(priced.partsCostCents, line.driver_qty);
  const lineOverride = line.unit_cost_override_cents != null;
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
          {extras.map((x) => {
            const open = x.state === "yes" || typingExtra === x.index;
            const cost = priced.components[x.index]?.costCents ?? 0;
            return (
              <div key={x.index} role="group" aria-label={`Does it have a ${x.label}?`} className={cn("mx-2 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5 text-xs", x.state === "ask" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-border bg-muted/40")}>
                <span className="font-medium">Does it have a {x.label}?</span>
                {editable ? (
                  <span className="inline-flex overflow-hidden rounded-md border border-input bg-background">
                    <button type="button" aria-pressed={x.state === "yes"} onClick={() => sayYes(x)} className={cn("h-8 min-w-11 px-3 font-medium", x.state === "yes" && "bg-primary text-primary-foreground")}>
                      Yes
                    </button>
                    <button type="button" aria-pressed={x.state === "no"} onClick={() => answer(x.index, false)} className={cn("h-8 min-w-11 border-l border-input px-3 font-medium", x.state === "no" && "bg-primary text-primary-foreground")}>
                      No
                    </button>
                  </span>
                ) : (
                  <span className="font-medium">{x.state === "yes" ? "Yes" : x.state === "no" ? "No" : "Not answered"}</span>
                )}
                {open && (
                  <>
                    <input key={`${line.id}-xq-${x.index}-${x.qty}-${line.row_version}`} aria-label={`${x.label}: how many ${x.uom}`} disabled={!editable} autoFocus={typingExtra === x.index} inputMode="decimal" defaultValue={x.qty > 0 ? x.qty : ""} placeholder={x.uom} onBlur={(e) => commitExtraQty(x, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums" />
                    <span>{x.uom} at $</span>
                    <input key={`${line.id}-xc-${x.index}-${x.unitCostCents}-${line.row_version}`} aria-label={`${x.label}: cost per ${x.uom}`} disabled={!editable} inputMode="decimal" defaultValue={x.unitCostCents == null ? "" : (x.unitCostCents / 100).toFixed(2)} placeholder="cost" onBlur={(e) => commitCost(x.index, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums" />
                    <span>per {x.uom}</span>
                    {x.state === "yes" && (x.unitCostCents == null ? <span className="font-medium text-amber-700">cost missing</span> : <span className="tabular-nums">= {dollars(cost)} carried in this line</span>)}
                  </>
                )}
                {x.state !== "no" && wallEdges && x.uom === "LF" && <span className="basis-full text-muted-foreground">{edgeText(wallEdges)}</span>}
              </div>
            );
          })}
          {areas && (
            <p className="px-2 text-xs text-muted-foreground">
              By area: {areasText(areas.areas)}
              {!areas.matches && <span className="text-amber-700"> · the takeoff's areas no longer add up to this line's quantity</span>}
            </p>
          )}
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
          <input key={`${line.id}-w-${line.row_version}`} aria-label="Waste percent" disabled={!editable || fixed} inputMode="decimal" defaultValue={wasteShown} onBlur={(e) => commitNumber(e.target.value, wasteShown, 100, (n) => [{ waste_pct: n }, setLineWaste(line.components, n)])} onKeyDown={keyCommit} className={numInput} />
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
                  onKeyDown={keyCommit}
                  className={cn(numInput, "w-20", single.c.unit_cost_cents == null && "border-amber-400 bg-amber-50 placeholder:text-amber-800")}
                />
                <span className="w-9 text-left text-xs text-muted-foreground">/ {single.c.cost_uom}</span>
              </div>
            )
          ) : !fixed && (editable || lineOverride) && line.components.length > 1 ? (
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                <span className="text-xs text-muted-foreground">$</span>
                <input
                  key={`${line.id}-lu-${line.row_version}`}
                  aria-label={`Unit cost of ${line.description || "this line"} per ${line.driver_uom}`}
                  disabled={!editable}
                  inputMode="decimal"
                  placeholder={partsPerUnit == null ? "Type" : (partsPerUnit / 100).toFixed(2)}
                  defaultValue={lineOverride ? (line.unit_cost_override_cents! / 100).toFixed(2) : ""}
                  onBlur={(e) => commitLineCost(e.target.value)}
                  onKeyDown={keyCommit}
                  className={cn(numInput, "w-20")}
                />
                <span className="w-9 text-left text-xs text-muted-foreground">/ {line.driver_uom}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {lineOverride ? (
                  <TypedBadge label="overridden" title={`Parts come to ${partsPerUnit == null ? "—" : dollars(partsPerUnit)} / ${line.driver_uom}`} onClear={editable ? () => onLine({ unit_cost_override_cents: null }, "unit_cost_override_cents", "Line unit cost (cleared)", "Back to the parts' cost") : undefined} />
                ) : null}
                <button type="button" aria-expanded={expanded} onClick={onToggle} className={cn("underline-offset-2 hover:underline", priced.unknown && "font-medium text-amber-800")}>
                  {lineOverride ? `parts ${partsPerUnit == null ? "—" : dollars(partsPerUnit)}` : priced.unknown && editable ? "Add costs" : `${needed.length} parts`}
                </button>
              </div>
            </div>
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
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                {line.markup_overridden && <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Set on this line" aria-label="Set on this line" />}
                <PctInput key={`${line.id}-m-${line.row_version}`} label="Markup percent" value={shownMarkup} disabled={!editable} onCommit={(n) => setMarkup(n, "markup_pct", "Markup")} />
              </div>
              {editable && line.markup_overridden && line.markup_pct !== catMarkup && (
                <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => onLine({ markup_pct: catMarkup, price_basis: "markup", markup_overridden: false, sell_override_cents: null }, "markup_pct", "Markup (reset to category)")}>
                  Reset to category
                </button>
              )}
            </div>
          )}
        </td>
        <td className={cn(cell, "text-right tabular-nums text-muted-foreground")}>
          {fixed || priced.unknown ? (
            priced.unknown ? "—" : `${priced.marginPct.toFixed(1)}%`
          ) : (
            <PctInput key={`${line.id}-g-${line.row_version}`} label="Margin percent" value={priced.marginPct} margin disabled={!editable} onCommit={(g) => setMarkup(marginToMarkup(g), "margin_pct", "Margin")} />
          )}
        </td>
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
                onKeyDown={keyCommit}
                className={cn(numInput, "w-28 font-medium")}
              />
            </>
          ) : !fixed && editable ? (
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1">
                <span className="text-xs font-normal text-muted-foreground">$</span>
                <input
                  key={`${line.id}-sl-${line.row_version}-${priced.sellCents}`}
                  aria-label={`Selling price of ${line.description || "this line"}`}
                  inputMode="decimal"
                  defaultValue={(priced.sellCents / 100).toFixed(2)}
                  onBlur={(e) => commitSell(e.target.value)}
                  onKeyDown={keyCommit}
                  className={cn(numInput, "w-28 font-medium")}
                />
              </div>
              {priced.sellOverridden && <TypedBadge title="This selling price was typed; it stays when the cost changes" onClear={() => onLine({ sell_override_cents: null }, "sell_override_cents", "Sell (cleared)", "Back to markup")} />}
            </div>
          ) : (
            <>
              {dollars(priced.sellCents)}
              {priced.sellOverridden && <span className="ml-1"><TypedBadge /></span>}
            </>
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
                  <th className="py-1 text-right font-medium">Order unit</th>
                  <th className="py-1 text-right font-medium">Order</th>
                  <th className="py-1 text-right font-medium">Waste %</th>
                  <th className="py-1 text-right font-medium">Cost</th>
                  <th className="py-1 pl-4 font-medium">Not needed</th>
                </tr>
              </thead>
              <tbody>
                {line.components.map((c, i) => (
                  <tr key={i} className={c.not_applicable || lineOverride ? "opacity-50" : undefined}>
                    <td className="py-1">
                      {c.label}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.kind === "labour" ? "labour" : c.pst_applies ? "plus PST" : ""}
                        {c.cost_overridden ? " · typed here" : ""}
                      </span>
                      {editable && (c.catalogue_material_id || c.labour_rate_id) && (
                        <span className="ml-2 inline-flex gap-2 text-xs">
                          {c.cost_overridden && canPush && c.unit_cost_cents != null && (
                            <button type="button" className="inline-flex items-center gap-0.5 text-primary hover:underline" onClick={() => onPush(i)}>
                              <Upload className="h-3 w-3" /> Push to catalogue
                            </button>
                          )}
                          {c.cost_overridden && (
                            <button type="button" className="inline-flex items-center gap-0.5 text-muted-foreground hover:underline" onClick={() => onReset(i)}>
                              <X className="h-3 w-3" /> Reset from catalogue
                            </button>
                          )}
                        </span>
                      )}
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
                          onKeyDown={keyCommit}
                          className={cn(numInput, "w-24")}
                        />
                        <select
                          aria-label={`Cost unit of ${c.label}`}
                          disabled={!editable}
                          value={c.cost_uom}
                          onChange={(e) => onPart(i, { cost_uom: e.target.value as Uom, ...(c.order_uom ? {} : { purchase_uom: e.target.value as Uom }) }, "cost unit")}
                          className="h-10 rounded-md border border-input bg-background px-1 text-xs disabled:border-transparent disabled:bg-transparent disabled:opacity-100"
                        >
                          {[...new Set([c.cost_uom, ...UOMS])].map((u) => (
                            <option key={u} value={u}>
                              / {u}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="py-1">
                      <div className="flex flex-wrap items-center justify-end gap-1 whitespace-nowrap text-xs">
                        <select
                          aria-label={`Order unit of ${c.label}`}
                          disabled={!editable}
                          value={c.order_uom ?? ""}
                          onChange={(e) => {
                            const u = e.target.value || null;
                            const m = c.catalogue_material_id ? catalogue.materials[c.catalogue_material_id] : null;
                            // From the catalogue when it states what one of these holds in the cost unit.
                            const fromCat = m && u && m.purchase_uom === u && m.coverage_per_purchase_unit && m.coverage_uom === c.cost_uom ? m.coverage_per_purchase_unit : null;
                            onPart(i, u ? { order_uom: u, order_uom_factor: c.order_uom_factor ?? fromCat ?? 1 } : { order_uom: null, order_uom_factor: null, price_per: "cost_unit" }, "order unit");
                          }}
                          className="h-10 rounded-md border border-input bg-background px-1 text-xs disabled:border-transparent disabled:bg-transparent disabled:opacity-100"
                        >
                          <option value="">As needed</option>
                          {ORDER_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                        {c.order_uom && (
                          <>
                            <span>1 {c.order_uom} =</span>
                            <input
                              key={`${line.id}-of${i}-${line.row_version}`}
                              aria-label={`${c.cost_uom} in one ${c.order_uom} of ${c.label}`}
                              disabled={!editable}
                              inputMode="decimal"
                              defaultValue={c.order_uom_factor ?? ""}
                              onKeyDown={keyCommit}
                              onBlur={(e) => {
                                const n = Number(e.target.value.replace(/,/g, ""));
                                if (!(n > 0)) {
                                  e.target.value = e.target.defaultValue;
                                  return void toast.error("Enter how many " + c.cost_uom + " one " + c.order_uom + " holds, above zero");
                                }
                                if (n !== c.order_uom_factor) onPart(i, { order_uom_factor: n }, "conversion");
                              }}
                              className={cn(numInput, "w-20")}
                            />
                            <span>{c.cost_uom}</span>
                            <select
                              aria-label={`${c.label} is priced per`}
                              disabled={!editable}
                              value={c.price_per ?? "cost_unit"}
                              onChange={(e) => onPart(i, { price_per: e.target.value as "cost_unit" | "order_unit" }, "priced per")}
                              className="h-10 rounded-md border border-input bg-background px-1 text-xs disabled:border-transparent disabled:bg-transparent disabled:opacity-100"
                            >
                              <option value="cost_unit">price per {c.cost_uom}</option>
                              <option value="order_unit">price per {c.order_uom}</option>
                            </select>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {priced.orders[i] ? (
                        <>
                          Order {priced.orders[i]!.orderQty.toLocaleString("en-CA")} {c.order_uom}
                          <div className="text-xs text-muted-foreground">
                            ({priced.orders[i]!.costUnitQty.toLocaleString("en-CA")} {c.cost_uom})
                          </div>
                        </>
                      ) : (
                        <>
                          {priced.components[i]!.purchaseQty.toLocaleString("en-CA")} {c.purchase_uom}
                        </>
                      )}
                      {!c.order_uom && c.coverage_per_purchase_unit != null && (
                        <div className="flex items-center justify-end gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          one covers
                          <input
                            key={`${line.id}-cv${i}-${line.row_version}`}
                            aria-label={`${line.driver_uom} covered by one ${c.purchase_uom} of ${c.label}`}
                            disabled={!editable}
                            inputMode="decimal"
                            defaultValue={c.coverage_per_purchase_unit}
                            onBlur={(e) => commitCoverage(i, e.target.value)}
                            onKeyDown={keyCommit}
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
                        onKeyDown={keyCommit}
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
