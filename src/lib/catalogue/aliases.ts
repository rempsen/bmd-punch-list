import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { normaliseAlias } from "@/lib/estimate-import/match";

export type CatalogueAlias = { id: string; catalogue_item_id: string | null; assembly_id: string | null; alias: string; alias_norm: string; source: "import" | "manual"; uses: number; last_used_at: string; created_at: string };
export type AliasTarget = { catalogue_item_id: string } | { assembly_id: string };

const COLS = "id,catalogue_item_id,assembly_id,alias,alias_norm,source,uses,last_used_at,created_at";

/** Every alias (for catalogue search). Small table: one row per confirmed wording. */
export function useAllAliases(enabled = true) {
  return useQuery({
    queryKey: ["catalogue", "aliases"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("catalogue_aliases").select(COLS).order("uses", { ascending: false }).limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as CatalogueAlias[];
    },
  });
}

export function useRefreshAliases() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["catalogue", "aliases"] });
}

/** Adds (or bumps) an alias through the same database function the import confirmation uses. */
export async function addAlias(text: string, target: AliasTarget, source: "import" | "manual" = "manual"): Promise<string> {
  const norm = normaliseAlias(text);
  if (!norm) throw new Error("Type the other name first.");
  const { data, error } = await db.rpc("confirm_catalogue_alias", {
    _alias: text,
    _alias_norm: norm,
    _catalogue_item_id: "catalogue_item_id" in target ? target.catalogue_item_id : null,
    _assembly_id: "assembly_id" in target ? target.assembly_id : null,
    _source: source,
  } as never);
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

export async function removeAlias(id: string) {
  const { error } = await db.from("catalogue_aliases").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Alias text per catalogue id, joined, for search. */
export function aliasTextById(aliases: CatalogueAlias[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of aliases) {
    const k = a.catalogue_item_id ?? a.assembly_id ?? "";
    m.set(k, `${m.get(k) ?? ""} ${a.alias}`);
  }
  return m;
}
