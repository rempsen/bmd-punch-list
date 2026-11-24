import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PAGE_CHARS, TOTAL_CHARS, type TextStatus } from "./text";

const UUID = /^[0-9a-f-]{36}$/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>; from: (t: string) => any };

/** The document's project when the caller may read that project's documents; otherwise an error. */
async function writableDocument(sb: Sb, documentId: string): Promise<{ project_id: string }> {
  const { data, error } = await sb.from("project_documents").select("project_id").eq("id", documentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Document not found");
  // Writing page text needs the same permission as uploading the document: a viewer must not be able to plant text into search.
  const { data: ok } = await sb.rpc("can_project_documents", { _project: data.project_id, _write: true });
  if (ok !== true) throw new Error("Not allowed");
  return data as { project_id: string };
}

/** Stores the text of each page of a document, read in the browser, and marks the document indexed. */
export const storeDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; pages: string[]; status: TextStatus }) => {
    if (!d || !UUID.test(d.documentId ?? "") || !Array.isArray(d.pages) || (d.status !== "done" && d.status !== "no_text")) throw new Error("Invalid request");
    if (d.pages.length > 5000 || d.pages.some((p) => typeof p !== "string" || p.length > PAGE_CHARS)) throw new Error("Too much text for one document");
    if (d.pages.reduce((n, p) => n + p.length, 0) > TOTAL_CHARS) throw new Error("Too much text for one document");
    return d;
  })
  .handler(async ({ data, context }) => {
    await writableDocument(context.supabase as unknown as Sb, data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const del = await admin.from("document_pages").delete().eq("document_id", data.documentId);
    if (del.error) throw new Error(del.error.message);
    const rows = data.pages.map((text, i) => ({ document_id: data.documentId, page: i + 1, text })).filter((r) => r.text.length > 0);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from("document_pages").insert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
    const { error } = await admin
      .from("project_documents")
      .update({ text_status: rows.length ? "done" : "no_text", text_pages: data.pages.length, text_indexed_at: new Date().toISOString() })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { pages: rows.length, status: rows.length ? ("done" as const) : ("no_text" as const) };
  });

/** Marks a document as unreadable (scanned, an image, an Office file) or as failed, so it shows as such and is not retried every time. */
export const markDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; status: "failed" | "no_text" }) => {
    if (!d || !UUID.test(d.documentId ?? "") || (d.status !== "failed" && d.status !== "no_text")) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data, context }) => {
    await writableDocument(context.supabase as unknown as Sb, data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabaseAdmin as any).from("project_documents").update({ text_status: data.status, text_pages: 0, text_indexed_at: new Date().toISOString() }).eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
