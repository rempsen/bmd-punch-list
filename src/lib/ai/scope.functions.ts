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
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not set up for this app.");
    const req = buildScopeRequest(data);

    const { generateText } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { createLovableAiGatewayRunIdFetch } = await import("@/lib/ai-gateway.server");
    const lovable = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }, fetch: createLovableAiGatewayRunIdFetch().fetch });
    let text: string;
    try {
      text = (await generateText({ model: lovable.responses("openai/gpt-6-astra"), system: req.system, prompt: req.prompt, providerOptions: { openai: { store: false } } })).text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/402|credit/i.test(msg)) throw new Error("AI credits have run out. Add credits in Settings → Plans & credits.");
      if (/429|rate/i.test(msg)) throw new Error("AI is busy right now. Please try again in a minute.");
      throw new Error("The documents could not be read by AI just now. Please try again.");
    }
    const proposals = parseProposals(text);
    if (proposals.length === 0) return { added: 0 };
    const { data: existing } = await sb.from("project_finishes").select("tag").eq("project_id", data.projectId);
    const have = new Set(((existing ?? []) as { tag: string }[]).map((f) => f.tag.toLowerCase()));
    const fresh = proposals.filter((p) => !have.has(p.tag.toLowerCase()));
    if (fresh.length) {
      const { error } = await sb.from("ai_proposals").insert(fresh.map((p) => ({ project_id: data.projectId, kind: "finish", payload: p, source_note: data.sourceNote?.slice(0, 200) ?? null })));
      if (error) throw new Error(error.message);
    }
    return { added: fresh.length, alreadyHad: proposals.length - fresh.length };
  });
