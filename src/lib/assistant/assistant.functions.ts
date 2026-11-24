import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Turn } from "@/lib/ai/tools";
import { lookupsFor, type Sb } from "./lookups";
import { conversationTitle, LOOKUPS, memoryTitle, rememberRequest, systemPrompt, type LookupRecord, type Source } from "./prompt";
import { runConversation } from "./run";

const UUID = /^[0-9a-f-]{36}$/i;
const MESSAGE_CHARS = 4000;
const HISTORY = 20;

export type AskResult = { conversationId: string; answer: string; sources: Source[]; lookups: LookupRecord[]; model: string | null; remembered?: { id: string; title: string; body: string; visibility: "all_staff" | "pricing_only" } };

async function capability(sb: Sb, cap: string): Promise<boolean> {
  const { data } = await sb.rpc("has_capability", { _capability: cap });
  return data === true;
}

/** BMD staff who may use Ask BMD: the use_assistant capability (BMD field and up) or the pipeline. */
async function assistantAllowed(sb: Sb): Promise<boolean> {
  const { data } = await sb.rpc("assistant_allowed", {});
  return data === true;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Winnipeg", day: "numeric", month: "short", year: "numeric" });

/** Asks the assistant. Lookups run as the caller; the question, the answer and the lookups made are kept on the conversation. */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId?: string | null; projectId?: string | null; message: string }) => {
    if (!d || typeof d.message !== "string" || !d.message.trim()) throw new Error("Type a question first");
    if (d.message.length > MESSAGE_CHARS) throw new Error(`Keep a question under ${MESSAGE_CHARS} characters`);
    if (d.conversationId && !UUID.test(d.conversationId)) throw new Error("Invalid conversation");
    if (d.projectId && !UUID.test(d.projectId)) throw new Error("Invalid project");
    return { conversationId: d.conversationId ?? null, projectId: d.projectId ?? null, message: d.message.trim() };
  })
  .handler(async ({ data, context }): Promise<AskResult> => {
    const sb = context.supabase as unknown as Sb;
    const [staff, canPrice, canRemember] = await Promise.all([assistantAllowed(sb), capability(sb, "view_pricing"), capability(sb, "manage_settings")]);
    if (!staff) throw new Error("The assistant is for BMD staff.");

    // The conversation, new or continued (the row policy keeps it the caller's own).
    let conversationId = data.conversationId;
    let projectId = data.projectId;
    if (conversationId) {
      const { data: c, error } = await sb.from("assistant_conversations").select("id,project_id").eq("id", conversationId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!c) throw new Error("That conversation is not yours or no longer exists");
      projectId = (c as { project_id: string | null }).project_id ?? projectId;
    } else {
      const { data: c, error } = await sb.from("assistant_conversations").insert({ project_id: projectId, title: conversationTitle(data.message) }).select("id").single();
      if (error) throw new Error(error.message);
      conversationId = (c as { id: string }).id;
    }

    const project = projectId ? ((await sb.from("projects").select("id,name,project_number").eq("id", projectId).maybeSingle()).data as { id: string; name: string; project_number: string | null } | null) : null;
    const { data: profile } = await sb.from("profiles").select("full_name,email").eq("id", context.userId).maybeSingle();
    const askerName = (profile as { full_name?: string | null; email?: string | null } | null)?.full_name || (profile as { email?: string | null } | null)?.email || "a BMD staff member";

    const { error: userErr } = await sb.from("assistant_messages").insert({ conversation_id: conversationId, role: "user", content: data.message });
    if (userErr) throw new Error(userErr.message);

    // "Remember that…" is saved by the app, never by the model, and only for people who may add to Knowledge.
    const memory = rememberRequest(data.message);
    if (memory && canRemember) {
      const { data: k, error } = await sb.from("knowledge_items").insert({ kind: "memory", title: memoryTitle(memory), body: memory, visibility: "all_staff" }).select("id,title,body,visibility").single();
      if (error) throw new Error(error.message);
      const saved = k as { id: string; title: string; body: string; visibility: "all_staff" | "pricing_only" };
      const answer = `Saved to Knowledge for all staff: "${saved.body}". It can be edited, made pricing-only or removed under Company settings → Knowledge.`;
      await sb.from("assistant_messages").insert({ conversation_id: conversationId, role: "assistant", content: answer, lookups: [{ name: "remember", args: { title: saved.title } }], model: null });
      await sb.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
      return { conversationId, answer, sources: [], lookups: [], model: null, remembered: saved };
    }

    // Earlier turns of this conversation, words only; the lookups behind them are not replayed.
    const { data: prior } = await sb.from("assistant_messages").select("role,content,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(HISTORY + 1);
    const history: Turn[] = ((prior ?? []) as { role: "user" | "assistant"; content: string }[])
      .slice(1)
      .reverse()
      .map((m) => (m.role === "user" ? { role: "user", text: m.content } : { role: "assistant", text: m.content, calls: [] }));

    const { askStrongModelWithTools } = await import("@/lib/ai/model.server");
    const result = await runConversation({
      system: systemPrompt({ askerName, today: today(), project: project ? { id: project.id, name: project.name, number: project.project_number } : null, canPrice, canRemember }),
      history,
      message: data.message,
      tools: LOOKUPS,
      lookups: lookupsFor(sb, { canPrice }),
      model: async (ask) => {
        const r = await askStrongModelWithTools({ ...ask, maxTokens: 3000 });
        return { reply: r.reply, model: r.model };
      },
    });

    const { error: aErr } = await sb.from("assistant_messages").insert({ conversation_id: conversationId, role: "assistant", content: result.answer.slice(0, 40000), lookups: result.lookups, model: result.model });
    if (aErr) throw new Error(aErr.message);
    await sb.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    return { conversationId, answer: result.answer, sources: result.sources, lookups: result.lookups, model: result.model };
  });

/** Stores the page text of a Knowledge file, read in the browser. Only someone who may change that item can store its text. */
export const storeKnowledgeText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { itemId: string; pages: string[]; status: "done" | "no_text" | "failed" }) => {
    if (!d || !UUID.test(d.itemId ?? "") || !Array.isArray(d.pages) || !["done", "no_text", "failed"].includes(d.status)) throw new Error("Invalid request");
    if (d.pages.length > 5000 || d.pages.some((p) => typeof p !== "string" || p.length > 20_000)) throw new Error("Too much text for one file");
    if (d.pages.reduce((n, p) => n + p.length, 0) > 3 * 1024 * 1024) throw new Error("Too much text for one file");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const { data: item, error } = await sb.from("knowledge_items").select("id,visibility").eq("id", data.itemId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Knowledge item not found");
    const { data: ok } = await sb.rpc("can_write_knowledge", { _visibility: (item as { visibility: string }).visibility });
    if (ok !== true) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const del = await admin.from("knowledge_pages").delete().eq("item_id", data.itemId);
    if (del.error) throw new Error(del.error.message);
    const rows = data.pages.map((text, i) => ({ item_id: data.itemId, page: i + 1, text })).filter((r) => r.text.length > 0);
    for (let i = 0; i < rows.length; i += 200) {
      const { error: e } = await admin.from("knowledge_pages").insert(rows.slice(i, i + 200));
      if (e) throw new Error(e.message);
    }
    const status = data.status === "failed" ? "failed" : rows.length ? "done" : "no_text";
    const { error: uErr } = await admin.from("knowledge_items").update({ text_status: status, text_pages: data.pages.length, updated_at: new Date().toISOString() }).eq("id", data.itemId);
    if (uErr) throw new Error(uErr.message);
    return { pages: rows.length, status };
  });
