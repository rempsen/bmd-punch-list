import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { errText } from "@/lib/platform/db";
import type { CatalogueView } from "@/lib/estimating/assemble";
import type { Template } from "@/lib/catalogue/data";
import { undoImport, useImports, type ImportListRow } from "@/lib/estimate-import/review-data";
import { staffName, useBmdStaff } from "@/lib/projects/data";
import { EstimateImportWizard } from "./EstimateImportWizard";

const STATUS: Record<string, string> = { parsed: "not reviewed", reviewing: "in review", committed: "imported", discarded: "undone" };

/** The job's estimate imports: open one to carry on or look back, or undo one whose lines nobody has changed. */
export function ImportsPopover({ projectId, canUndo, catalogue, templates, rates, onChanged }: { projectId: string; canUndo: boolean; catalogue: CatalogueView; templates: Template[]; rates: { pstPct: number } | null; onChanged: () => void }) {
  const { data: imports = [], refetch } = useImports(projectId);
  const { data: staff = [] } = useBmdStaff();
  const [openId, setOpenId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<ImportListRow | null>(null);
  const [busy, setBusy] = useState(false);
  if (!imports.length) return null;
  const undo = async (i: ImportListRow) => {
    setBusy(true);
    try {
      await undoImport(i.id);
      onChanged();
      await refetch();
      toast.success(`Import from ${i.file_name} undone`);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
      setUndoing(null);
    }
  };
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-10">Imports · {imports.length}</Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-96 w-96 max-w-[94vw] overflow-auto">
          {imports.map((i) => (
            <div key={i.id} className="space-y-1 border-b border-border py-3 last:border-0">
              <p className="truncate font-medium">{i.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(i.created_at).toLocaleDateString("en-CA")} · {staffName(staff, i.created_by ?? undefined)} · {STATUS[i.status] ?? i.status} · {i.rows.filter((r) => r.kind === "item").length} lines
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpenId(i.id)}>{i.status === "parsed" || i.status === "reviewing" ? "Carry on" : "Open"}</Button>
                {canUndo && i.status === "committed" && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setUndoing(i)}>Undo</Button>
                )}
              </div>
            </div>
          ))}
        </PopoverContent>
      </Popover>
      {openId && (
        <EstimateImportWizard
          projectId={projectId}
          importId={openId}
          catalogue={catalogue}
          templates={templates}
          rates={rates}
          onClose={() => { setOpenId(null); void refetch(); }}
          onDone={() => { onChanged(); void refetch(); }}
        />
      )}
      <AlertDialog open={!!undoing} onOpenChange={(o) => !o && setUndoing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo the import from {undoing?.file_name}?</AlertDialogTitle>
            <AlertDialogDescription>Its lines are removed from the estimate. This only works while nobody has changed them since the import.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => undoing && void undo(undoing)}>Undo import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
