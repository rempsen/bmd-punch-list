import { pagesFromFile, textKind, type TextStatus } from "./text";
import { indexStoredFile, markDocumentText, storeDocumentText } from "./text.functions";
import { storeKnowledgeText } from "@/lib/assistant/assistant.functions";
import type { IndexTarget } from "./index.server";

// Both uploads and retries share this queue. Pending rows survive a closed tab and are retryable.
let tail: Promise<unknown> = Promise.resolve();
const running = new Map<string, Promise<TextStatus | "failed">>();
export function enqueueFile(target: IndexTarget, id: string, file: Blob, mime: string | null, name: string): Promise<TextStatus | "failed"> {
  const key = `${target}:${id}`;
  const current = running.get(key);
  if (current) return current;
  const work = tail.catch(() => {}).then(async (): Promise<TextStatus | "failed"> => {
    try {
      if (textKind(mime, name) !== "pdf") return (await indexStoredFile({ data: { target, id } })).status;
      // Preserve the established PDF reader, which requires a browser worker.
      const result = await pagesFromFile(file, mime, name);
      if (target === "document") return (await storeDocumentText({ data: { documentId: id, pages: result.pages, status: result.status } })).status;
      return (await storeKnowledgeText({ data: { itemId: id, pages: result.pages, status: result.status } })).status;
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (target === "document") await markDocumentText({ data: { documentId: id, status: "failed", reason } }).catch(() => {});
      else await storeKnowledgeText({ data: { itemId: id, pages: [], status: "failed", reason } }).catch(() => {});
      return "failed";
    }
  });
  running.set(key, work);
  tail = work;
  void work.finally(() => running.delete(key));
  return work;
}
