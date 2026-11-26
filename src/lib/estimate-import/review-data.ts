import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { Decision } from "./commit";
import type { MatchResult } from "./match";
import type { ImportOptions, ImportSummary, Mapping, ParsedRow } from "./types";

export type RowMatch = Partial<MatchResult> & { status: string; decision?: Decision };
export type ReviewRow = ParsedRow & { id: string; match: RowMatch; estimate_line_id: string | null };
export type ReviewImport = { id: string; project_id: string; file_name: string; created_at: string; created_by: string | null; status: string; mapping: Mapping; options: ImportOptions; summary: ImportSummary; estimate_version_id: string | null; rows: ReviewRow[] };

export async function loadReview(id: string): Promise<ReviewImport> {
  const { data, error } = await db.from("estimate_imports").select("*,rows:estimate_import_rows(*)").eq("id", id).single();
  if (error) throw new Error(error.message);
  const d = data as unknown as ReviewImport;
  return { ...d, rows: [...d.rows].sort((a, b) => (a.row_no ?? 0) - (b.row_no ?? 0)) };
}

/** Saves the match found for a row, and the decision taken on it, so an import can be picked up later. */
export async function saveRowMatch(rowId: string, match: RowMatch) {
  const { error } = await db.from("estimate_import_rows").update({ match: match as never, updated_at: new Date().toISOString() }).eq("id", rowId);
  if (error) throw new Error(error.message);
}

export type ImportListRow = { id: string; file_name: string | null; created_at: string; created_by: string | null; status: string; estimate_version_id: string | null; rows: { id: string; kind: string | null }[] };
export function useImports(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ["estimate-imports", projectId],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("estimate_imports").select("id,file_name,created_at,created_by,status,estimate_version_id,rows:estimate_import_rows(id,kind)").eq("project_id", projectId).not("source_kind", "is", null).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ImportListRow[];
    },
  });
}

/** Commits the reviewed lines as one estimate version (a new alternate, or the Base when there is none, or appended to the Base). */
export async function commitImportLines(importId: string, items: unknown[], append: boolean, ack: boolean, sell: number): Promise<string> {
  const { data, error } = await db.rpc("commit_estimate_import" as never, { _import: importId, _items: items, _append: append, _ack: ack, _sell: sell } as never);
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

export async function undoImport(importId: string) {
  const { error } = await db.rpc("undo_estimate_import" as never, { _import: importId } as never);
  if (error) throw new Error(error.message);
}
