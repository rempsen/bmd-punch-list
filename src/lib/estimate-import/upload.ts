import { uploadDocument } from "@/lib/documents/upload";
import { runEstimateImport } from "./run.functions";
import { sourceKindOf } from "./kind";

/** File an estimate under Documents → "Estimates (imported)" and parse it into an import. */
export async function uploadEstimateFile(projectId: string, file: File, onProgress: (sent: number, total: number) => void = () => {}) {
  sourceKindOf(file.name); // refuses other file types before uploading
  const documentId = await uploadDocument({ projectId, section: "estimates_imported", file, onProgress }).done;
  return { documentId, ...(await runEstimateImport({ data: { projectId, documentId } })) };
}
