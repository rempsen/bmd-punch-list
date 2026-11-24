/**
 * The assistant's instructions, the lookups it may ask for, and the small pure pieces around a conversation:
 * recognising "remember that…", keeping the lookup record, trimming results, and the sources shown under an answer.
 */
import type { ToolCall, ToolDef } from "@/lib/ai/tools";

export const MAX_ROUNDS = 6;
/** How much of a lookup result the model is shown; the rest is cut with a note so it can narrow the search. */
export const RESULT_CHARS = 12_000;

/** A JSON value, as the model's tool arguments and the stored lookup record are. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type LookupRecord = { name: string; args: { [key: string]: Json } };
export type Source = { kind: "document" | "knowledge" | "record"; label: string; documentId?: string; page?: number; itemId?: string };

export const LOOKUPS: ToolDef[] = [
  { name: "company_details", description: "BMD's own details: name, office and mailing address, phone, email, website, hours, GST number and business number.", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "search_catalogue", description: "Find materials and labour rates in BMD's catalogue by name, manufacturer, product line, SKU or cost code. Costs appear only when the asker may see pricing.", parameters: { type: "object", properties: { q: { type: "string", description: "Words from the product or rate name" } }, required: ["q"], additionalProperties: false } },
  { name: "search_clients", description: "Find clients and their contacts by name, email or phone.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } },
  { name: "search_projects", description: "Find projects (jobs) by name, number, client, address or city. Returns stage and key dates.", parameters: { type: "object", properties: { q: { type: "string", description: "Words from the project name, number, client or address; blank lists recent projects" } }, additionalProperties: false } },
  { name: "project_overview", description: "One project in full: stage, client and contacts, address, dates, value, people on the job, document counts.", parameters: { type: "object", properties: { project_id: { type: "string", description: "The project's id (uuid)" } }, required: ["project_id"], additionalProperties: false } },
  { name: "project_estimate_summary", description: "A project's estimate versions and change orders with their lines, cost and sell totals. Only for askers with pricing access.", parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"], additionalProperties: false } },
  { name: "list_quotes", description: "A project's quotes and change orders: number, status, value, when sent and accepted, inclusions and exclusions.", parameters: { type: "object", properties: { project_id: { type: "string" } }, required: ["project_id"], additionalProperties: false } },
  { name: "search_documents", description: "Full-text search inside project documents (plans, specifications, vendor quotes, quotes sent, contracts). Returns document name, page and a snippet. Use web-search syntax: plain words, \"a phrase\", -excluded.", parameters: { type: "object", properties: { q: { type: "string" }, project_id: { type: "string", description: "Limit to one project; omit to search every project the asker can see" } }, required: ["q"], additionalProperties: false } },
  { name: "read_document_page", description: "The full text of one page of a project document, to read a match in context.", parameters: { type: "object", properties: { document_id: { type: "string" }, page: { type: "integer", minimum: 1 } }, required: ["document_id", "page"], additionalProperties: false } },
  { name: "search_knowledge", description: "Search BMD's shared Knowledge: written memories (lead times, rules of thumb, who to call) and uploaded reference files such as price lists. Returns the memory text or the file name, page and snippet.", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } },
  { name: "read_knowledge_page", description: "The full text of one page of a Knowledge file.", parameters: { type: "object", properties: { item_id: { type: "string" }, page: { type: "integer", minimum: 1 } }, required: ["item_id", "page"], additionalProperties: false } },
];

export function systemPrompt(ctx: { askerName: string; today: string; project: { id: string; name: string; number: string | null } | null; canPrice: boolean; canRemember: boolean }): string {
  const lines = [
    "You are the BMD Projects assistant for BMD Materials, a Winnipeg flooring contractor. You answer questions for BMD staff from the company's own records, which you reach only through the lookups provided. Nothing is memorised: look things up every time.",
    `Today is ${ctx.today}. You are talking to ${ctx.askerName}.`,
    ctx.project ? `The person has job ${ctx.project.number ? `${ctx.project.number} ` : ""}"${ctx.project.name}" open (project_id ${ctx.project.id}). Questions about "this job", "the project" or "here" mean that one; use its project_id without asking.` : "No job is open. Questions about a project need its project_id from search_projects first.",
    "",
    "Rules:",
    "- Be short and precise. Lead with the answer; add only what helps.",
    "- Give the source for every number, price, date, address or name: the document name and page (\"Spec section 09 30 00, p. 4\"), the Knowledge memory or file and page, or the record it came from (\"the client record\", \"quote Q-1042\").",
    "- When a lookup finds nothing, say \"I couldn't find that\" and what you searched. Never guess, and never invent a price, quantity or contact.",
    "- A price read from a vendor quote or price list is evidence, not a catalogue price: report it with the document and its date, as written. It is never written anywhere.",
    "- You only read. You do not create, change, send or delete anything, and you say so plainly if asked to.",
    ctx.canPrice ? "- The person may see costs, markup and pricing." : "- The person does not have pricing access: costs, markup, margins, vendor prices and pricing-only knowledge are not available to them, and you must not try to work them out from other figures.",
    ctx.canRemember
      ? "- If the person says \"remember that …\", the app saves it as a Knowledge memory before you answer; confirm what was saved in one line and do not call a lookup for it."
      : "- If the person asks you to remember something, explain that only managers can add to Knowledge and suggest they ask one.",
    "- Search before answering: search_knowledge for company rules of thumb and vendor information, search_documents for anything in plans, specs, quotes or contracts. Read a page (read_document_page / read_knowledge_page) when a snippet is not enough.",
    "- Dollar amounts are Canadian dollars. Write dates as e.g. 24 Nov 2026.",
  ];
  return lines.join("\n");
}

/** The memory a "remember that…" message asks for, or null when the message is an ordinary question. */
export function rememberRequest(message: string): string | null {
  const m = /^\s*(?:please\s+)?remember(?:\s+that|\s*:|\s*,)?\s+(.+)$/is.exec(message.trim());
  if (!m) return null;
  const body = m[1]!.trim().replace(/\s+/g, " ");
  return body.length >= 3 ? body : null;
}

/** A short title for a memory: its first clause, cut to fit. */
export function memoryTitle(body: string): string {
  const first = body.split(/(?<=[.;:!?])\s+|\s+-\s+/)[0]!.trim().replace(/[.;:,!?]+$/, "");
  return (first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first) || "Memory";
}

/** A result as the model sees it: JSON, cut at the limit with a note. */
export function resultText(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > RESULT_CHARS ? `${s.slice(0, RESULT_CHARS)}\n…[cut: ${s.length - RESULT_CHARS} more characters; narrow the search]` : s;
}

/** The record kept with the answer: lookup names and arguments, never results. */
export const lookupRecord = (calls: ToolCall[]): LookupRecord[] => calls.map((c) => ({ name: c.name, args: JSON.parse(JSON.stringify(c.args ?? {})) as { [key: string]: Json } }));

/** A conversation's title from its first question. */
export function conversationTitle(message: string): string {
  const t = message.trim().replace(/\s+/g, " ");
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t || "Conversation";
}

type DocHit = { document_id: string; file_name: string; page: number };
type KnowledgeHit = { item_id: string; kind: string; title: string; file_name: string | null; page: number | null };

/** The sources shown under an answer: every document page and knowledge item a lookup returned, once each, in order. */
export function sourcesFrom(results: { name: string; value: unknown }[]): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const add = (s: Source, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const r of results) {
    if (!Array.isArray(r.value) && !(r.value && typeof r.value === "object")) continue;
    if (r.name === "search_documents" || r.name === "read_document_page") {
      const hits = (Array.isArray(r.value) ? r.value : [r.value]) as Partial<DocHit>[];
      for (const h of hits) if (h.document_id && h.file_name && h.page) add({ kind: "document", label: `${h.file_name}, p. ${h.page}`, documentId: h.document_id, page: h.page }, `d:${h.document_id}:${h.page}`);
    } else if (r.name === "search_knowledge" || r.name === "read_knowledge_page") {
      const hits = (Array.isArray(r.value) ? r.value : [r.value]) as Partial<KnowledgeHit>[];
      for (const h of hits) {
        if (!h.item_id) continue;
        const label = h.kind === "file" ? `${h.file_name ?? h.title ?? "Knowledge file"}${h.page ? `, p. ${h.page}` : ""}` : `Memory: ${h.title ?? ""}`;
        add({ kind: "knowledge", label, itemId: h.item_id, ...(h.page ? { page: h.page } : {}) }, `k:${h.item_id}:${h.page ?? ""}`);
      }
    } else if (r.name === "company_details") add({ kind: "record", label: "Company settings" }, "r:company");
    else if (r.name === "project_overview") add({ kind: "record", label: "Project record" }, "r:project");
    else if (r.name === "project_estimate_summary") add({ kind: "record", label: "Estimate" }, "r:estimate");
    else if (r.name === "list_quotes") add({ kind: "record", label: "Quotes" }, "r:quotes");
    else if (r.name === "search_clients") add({ kind: "record", label: "Client records" }, "r:clients");
    else if (r.name === "search_catalogue") add({ kind: "record", label: "Catalogue" }, "r:catalogue");
  }
  return out;
}
