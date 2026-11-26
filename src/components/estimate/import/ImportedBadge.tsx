import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { db, errText } from "@/lib/platform/db";
import type { CatalogueView } from "@/lib/estimating/assemble";
import { useTaxSettings, useTemplates } from "@/lib/catalogue/data";
import { EstimateImportWizard } from "./EstimateImportWizard";

/** "Imported" on a line: opens the import it came from, read-only. */
export function ImportedBadge({ rowId, catalogue }: { rowId: string | null | undefined; catalogue: CatalogueView }) {
  const [review, setReview] = useState<{ id: string; project: string } | null>(null);
  const { data: templates = [] } = useTemplates(!!review);
  const { data: tax } = useTaxSettings(!!review);
  const rates = tax ? { pstPct: tax.pst_pct } : null;
  if (!rowId) return <span>· imported</span>;
  const show = async () => {
    try {
      const { data, error } = await db.from("estimate_import_rows").select("import_id,estimate_imports(project_id)").eq("id", rowId).single();
      if (error) throw error;
      const imp = data.estimate_imports as unknown as { project_id: string };
      setReview({ id: data.import_id as string, project: imp.project_id });
    } catch (e) {
      toast.error(`Could not open the import: ${errText(e)}`);
    }
  };
  return (
    <>
      <Button size="sm" variant="ghost" className="h-6 rounded border border-border px-1.5 text-xs text-muted-foreground" title="Open the import this line came from" onClick={() => void show()}>
        Imported
      </Button>
      {review && <EstimateImportWizard projectId={review.project} importId={review.id} catalogue={catalogue} templates={templates} rates={rates} onClose={() => setReview(null)} />}
    </>
  );
}
