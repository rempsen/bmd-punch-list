import { textKind } from "./text";
export type IndexFile = { file_name: string | null; mime: string | null; text_status?: string | null; text_pages?: number | null; text_error?: string | null };
export function isOfficeFile(file: IndexFile) {
  return ["docx", "spreadsheet", "csv"].includes(textKind(file.mime, file.file_name ?? ""));
}
export function needsIndex(file: IndexFile) {
  if (textKind(file.mime, file.file_name ?? "") === "none") return false;
  return !file.text_status || file.text_status === "pending" || file.text_status === "failed" || (file.text_status === "no_text" && isOfficeFile(file));
}
export function indexStatus(file: IndexFile) {
  if (textKind(file.mime, file.file_name ?? "") === "none") return "Not searchable";
  if (file.text_status === "done") return `Indexed · ${file.text_pages ?? 0} pages`;
  if (file.text_status === "failed") return `Failed (${file.text_error ?? "Could not read file text"})`;
  if (file.text_status === "no_text" && !isOfficeFile(file)) return "Not searchable · no text found";
  return "Indexing…";
}
