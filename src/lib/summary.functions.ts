import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUS: Record<string, string> = {
  open: "Open",
  awaiting_client: "Awaiting client",
  accepted_as_is: "Accepted as-is",
  fix_required: "Fix required",
  in_progress: "In progress",
  fixed: "Fixed",
  verified: "Verified",
};
const ASSESS: Record<string, string> = {
  acceptable: "Acceptable",
  client_review: "Needs client review",
  must_fix: "Must fix",
};

export const summarisePunchList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this project.");

    const { data: project } = await context.supabase.from("projects").select("*").limit(1).maybeSingle();
    const { data: items, error } = await context.supabase
      .from("deficiencies")
      .select("item_number,area,material,issue_type,description,assessment,status,due_date,created_at,locations(name,floors(number,label))")
      .order("item_number");
    if (error) throw new Error(error.message);

    const lines = (items ?? []).map((d) => {
      const loc = d.locations as { name: string; floors: { number: number; label: string } | null } | null;
      return [
        `D-${String(d.item_number).padStart(4, "0")}`,
        loc?.floors?.label ?? "",
        loc?.name ?? "",
        d.area,
        d.material,
        d.issue_type,
        ASSESS[d.assessment] ?? d.assessment,
        STATUS[d.status] ?? d.status,
        d.due_date ? `due ${d.due_date}` : "",
        d.description ? `"${d.description.slice(0, 160)}"` : "",
      ].filter(Boolean).join(" | ");
    });

    const today = new Date().toISOString().slice(0, 10);
    const prompt = `Project: ${project?.name ?? "Unknown"} (client: ${project?.client_name ?? "—"}). Today: ${today}.
Flooring & tile deficiency punch list, ${lines.length} items (closed = Accepted as-is or Verified):
${lines.join("\n") || "(no items)"}

Write a concise progress summary (under 250 words) in markdown for the site team and the client:
- One-sentence headline on overall status.
- Key numbers: total, open vs closed, must-fix still open, awaiting client decision.
- Hot spots: floors/rooms or materials/issues with the most open items.
- Items needing the client's decision (list D-numbers).
- Overdue items if any.
- 2-3 recommended next actions.
Only use facts from the data. Do not invent items.`;

    const { streamText } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { createLovableAiGatewayRunIdFetch } = await import("./ai-gateway.server");
    const runIdFetch = createLovableAiGatewayRunIdFetch();
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch,
    });

    try {
      const result = streamText({
        model: lovable.responses("openai/gpt-6-astra"),
        system: "You are a construction project coordinator for BMD Materials, a flooring and tile contractor. Be factual, brief and professional.",
        prompt,
        providerOptions: {
          openai: {
            forceReasoning: true,
            reasoningEffort: "low",
            reasoningSummary: "auto",
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      });
      const text = await result.text;
      return { summary: text.trim() || "No summary was produced. Please try again." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/402|credit/i.test(msg)) throw new Error("AI credits have run out. Add credits in Settings → Plans & credits.");
      if (/429|rate/i.test(msg)) throw new Error("AI is busy right now. Please try again in a minute.");
      throw new Error("Couldn't create the summary. Please try again.");
    }
  });
