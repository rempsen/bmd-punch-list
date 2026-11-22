import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MaterialDialog } from "@/components/catalogue/MaterialDialog";
import { selectCls } from "@/components/catalogue/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { priceLabel, type CostCode, type Material, type Supplier, type Template } from "@/lib/catalogue/data";
import { deleteFinish, saveFinish, type Finish } from "@/lib/estimating/data";
import { errText } from "@/lib/platform/db";

/** The job's finish tags as they appear on the drawings (CPT-1, LVP-1…), each tied to an assembly and a material. */
export function FinishesPanel({
  projectId,
  finishes,
  templates,
  materials,
  suppliers,
  costCodes,
  canEdit,
  canAddMaterial,
  onChanged,
}: {
  projectId: string;
  finishes: Finish[];
  templates: Template[];
  materials: Material[];
  suppliers: Supplier[];
  costCodes: CostCode[];
  canEdit: boolean;
  canAddMaterial: boolean;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({ tag: "", description: "", template: "", material: "" });
  const [newFor, setNewFor] = useState<{ finishId: string | null; category: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = async (f: Finish, p: Partial<Finish>) => {
    try {
      const { id, ...rest } = { ...f, ...p };
      await saveFinish(id, rest);
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const add = async () => {
    if (!draft.tag.trim() || !draft.template) {
      toast.error("Enter a tag and choose what kind of finish it is");
      return;
    }
    setBusy(true);
    try {
      await saveFinish(null, {
        project_id: projectId,
        tag: draft.tag.trim().toUpperCase(),
        description: draft.description.trim() || null,
        assembly_template_id: draft.template,
        catalogue_material_id: draft.material || null,
        sort_order: finishes.length + 1,
      });
      setDraft({ tag: "", description: "", template: draft.template, material: "" });
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const options = (templateId: string | null, current: string | null) => {
    const cat = templates.find((t) => t.id === templateId)?.category;
    return materials.filter((m) => (m.active && (!cat || m.category === cat)) || m.id === current);
  };
  const materialSelect = (templateId: string | null, value: string, onChange: (v: string) => void, finishId: string | null) => (
    <select
      aria-label="Material"
      className={selectCls}
      disabled={!canEdit}
      value={value}
      onChange={(e) => {
        if (e.target.value === "__new") setNewFor({ finishId, category: templates.find((t) => t.id === templateId)?.category ?? "other" });
        else onChange(e.target.value);
      }}
    >
      <option value="">Not chosen yet</option>
      {options(templateId, value || null).map((m) => (
        <option key={m.id} value={m.id}>
          {[m.name, m.colour].filter(Boolean).join(" – ")} ({priceLabel(m.unit_cost_cents, m.cost_uom)})
        </option>
      ))}
      {canAddMaterial && <option value="__new">+ New material…</option>}
    </select>
  );

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Finishes on this job</h2>
        <p className="text-xs text-muted-foreground">One row per tag on the drawings. Lines added for a tag use its assembly and material.</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Tag</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">Material</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {finishes.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-2 font-mono font-semibold">{f.tag}</td>
                <td className="px-4 py-2">
                  <Input className="h-11" disabled={!canEdit} defaultValue={f.description ?? ""} onBlur={(e) => e.target.value !== (f.description ?? "") && void patch(f, { description: e.target.value.trim() || null })} />
                </td>
                <td className="px-4 py-2">{templates.find((t) => t.id === f.assembly_template_id)?.name ?? "—"}</td>
                <td className="px-4 py-2">{materialSelect(f.assembly_template_id, f.catalogue_material_id ?? "", (v) => void patch(f, { catalogue_material_id: v || null }), f.id)}</td>
                <td className="px-2">
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${f.tag}`}
                      className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={async () => {
                        if (!window.confirm(`Remove ${f.tag}? Lines already on the estimate keep their prices.`)) return;
                        try {
                          await deleteFinish(f.id);
                          onChanged();
                        } catch (e) {
                          toast.error(errText(e));
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {canEdit && (
              <tr className="bg-muted/30">
                <td className="px-4 py-2">
                  <Input aria-label="New tag" className="h-11 w-28 font-mono uppercase" placeholder="CPT-1" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} />
                </td>
                <td className="px-4 py-2">
                  <Input aria-label="New description" className="h-11" placeholder="Corridor carpet tile" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </td>
                <td className="px-4 py-2">
                  <select aria-label="New kind" className={selectCls} value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value, material: "" })}>
                    <option value="">Choose…</option>
                    {templates.filter((t) => t.active).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">{materialSelect(draft.template || null, draft.material, (v) => setDraft({ ...draft, material: v }), null)}</td>
                <td className="px-2">
                  <Button size="sm" disabled={busy} onClick={() => void add()} aria-label="Add finish">
                    <Plus className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {newFor && (
        <MaterialDialog
          material={null}
          defaults={{ category: newFor.category as Material["category"] }}
          suppliers={suppliers}
          costCodes={costCodes}
          canEdit
          onClose={() => setNewFor(null)}
          onSaved={(id) => {
            const f = finishes.find((x) => x.id === newFor.finishId);
            if (f) void patch(f, { catalogue_material_id: id });
            else setDraft((d) => ({ ...d, material: id }));
            setNewFor(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
