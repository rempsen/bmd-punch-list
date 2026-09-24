import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const STATUSES = [
  "open",
  "awaiting_client",
  "accepted_as_is",
  "fix_required",
  "in_progress",
  "fixed",
  "verified",
] as const;
const ASSESSMENTS = ["acceptable", "client_review", "must_fix"] as const;

const SELECT =
  "id,item_number,area,material,issue_type,description,assessment,status,due_date,created_at,updated_at,closed_at,locations(name,type,floors(number,label))";

type Row = {
  id: string;
  item_number: number;
  area: string | null;
  material: string | null;
  issue_type: string | null;
  description: string | null;
  assessment: string;
  status: string;
  due_date: string | null;
  client_decision_note?: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  locations: { name: string; type: string; floors: { number: number; label: string | null } | null } | null;
};

const toJson = (r: Row) => ({
  id: r.id,
  item: `D-${String(r.item_number).padStart(4, "0")}`,
  floor: r.locations?.floors?.number ?? null,
  location: r.locations?.name ?? null,
  area: r.area,
  material: r.material,
  issue_type: r.issue_type,
  description: r.description,
  assessment: r.assessment,
  status: r.status,
  due_date: r.due_date,
  client_decision_note: r.client_decision_note ?? null,
  created_at: r.created_at,
  updated_at: r.updated_at,
  closed_at: r.closed_at,
});

function authed(ctx: { isAuthenticated(): boolean }) {
  if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
}

export const listDeficiencies = defineTool({
  name: "list_deficiencies",
  title: "List deficiencies",
  description: "List punch list deficiencies, optionally filtered by status, assessment, floor or text search.",
  inputSchema: {
    status: z.enum(STATUSES).optional().describe("Filter by workflow status."),
    assessment: z.enum(ASSESSMENTS).optional().describe("Filter by assessment."),
    floor: z.number().int().optional().describe("Floor number, e.g. 5."),
    search: z.string().optional().describe("Text to match in location, material, issue or description."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, assessment, floor, search, limit }, ctx) => {
    authed(ctx);
    const sb = supabaseForUser(ctx);
    let q = sb.from("deficiencies").select(SELECT).order("item_number", { ascending: true }).limit(500);
    if (status) q = q.eq("status", status);
    if (assessment) q = q.eq("assessment", assessment);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    let rows = ((data ?? []) as unknown as Row[]).map(toJson);
    if (floor !== undefined) rows = rows.filter((r) => r.floor === floor);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) =>
        [r.item, r.location, r.area, r.material, r.issue_type, r.description]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s)),
      );
    }
    rows = rows.slice(0, limit ?? 50);
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { deficiencies: rows },
    };
  },
});

async function findId(sb: ReturnType<typeof supabaseForUser>, item: string) {
  const n = Number(item.replace(/^D-?/i, ""));
  if (!Number.isFinite(n)) throw new ToolError("Use an item number like D-0012");
  const { data, error } = await sb.from("deficiencies").select("id").eq("item_number", n).limit(1);
  if (error) throw new ToolError(error.message);
  if (!data?.[0]) throw new ToolError(`Deficiency ${item} not found`);
  return data[0].id as string;
}

export const getDeficiency = defineTool({
  name: "get_deficiency",
  title: "Get deficiency",
  description: "Get one deficiency by item number (e.g. D-0012) with its activity and comments.",
  inputSchema: { item: z.string().min(1).describe("Item number, e.g. D-0012.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ item }, ctx) => {
    authed(ctx);
    const sb = supabaseForUser(ctx);
    const id = await findId(sb, item);
    const [{ data: d, error }, { data: ev }] = await Promise.all([
      sb.from("deficiencies").select(SELECT).eq("id", id).single(),
      sb
        .from("deficiency_events")
        .select("event_type,from_value,to_value,note,created_at")
        .eq("deficiency_id", id)
        .order("created_at"),
    ]);
    if (error) throw new ToolError(error.message);
    const events = (ev ?? []).map((e) => ({
      event_type: String(e.event_type),
      from_value: e.from_value,
      to_value: e.to_value,
      note: e.note,
      created_at: e.created_at,
    }));
    const { data: notes } = await sb.rpc("decision_notes", { _ids: [id] });
    const deficiency = toJson({ ...(d as unknown as Row), client_decision_note: notes?.[0]?.note ?? null });
    return {
      content: [{ type: "text", text: JSON.stringify({ deficiency, events }) }],
      structuredContent: { deficiency, events },
    };
  },
});

export const updateStatus = defineTool({
  name: "update_deficiency_status",
  title: "Update deficiency status",
  description:
    "Move a deficiency to a new status. Workflow rules and your role apply (e.g. 'fixed' needs an after photo).",
  inputSchema: {
    item: z.string().min(1).describe("Item number, e.g. D-0012."),
    status: z.enum(STATUSES).describe("New status."),
    note: z.string().optional().describe("Optional decision note (used for client decisions)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ item, status, note }, ctx) => {
    authed(ctx);
    const sb = supabaseForUser(ctx);
    const id = await findId(sb, item);
    const patch: Record<string, string> = { status };
    if (note) patch["client_decision_note"] = note;
    const { error } = await sb.from("deficiencies").update(patch as never).eq("id", id);
    if (error) throw new ToolError(error.message);
    return { content: [{ type: "text", text: `${item} is now ${status}.` }] };
  },
});

export const addComment = defineTool({
  name: "add_deficiency_comment",
  title: "Add comment",
  description: "Add a comment to a deficiency's activity timeline.",
  inputSchema: {
    item: z.string().min(1).describe("Item number, e.g. D-0012."),
    comment: z.string().trim().min(1).describe("Comment text."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ item, comment }, ctx) => {
    authed(ctx);
    const sb = supabaseForUser(ctx);
    const id = await findId(sb, item);
    const { error } = await sb.from("deficiency_events").insert({
      deficiency_id: id,
      user_id: ctx.getUserId(),
      event_type: "comment",
      note: comment,
    } as never);
    if (error) throw new ToolError(error.message);
    return { content: [{ type: "text", text: `Comment added to ${item}.` }] };
  },
});
