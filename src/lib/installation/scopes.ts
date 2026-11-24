import { guessCategory } from "@/lib/estimating/lines";
import { jobScopes } from "./logic";

/** The job's scopes, read with whichever client the caller has (browser or server). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadJobScopes(db: any, projectId: string): Promise<string[]> {
  const { data: sc, error } = await db.from("project_scopes").select("scope").eq("project_id", projectId);
  if (error) throw new Error(error.message);
  const wizard = ((sc ?? []) as { scope: string }[]).map((s) => s.scope);
  if (wizard.length) return jobScopes(wizard, []);
  const { data: v } = await db
    .from("estimate_versions")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_base", true)
    .limit(1)
    .maybeSingle();
  let cats: string[] = [];
  if (v?.id) {
    const { data: lines } = await db.from("estimate_lines").select("description,kind").eq("version_id", v.id);
    cats = ((lines ?? []) as { description: string; kind: string }[])
      .filter((l) => !/labou?r/i.test(l.kind))
      .map((l) => guessCategory(l.description));
  }
  return jobScopes([], cats);
}
