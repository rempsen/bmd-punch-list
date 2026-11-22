import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Reads spec and schedule text and stores the finishes it finds as proposals for a person to accept or reject.
 * Only text is sent to the model. Nothing is added to the project's finishes here.
 */
export const proposeScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; specText: string; scheduleText: string; sourceNote?: string }) => {
    if (!d || !/^[0-9a-f-]{36}$/i.test(d.projectId) || typeof d.specText !== "string" || typeof d.scheduleText !== "string" || d.specText.length + d.scheduleText.length > 2_000_000) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { buildScopeRequest, parseProposals } = await import("./scope");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: ok } = await sb.rpc("has_capability", { _capability: "manage_estimates" });
    if (ok !== true) throw new Error("Not allowed");
    const req = buildScopeRequest(data);
    const { askStrongModel } = await import("./model.server");
    const { text, model } = await askStrongModel(req);
    const proposals = parseProposals(text);
    if (proposals.length === 0) return { added: 0, model };
    const { data: existing } = await sb.from("project_finishes").select("tag").eq("project_id", data.projectId);
    const have = new Set(((existing ?? []) as { tag: string }[]).map((f) => f.tag.toLowerCase()));
    const fresh = proposals.filter((p) => !have.has(p.tag.toLowerCase()));
    if (fresh.length) {
      const { error } = await sb.from("ai_proposals").insert(fresh.map((p) => ({ project_id: data.projectId, kind: "finish", payload: p, source_note: data.sourceNote?.slice(0, 200) ?? null })));
      if (error) throw new Error(error.message);
    }
    return { added: fresh.length, alreadyHad: proposals.length - fresh.length, model };
  });

/** Which model the AI features will use, with a one-word test call. For the Settings screen. */
export const aiModelStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ok } = await (context.supabase as any).rpc("has_capability", { _capability: "manage_integrations" });
    if (ok !== true) throw new Error("Not allowed");
    const { askStrongModel, availableModels } = await import("./model.server");
    const { chooseModel, meetsMinimum, MINIMUM_LABEL } = await import("./model");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { ok: false as const, message: "AI is not set up for this app." };
    try {
      const ids = await availableModels(key);
      const chosen = chooseModel(ids);
      if (!chosen) return { ok: false as const, message: `The AI connection offers nothing at ${MINIMUM_LABEL} or stronger.`, claude: ids.filter((i) => /claude/i.test(i)) };
      const reply = await askStrongModel({ system: "Reply with the single word OK.", prompt: "Reply OK.", maxTokens: 32 });
      return { ok: true as const, model: reply.model, reply: reply.text.trim().slice(0, 40), qualifying: ids.filter(meetsMinimum), skipped: reply.attempts.map((a) => `${a.model} (${a.form}): ${a.status} ${a.detail}`).slice(0, 6) };
    } catch (e) {
      const attempts = e && typeof e === "object" && "attempts" in e && Array.isArray((e as { attempts: unknown }).attempts) ? (e as { attempts: { model: string; form: string; status: number; detail: string }[] }).attempts : [];
      return { ok: false as const, message: e instanceof Error ? e.message : String(e), tried: attempts.map((a) => `${a.model} (${a.form}): ${a.status} ${a.detail}`).slice(0, 12) };
    }
  });
