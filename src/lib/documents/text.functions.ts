import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PAGE_CHARS, TOTAL_CHARS, type TextStatus } from "./text";
import type { IndexTarget } from "./index.server";

const UUID = /^[0-9a-f-]{36}$/i;
export function validateIndexPages(d: { pages: string[]; labels?: string[] }) {
  if (!Array.isArray(d.pages) || d.pages.length > 5000 || d.pages.some((p) => typeof p !== "string" || p.length > PAGE_CHARS)) throw new Error("Too much text for one file");
  if (d.pages.reduce((n, p) => n + p.length, 0) > TOTAL_CHARS) throw new Error("Too much text for one file");
  if (d.labels && (d.labels.length !== d.pages.length || d.labels.some((p) => typeof p !== "string" || p.length > 300))) throw new Error("Invalid page labels");
}
export const storeDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; pages: string[]; status: TextStatus; labels?: string[] }) => {
    if (!d || !UUID.test(d.documentId ?? "") || !["done", "no_text"].includes(d.status)) throw new Error("Invalid request");
    validateIndexPages(d); return d;
  })
  .handler(async ({ data, context }) => {
    const { authorizeIndex, saveIndex } = await import("./index.server");
    await authorizeIndex(context.supabase, "document", data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return saveIndex(supabaseAdmin, "document", data.documentId, data.pages, data.labels);
  });
export const markDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; status: "failed" | "no_text"; reason?: string }) => {
    if (!d || !UUID.test(d.documentId ?? "") || !["failed", "no_text"].includes(d.status)) throw new Error("Invalid request");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { authorizeIndex, saveIndex } = await import("./index.server");
    await authorizeIndex(context.supabase, "document", data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return saveIndex(supabaseAdmin, "document", data.documentId, [], [], data.status === "failed" ? (data.reason ?? "Could not read file text").slice(0, 500) : null);
  });
export const indexStoredFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; target: IndexTarget }) => {
    if (!d || !UUID.test(d.id ?? "") || !["document", "knowledge"].includes(d.target)) throw new Error("Invalid file");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { authorizeIndex, indexStored } = await import("./index.server");
    const row = await authorizeIndex(context.supabase, data.target, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const update = await (supabaseAdmin as any).from(data.target === "document" ? "project_documents" : "knowledge_items").update({ text_status: "pending", text_error: null }).eq("id", data.id);
    if (update.error) throw new Error(update.error.message);
    return indexStored(supabaseAdmin, data.target, row);
  });
