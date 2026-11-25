/** Browser-side reads and writes for the assistant: conversations (the asker's own) and the Knowledge section. */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/platform/db";
import { safeFileName } from "@/lib/documents/logic";
import { enqueueFile } from "@/lib/documents/index-queue";
import type { LookupRecord } from "./prompt";

export type Visibility = "all_staff" | "pricing_only";
export const VISIBILITY: { value: Visibility; label: string }[] = [
  { value: "all_staff", label: "All staff" },
  { value: "pricing_only", label: "Pricing staff only" },
];
export const KNOWLEDGE_BUCKET = "knowledge";
export const KNOWLEDGE_MAX_BYTES = 50 * 1024 * 1024;

export type Conversation = { id: string; project_id: string | null; title: string; created_at: string; updated_at: string };
export type Message = { id: string; role: "user" | "assistant"; content: string; lookups: LookupRecord[]; model: string | null; created_at: string };
export type KnowledgeItem = {
  id: string;
  kind: "memory" | "file";
  title: string;
  body: string | null;
  folder: string | null;
  file_name: string | null;
  storage_path: string | null;
  mime: string | null;
  size_bytes: number | null;
  text_status: "pending" | "done" | "no_text" | "failed";
  text_pages: number | null;
  text_error: string | null;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
};

export function useConversations(enabled: boolean) {
  return useQuery({
    queryKey: ["assistant-conversations"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("assistant_conversations").select("id,project_id,title,created_at,updated_at").order("updated_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Conversation[];
    },
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["assistant-messages", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await db.from("assistant_messages").select("id,role,content,lookups,model,created_at").eq("conversation_id", conversationId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });
}

export async function deleteConversation(id: string) {
  const { error } = await db.from("assistant_conversations").delete().eq("id", id);
  if (error) throw error;
}

export const KNOWLEDGE_COLS = "id,kind,title,body,folder,file_name,storage_path,mime,size_bytes,text_status,text_pages,text_error,visibility,created_at,updated_at";
export function useKnowledge(enabled = true) {
  return useQuery({
    queryKey: ["knowledge"],
    enabled,
    refetchInterval: (q) => (q.state.data as KnowledgeItem[] | undefined)?.some((i) => i.kind === "file" && i.text_status === "pending") ? 2000 : false,
    queryFn: async () => {
      const { data, error } = await db.from("knowledge_items").select(KNOWLEDGE_COLS).order("folder", { nullsFirst: true }).order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as KnowledgeItem[];
    },
  });
}

export async function saveMemory(item: { id?: string; title: string; body: string; folder: string | null; visibility: Visibility }) {
  const row = { kind: "memory", title: item.title.trim(), body: item.body.trim(), folder: item.folder?.trim() || null, visibility: item.visibility, updated_at: new Date().toISOString() };
  if (!row.title) throw new Error("Give the memory a title");
  if (!row.body) throw new Error("Write what to remember");
  const q = item.id ? db.from("knowledge_items").update(row).eq("id", item.id) : db.from("knowledge_items").insert(row);
  const { error } = await q;
  if (error) throw error;
}

export async function setKnowledgeVisibility(id: string, visibility: Visibility) {
  const { error } = await db.from("knowledge_items").update({ visibility, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function setKnowledgeFolder(id: string, folder: string | null) {
  const { error } = await db.from("knowledge_items").update({ folder: folder?.trim() || null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteKnowledge(item: KnowledgeItem) {
  if (item.storage_path) await supabase.storage.from(KNOWLEDGE_BUCKET).remove([item.storage_path]);
  const { error } = await db.from("knowledge_items").delete().eq("id", item.id);
  if (error) throw error;
}

/** Which uploads are accepted: PDF, text, Markdown, CSV, Word and Excel. Supported text formats share one queue. Other files are retained without search. */
export function checkKnowledgeFile(file: File): string | null {
  if (file.size <= 0) return "That file is empty.";
  if (file.size > KNOWLEDGE_MAX_BYTES) return "Knowledge files are limited to 50 MB.";
  return null;
}

/** Uploads a Knowledge file: the row first (so the storage policy can check it), then the file, then its page text for search. */
export async function uploadKnowledgeFile(file: File, opts: { folder: string | null; visibility: Visibility; title?: string }): Promise<void> {
  const problem = checkKnowledgeFile(file);
  if (problem) throw new Error(problem);
  const id = crypto.randomUUID();
  const storagePath = `${id}/${safeFileName(file.name)}`;
  const { error } = await db.from("knowledge_items").insert({ id, kind: "file", title: (opts.title?.trim() || file.name).slice(0, 300), file_name: file.name, storage_path: storagePath, mime: file.type || null, size_bytes: file.size, folder: opts.folder?.trim() || null, visibility: opts.visibility });
  if (error) throw error;
  const up = await supabase.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) {
    await db.from("knowledge_items").delete().eq("id", id);
    throw new Error(up.error.message);
  }
  await enqueueFile("knowledge", id, file, file.type || null, file.name);
}

export async function knowledgeFileUrl(item: KnowledgeItem): Promise<string> {
  if (!item.storage_path) throw new Error("This item has no file");
  const { data, error } = await supabase.storage.from(KNOWLEDGE_BUCKET).createSignedUrl(item.storage_path, 3600);
  if (error || !data) throw new Error(error?.message ?? "Could not open the file");
  return data.signedUrl;
}

export async function indexKnowledgeFile(item: KnowledgeItem) {
  if (!item.storage_path || !item.file_name) throw new Error("This item has no file");
  const { data: blob, error } = await supabase.storage.from(KNOWLEDGE_BUCKET).download(item.storage_path);
  if (error || !blob) throw new Error(error?.message ?? "Could not download file");
  return enqueueFile("knowledge", item.id, blob, item.mime, item.file_name);
}
