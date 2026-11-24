import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cap = async (sb: any, c: string) => (await sb.rpc("has_capability", { _capability: c })).data === true;

/** "Scan existing documents" in Company settings → Scope keywords. Re-scans every indexed plan and spec. */
export const scanExistingDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await cap(context.supabase, "manage_settings"))) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanAllDocuments } = await import("./scope.server");
    return scanAllDocuments(supabaseAdmin);
  });

/** The one-time backfill: runs once for the first BMD staff member to open Documents or Overview after deploy. */
export const ensureScopeBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await cap(context.supabase, "view_pipeline"))) return { ran: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    // Claim the flag first so two people opening the app at once do not both run it.
    const { data: claimed, error } = await admin.from("scope_scan_state").update({ backfilled_at: new Date().toISOString() }).eq("id", true).is("backfilled_at", null).select("id");
    if (error) throw new Error(error.message);
    if (!claimed?.length) return { ran: false as const };
    const { scanAllDocuments } = await import("./scope.server");
    return { ran: true as const, ...(await scanAllDocuments(admin)) };
  });

/** AI review of a project's unreviewed scope hits: a verdict and suggestion per hit, saved on the hit. */
export const reviewScopeHitsWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; redo?: boolean }) => d)
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    if (!(await cap(sb, "view_pipeline"))) throw new Error("Not allowed");
    // Read through the caller's own access, so only hits they can see are reviewed.
    let q = sb.from("document_scope_hits").select("id,document_id,keyword_id,page,snippet").eq("project_id", data.projectId).is("reviewed_at", null).limit(600);
    if (!data.redo) q = q.is("ai_at", null);
    const { data: hits, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (hits ?? []) as { id: string; document_id: string; keyword_id: string; page: number | null; snippet: string }[];
    if (!rows.length) return { reviewed: 0, inScope: 0 };
    const [{ data: kws }, { data: docs }] = await Promise.all([
      sb.from("scope_keywords").select("id,term"),
      sb.from("project_documents").select("id,file_name").in("id", [...new Set(rows.map((r) => r.document_id))]),
    ]);
    const term = new Map(((kws ?? []) as { id: string; term: string }[]).map((k) => [k.id, k.term]));
    const name = new Map(((docs ?? []) as { id: string; file_name: string }[]).map((d) => [d.id, d.file_name]));
    const { SCOPE_AI_BATCH, SCOPE_AI_SYSTEM, parseScopeAi, scopeAiPrompt } = await import("./scope-ai");
    const { askStrongModel } = await import("@/lib/ai/model.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    let reviewed = 0;
    let inScope = 0;
    for (let i = 0; i < rows.length; i += SCOPE_AI_BATCH) {
      const batch = rows.slice(i, i + SCOPE_AI_BATCH).map((r) => ({ id: r.id, term: term.get(r.keyword_id) ?? "", document: name.get(r.document_id) ?? "document", page: r.page, snippet: r.snippet }));
      const res = await askStrongModel({ system: SCOPE_AI_SYSTEM, prompt: scopeAiPrompt(batch), maxTokens: 8000 });
      const out = parseScopeAi(res.text, new Set(batch.map((b) => b.id)));
      const at = new Date().toISOString();
      for (const s of out) {
        const { error: e } = await admin.from("document_scope_hits").update({ ai_verdict: s.verdict, ai_suggestion: s.suggestion, ai_model: res.model, ai_at: at }).eq("id", s.id);
        if (e) throw new Error(e.message);
        reviewed += 1;
        if (s.verdict === "in_scope") inScope += 1;
      }
    }
    return { reviewed, inScope };
  });
