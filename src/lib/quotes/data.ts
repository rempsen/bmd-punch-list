import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { QUOTE_COLS, type QuoteRow } from "./load";

export type Clause = { id: string; kind: "inclusion" | "exclusion" | "clarification"; body: string; is_default: boolean; sort_order: number };

export function useQuotes(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["quotes", projectId],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const { data, error } = await db.from("quotes").select(QUOTE_COLS).eq("project_id", projectId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as QuoteRow[];
    },
  });
}

export function useClauses(enabled = true) {
  return useQuery({
    queryKey: ["quote-clauses"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("quote_clauses").select("id,kind,body,is_default,sort_order").eq("active", true).order("sort_order");
      if (error) throw error;
      return (data ?? []) as Clause[];
    },
  });
}

export function useRefreshQuotes(projectId: string | null) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["quotes", projectId] });
    void qc.invalidateQueries({ queryKey: ["estimate", projectId] });
    void qc.invalidateQueries({ queryKey: ["pipeline"] });
    void qc.invalidateQueries({ queryKey: ["documents", projectId] });
  };
}

async function rpc<T = null>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(/quotes_one_accepted_key/.test(error.message) ? "Another revision of this quote has already been accepted." : error.message);
  return data as T;
}
export const createQuote = (projectId: string, versionIds: string[]) => rpc<string>("create_quote", { _project: projectId, _version_ids: versionIds });
export const acceptQuote = (id: string, versionId: string, note: string | null) => rpc("accept_quote", { _id: id, _version: versionId, _note: note });
export const declineQuote = (id: string, note: string | null) => rpc("decline_quote", { _id: id, _note: note });
export const reviseQuote = (id: string) => rpc<string>("revise_quote", { _id: id });
export const deleteQuote = (id: string) => rpc("delete_quote", { _id: id });

export type QuotePatch = Partial<Pick<QuoteRow, "validity_days" | "presentation" | "display" | "drawing_sheets" | "inclusions" | "exclusions" | "clarifications" | "deposit" | "attention" | "client_notes">>;
export async function updateQuote(id: string, patch: QuotePatch) {
  const { error } = await db.from("quotes").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
