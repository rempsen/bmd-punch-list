import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MaterialDialog } from "@/components/catalogue/MaterialDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addAlias, useRefreshAliases } from "@/lib/catalogue/aliases";
import { saveLabourRate, saveMaterial, saveTemplate, useCostCodes, useRefreshCatalogue, useSuppliers, type Material } from "@/lib/catalogue/data";
import { useScopeKeywords } from "@/lib/documents/scope-data";
import { guessCategory, normaliseUom, type ImportedLine } from "@/lib/estimate-import/match";
import type { Uom } from "@/lib/estimating/calc";
import { UOMS } from "@/lib/catalogue/logic";
import { pushCatalogueItemToQbo, type ItemPushResult, type QboItemPreview } from "@/lib/qbo/item.functions";
import { errText } from "@/lib/platform/db";

const cents = (d: number | null) => (d == null || !Number.isFinite(d) ? null : Math.round(d * 100));
const asUom = (u: string | null): Uom => {
  const n = normaliseUom(u);
  return (UOMS as string[]).includes(n ?? "") ? (n as Uom) : "SF";
};

/** The catalogue form's starting values for an imported line. Supplier stays blank. */
export function productDefaults(line: ImportedLine, keywords: Parameters<typeof guessCategory>[1]): Partial<Material> {
  const unit = asUom(line.uom);
  return { name: line.description.trim(), category: guessCategory(`${line.description} ${line.detail ?? ""}`, keywords), cost_uom: unit, purchase_uom: unit, unit_cost_cents: cents(line.material_unit_cost), supplier_id: null, price_source: "Imported estimate", pst_applies: true, active: true };
}

export type CreatedProduct = { materialId: string; labourRateId: string | null; assemblyId: string | null; aliasId: string };
type State = { busy: boolean; created: CreatedProduct | null; qbo: ItemPushResult | null; error: string | null };

/**
 * For the review screen: create a catalogue product from an imported line, and send it to QuickBooks.
 * Labour is kept the way the catalogue models it: a labour rate plus an assembly (material + labour); the alias then points to the assembly.
 */
export function useCreateProductFromImport() {
  const keywords = useScopeKeywords();
  const refreshCatalogue = useRefreshCatalogue();
  const refreshAliases = useRefreshAliases();
  const push = useServerFn(pushCatalogueItemToQbo);
  const [state, setState] = useState<State>({ busy: false, created: null, qbo: null, error: null });

  /** Adds labour/assembly and the alias around a material that already exists (saved by the catalogue form). */
  const finish = useCallback(async (line: ImportedLine, materialId: string, material: { name: string; category: Material["category"]; cost_uom: Uom }): Promise<CreatedProduct> => {
    let labourRateId: string | null = null;
    let assemblyId: string | null = null;
    const labourCents = cents(line.labour_unit_cost);
    if (labourCents != null) {
      labourRateId = await saveLabourRate(null, { name: `Install – ${material.name}`.slice(0, 200), uom: material.cost_uom, unit_cost_cents: labourCents, cost_code: null, active: true, uom_confirmed: true });
      assemblyId = await saveTemplate(null, { name: `${material.name} – supply & install`.slice(0, 200), category: material.category, driver_uom: material.cost_uom, cost_code: null, default_waste_pct: 0, sort_order: 99, active: true }, [
        { kind: "material", label: material.name, source: "catalogue", catalogue_material_id: materialId, labour_rate_id: null, unit_cost_cents: null, cost_uom: material.cost_uom, qty_per_driver: 1, waste_pct: null, round_up: false, pst_applies: true, on_gross: false, sort_order: 1 },
        { kind: "labour", label: "Install", source: "labour_rate", catalogue_material_id: null, labour_rate_id: labourRateId, unit_cost_cents: null, cost_uom: material.cost_uom, qty_per_driver: 1, waste_pct: null, round_up: false, pst_applies: false, on_gross: false, sort_order: 2 },
      ]);
    }
    const aliasId = await addAlias(line.description, assemblyId ? { assembly_id: assemblyId } : { catalogue_item_id: materialId }, "import");
    refreshCatalogue();
    refreshAliases();
    return { materialId, labourRateId, assemblyId, aliasId };
  }, [refreshCatalogue, refreshAliases]);

  /** Creates the product straight from the line with the guessed defaults (no form). */
  const create = useCallback(async (line: ImportedLine, overrides: Partial<Material> = {}): Promise<CreatedProduct> => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const d = { ...productDefaults(line, keywords.data ?? []), ...overrides };
      const unit = (d.cost_uom ?? "SF") as Uom;
      const materialId = await saveMaterial(null, {
        name: d.name ?? line.description, category: d.category ?? "other", manufacturer: null, product_line: null, colour: null, sku: null, supplier_id: d.supplier_id ?? null,
        cost_uom: unit, unit_cost_cents: d.unit_cost_cents ?? null, purchase_uom: (d.purchase_uom ?? unit) as Uom, coverage_per_purchase_unit: null, coverage_uom: null, pst_applies: d.pst_applies ?? true,
        default_waste_pct: 0, cost_code: null, active: true, price_date: d.unit_cost_cents != null ? new Date().toISOString().slice(0, 10) : null, price_source: d.price_source ?? null, notes: null, uom_confirmed: true,
      });
      const created = await finish(line, materialId, { name: d.name ?? line.description, category: d.category ?? "other", cost_uom: unit });
      setState({ busy: false, created, qbo: null, error: null });
      return created;
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: errText(e) }));
      throw e;
    }
  }, [finish, keywords.data]);

  /** `send: false` previews the QuickBooks item; `send: true` creates it (or returns the existing link). */
  const pushToQuickBooks = useCallback(async (materialId: string, send = true): Promise<ItemPushResult> => {
    setState((s) => ({ ...s, busy: true, error: null }));
    const res: ItemPushResult = await (push({ data: { materialId, send } }) as Promise<ItemPushResult>).catch((e: unknown): ItemPushResult => ({ ok: false, message: errText(e) }));
    setState((s) => ({ ...s, busy: false, qbo: res, error: res.ok ? null : res.message }));
    return res;
  }, [push]);

  return { create, finish, pushToQuickBooks, state, keywords: keywords.data ?? [] };
}

/** Opens the normal catalogue material form pre-filled from an imported line; then offers Push to QuickBooks. */
export function NewProductFromImportDialog({ line, onClose, onCreated }: { line: ImportedLine; onClose: () => void; onCreated?: (p: CreatedProduct) => void }) {
  const { finish, pushToQuickBooks, state, keywords } = useCreateProductFromImport();
  const { data: suppliers = [] } = useSuppliers();
  const { data: costCodes = [] } = useCostCodes();
  const [created, setCreated] = useState<CreatedProduct | null>(null);
  const [preview, setPreview] = useState<QboItemPreview | null>(null);
  const defaults = productDefaults(line, keywords);

  const saved = async (materialId: string) => {
    try {
      const p = await finish(line, materialId, { name: defaults.name ?? line.description, category: defaults.category ?? "other", cost_uom: (defaults.cost_uom ?? "SF") as Uom });
      setCreated(p);
      onCreated?.(p);
    } catch (e) {
      toast.error(`Product saved, but the alias or labour could not be added: ${errText(e)}`);
      onClose();
    }
  };

  if (!created) return <MaterialDialog material={null} defaults={defaults} suppliers={suppliers} costCodes={costCodes} canEdit onClose={onClose} onSaved={(id) => void saved(id)} />;

  const qbo = state.qbo;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Product added</DialogTitle>
          <DialogDescription>
            “{line.description}” is now in the catalogue{created.assemblyId ? " with its labour rate and a supply & install assembly" : ""}, and future imports with this wording match it.
          </DialogDescription>
        </DialogHeader>
        {preview && !(qbo?.ok && qbo.sent) && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="mb-1 text-xs text-muted-foreground">QuickBooks will get this item:</div>
            <div>{preview.name} · non-inventory</div>
            <div className="text-muted-foreground">{preview.description}{preview.purchaseCost != null ? ` · cost $${preview.purchaseCost.toFixed(2)}` : ""}</div>
          </div>
        )}
        {qbo?.ok && qbo.sent && <p className="text-sm">QuickBooks item {qbo.itemId}{qbo.itemName ? ` · ${qbo.itemName}` : ""}{qbo.sku ? ` · SKU ${qbo.sku}` : ""}</p>}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
          {!(qbo?.ok && qbo.sent) &&
            (preview ? (
              <Button disabled={state.busy} onClick={() => void pushToQuickBooks(created.materialId, true)}>
                {state.busy ? "Sending…" : "Send to QuickBooks"}
              </Button>
            ) : (
              <Button
                disabled={state.busy}
                onClick={async () => {
                  const r = await pushToQuickBooks(created.materialId, false);
                  if (r.ok && !r.sent) setPreview(r.preview);
                }}
              >
                Push to QuickBooks
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
