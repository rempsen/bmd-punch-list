import type { ImportOptions, ImportTemplate, Mapping } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export async function findTemplate(db: Db, signature: string): Promise<ImportTemplate | null> {
  const { data, error } = await db.from("import_templates").select("id,name,header_signature,mapping,options,uses").eq("header_signature", signature).order("last_used_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Save the mapping the first time a header parses; later uses only bump the counter. */
export async function rememberTemplate(db: Db, t: { name: string; signature: string; mapping: Mapping; options: Partial<ImportOptions> }, existing: ImportTemplate | null): Promise<string | null> {
  const now = new Date().toISOString();
  if (existing) {
    const { error } = await db.from("import_templates").update({ uses: existing.uses + 1, last_used_at: now }).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }
  const { data, error } = await db.from("import_templates").insert({ name: t.name, header_signature: t.signature, mapping: t.mapping, options: t.options, uses: 1, last_used_at: now }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}
