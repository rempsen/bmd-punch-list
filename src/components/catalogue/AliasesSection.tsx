import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { addAlias, removeAlias, useAllAliases, useRefreshAliases, type AliasTarget, type CatalogueAlias } from "@/lib/catalogue/aliases";
import { errText } from "@/lib/platform/db";

/** Other names this product or assembly is known by. Imports that use one of them match it straight away. */
export function AliasesSection({ target, canEdit }: { target: AliasTarget; canEdit: boolean }) {
  const all = useAllAliases();
  const refresh = useRefreshAliases();
  const id = "catalogue_item_id" in target ? target.catalogue_item_id : target.assembly_id;
  const rows = (all.data ?? []).filter((a) => (a.catalogue_item_id ?? a.assembly_id) === id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<CatalogueAlias | null>(null);

  const add = async () => {
    setBusy(true);
    try {
      await addAlias(text.trim(), target, "manual");
      setText("");
      refresh();
    } catch (e) {
      toast.error(`Could not add alias: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (a: CatalogueAlias) => {
    try {
      await removeAlias(a.id);
      refresh();
    } catch (e) {
      toast.error(`Could not remove alias: ${errText(e)}`);
    }
  };

  return (
    <section className="space-y-2 border-t pt-4">
      <div>
        <h3 className="text-sm font-medium">Aliases</h3>
        <p className="text-xs text-muted-foreground">Other names for this item on imported estimates. Confirmed import matches are added here.</p>
      </div>
      {all.isError ? (
        <p className="text-xs text-muted-foreground">Aliases could not be loaded.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No aliases yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-normal">Alias</th>
                <th className="py-1 pr-2 font-normal">Source</th>
                <th className="py-1 pr-2 font-normal">Uses</th>
                <th className="py-1 pr-2 font-normal">Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="py-1.5 pr-2">{a.alias}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{a.source === "import" ? "Import" : "Typed"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{a.uses}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{new Date(a.last_used_at).toLocaleDateString()}</td>
                  <td className="py-1.5 text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(a)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <Input className="h-10" placeholder="Add another name, e.g. LVT-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && void add()} />
          <Button variant="outline" disabled={busy || !text.trim()} onClick={() => void add()}>
            Add alias
          </Button>
        </div>
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove alias “{confirm?.alias}”?</AlertDialogTitle>
            <AlertDialogDescription>Imported lines with this wording will no longer match this item automatically.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void remove(confirm)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
