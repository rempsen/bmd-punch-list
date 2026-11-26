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
  .inputValidator((d: { projectId: string }) => {
    if (!d || typeof d.projectId !== "string" || !/^[0-9a-f-]{36}$/.test(d.projectId)) throw new Error("Invalid job");
    return d;
  })
  .handler(async ({ context, data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this project.");

    const { data: project } = await context.supabase.from("projects").select("*").eq("id", data.projectId).maybeSingle();
    if (!project) throw new Error("Job not found");
    const { data: items, error } = await context.supabase
      .from("deficiencies")
      .select("id,item_number,area,material,issue_type,description,assessment,status,due_date,created_at,assigned_trade,responsible_party,decision_reason,locations(name,floors(number,label))")
      .eq("project_id", data.projectId)
      .order("item_number");
    if (error) throw new Error(error.message);

    const ids = (items ?? []).map((d) => d.id);
    const [{ data: photos }, { data: events }, { count: inboxNew }] = await Promise.all([
      ids.length ? context.supabase.from("deficiency_photos").select("deficiency_id,kind").in("deficiency_id", ids) : Promise.resolve({ data: [] as { deficiency_id: string; kind: string }[] }),
      ids.length ? context.supabase.from("deficiency_events").select("deficiency_id,event_type,note,created_at").in("deficiency_id", ids).not("note", "is", null).order("created_at", { ascending: false }).limit(400) : Promise.resolve({ data: [] as { deficiency_id: string; event_type: string; note: string | null; created_at: string }[] }),
      context.supabase.from("companycam_inbox").select("id", { count: "exact", head: true }).eq("project_id", data.projectId).eq("status", "new"),
    ]);
    const pc = new Map<string, { b: number; a: number }>();
    for (const p of photos ?? []) { const c = pc.get(p.deficiency_id) ?? { b: 0, a: 0 }; if (p.kind === "after") c.a++; else c.b++; pc.set(p.deficiency_id, c); }
    const notes = new Map<string, string[]>();
    for (const e of events ?? []) { const l = notes.get(e.deficiency_id) ?? []; if (l.length < 2 && e.note) l.push(e.note.slice(0, 140)); notes.set(e.deficiency_id, l); }
    const lines = (items ?? []).map((d) => {
      const c = pc.get(d.id) ?? { b: 0, a: 0 };
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
        d.assigned_trade ? `assigned ${d.assigned_trade}` : `responsible ${d.responsible_party}`,
        `photos ${c.b} before / ${c.a} after`,
        d.decision_reason ? `client request: "${d.decision_reason.slice(0, 120)}"` : "",
        ...(notes.get(d.id) ?? []).map((n) => `note: "${n}"`),
      ].filter(Boolean).join(" | ");
    });

    const today = new Date().toISOString().slice(0, 10);
    const prompt = `Project: ${project?.name ?? "Unknown"} (client: ${project?.client_name ?? "—"}). Today: ${today}.
CompanyCam photos still waiting for review in the Photo inbox: ${inboxNew ?? 0}.
Flooring & tile deficiency punch list, ${lines.length} items (closed = Accepted as-is or Verified):
${lines.join("\n") || "(no items)"}

Write a clear punch-list summary (under 350 words) in markdown for the site team and the client, using short headings:
- **Headline**: one sentence on overall status.
- **Key numbers**: total, open vs closed, must-fix still open, awaiting client decision, overdue.
- **Still open**: the open items grouped by floor, one short line each (D-number, room, what's wrong, who has it, due date).
- **Photo review gaps**: items marked Fixed with no after photo, open items with no before photo, and the number of CompanyCam photos still waiting in the Photo inbox.
- **Waiting on the client**: D-numbers and what BMD is asking.
- **Next actions**: 2-4 concrete steps, naming trades or people where the data shows them.
Formatting: each section title is a '## ' heading; inside Still open each floor is a '### Floor N' heading; every item or fact is its own '- ' bullet starting with bold D-number and room (e.g. '- **D-0013 · Room 201** — ...'). Use the notes to explain what's actually happening on an item. Only use facts from the data. Do not invent items, people or dates.`;

    // The app's standard: Claude Opus 5.5 or stronger, never a weaker model.
    const { askStrongModel } = await import("@/lib/ai/model.server");
    try {
      const { text } = await askStrongModel({
        system: "You are a construction project coordinator for BMD Materials, a flooring and tile contractor. Be factual, brief and professional.",
        prompt,
        maxTokens: 1500,
      });
      return { summary: text.trim() || "No summary was produced. Please try again." };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Opus|switched off/i.test(msg)) throw new Error(msg);
      if (/402|credit/i.test(msg)) throw new Error("AI credits have run out. Add credits in Settings → Plans & credits.");
      if (/429|rate/i.test(msg)) throw new Error("AI is busy right now. Please try again in a minute.");
      throw new Error("Couldn't create the summary. Please try again.");
    }
  });
