import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { ScopeKeyword } from "./scope-keywords";

export type ScopeHitRow = { id: string; document_id: string; project_id: string; keyword_id: string; page: number | null; snippet: string; count: number; reviewed_at: string | null; reviewed_by: string | null; ai_verdict: string | null; ai_suggestion: string | null; ai_at: string | null };

export function useScopeKeywords() {
  return useQuery({
    queryKey: ["scope-keywords"],
    queryFn: async () => {
      const { data, error } = await db.from("scope_keywords").select("id,term,group_key,whole_word,active,sort").order("sort").order("term");
      if (error) throw error;
      return (data ?? []) as Required<ScopeKeyword>[];
    },
  });
}

export function useProjectScopeHits(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["scope-hits", projectId],
    enabled: !!projectId && enabled,
    queryFn: async () => {
      const { data, error } = await db.from("document_scope_hits").select("id,document_id,project_id,keyword_id,page,snippet,count,reviewed_at,reviewed_by,ai_verdict,ai_suggestion,ai_at").eq("project_id", projectId!).order("page");
      if (error) throw error;
      return (data ?? []) as ScopeHitRow[];
    },
  });
}

/** Unreviewed hit counts per project, for the Overview card. */
export function useUnreviewedScopeByProject(enabled: boolean) {
  return useQuery({
    queryKey: ["scope-hits-unreviewed"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("document_scope_hits").select("project_id").is("reviewed_at", null).limit(5000);
      if (error) throw error;
      const by = new Map<string, { id: string; count: number }>();
      for (const r of (data ?? []) as { project_id: string }[]) {
        const e = by.get(r.project_id) ?? { id: r.project_id, count: 0 };
        e.count += 1;
        by.set(r.project_id, e);
      }
      return [...by.values()].sort((a, b) => b.count - a.count);
    },
  });
}

export function useRefreshScope() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["scope-hits"] });
    void qc.invalidateQueries({ queryKey: ["scope-hits-unreviewed"] });
  };
}
