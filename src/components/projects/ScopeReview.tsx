import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { reviewScopeHitsWithAi } from "@/lib/documents/scope.functions";
import { verdictLabel } from "@/lib/documents/scope-ai";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { db, errText } from "@/lib/platform/db";
import { toCsv } from "@/lib/projects/pipeline";
import { SCOPE_GROUPS, scansForScope, scopeGroupLabel } from "@/lib/documents/scope-keywords";
import { useProjectScopeHits, useRefreshScope, useScopeKeywords, type ScopeHitRow } from "@/lib/documents/scope-data";
import type { DocRow } from "@/lib/documents/logic";
import { cn } from "@/lib/utils";

/** Runs the one-time scan of existing documents the first time a BMD staff member opens a screen that shows hits. */
export function useScopeBackfillOnce(enabled: boolean) {
  const refresh = useRefreshScope();
  const tried = useRef(false);
  useEffect(() => {
    if (!enabled || tried.current) return;
    tried.current = true;
    void (async () => {
      try {
        const { data } = await db.from("scope_scan_state").select("backfilled_at").maybeSingle();
        if ((data as { backfilled_at: string | null } | null)?.backfilled_at) return;
        const { ensureScopeBackfill } = await import("@/lib/documents/scope.functions");
        const r = await ensureScopeBackfill();
        if (r.ran) refresh();
      } catch (e) {
        console.error(`[scope] backfill: ${errText(e)}`);
      }
    })();
  }, [enabled, refresh]);
}

/** The "Scope hits · N" badge on a Plans/Specs document, or "Scan pending" before its text is read. */
export function ScopeBadge({ doc, hits }: { doc: DocRow; hits: ScopeHitRow[] | undefined }) {
  if (!hits || !scansForScope(doc.section, doc.file_name)) return null;
  if (doc.text_status !== "done") {
    if (doc.text_status === "pending" || !doc.text_status) return <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Scan pending</span>;
    return null;
  }
  const n = hits.filter((h) => h.document_id === doc.id).reduce((t, h) => t + h.count, 0);
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", n > 0 ? "bg-primary/10 font-medium text-primary" : "bg-muted text-muted-foreground")}>Scope hits · {n}</span>;
}

/** Hits for this project grouped by keyword group → keyword → document, with a Reviewed tick per hit. */
export function ScopeReviewPanel({ projectId, docs, hits }: { projectId: string; docs: DocRow[]; hits: ScopeHitRow[] }) {
  const { user, canAny, isSuperAdmin } = useAuth();
  const canReview = isSuperAdmin || canAny("manage_projects") || canAny("capture_items");
  const { data: keywords = [] } = useScopeKeywords();
  const refresh = useRefreshScope();
  const [filter, setFilter] = useState<"unreviewed" | "all" | "in_scope">("unreviewed");
  const [aiBusy, setAiBusy] = useState(false);
  const reviewAi = useServerFn(reviewScopeHitsWithAi);
  const canAi = isSuperAdmin || canAny("view_pipeline");
  const runAi = async () => {
    setAiBusy(true);
    try {
      const r = await reviewAi({ data: { projectId } });
      toast.success(r.reviewed ? `AI reviewed ${r.reviewed} hit${r.reviewed === 1 ? "" : "s"} · ${r.inScope} likely BMD scope` : "Nothing new for the AI to review.");
      refresh();
    } catch (e) {
      toast.error(`AI review failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  };
  const docName = useMemo(() => new Map(docs.map((d) => [d.id, d.file_name])), [docs]);
  const kwById = useMemo(() => new Map(keywords.map((k) => [k.id, k])), [keywords]);
  const shown = hits.filter((h) => filter === "all" || (filter === "in_scope" ? !h.reviewed_at && h.ai_verdict === "in_scope" : !h.reviewed_at));
  const unreviewed = hits.filter((h) => !h.reviewed_at).length;

  const groups = SCOPE_GROUPS.map((g) => {
    const kws = keywords.filter((k) => k.group_key === g.key).map((k) => ({ k, hits: shown.filter((h) => h.keyword_id === k.id) })).filter((x) => x.hits.length);
    return { g, kws };
  }).filter((x) => x.kws.length);

  const setReviewed = async (h: ScopeHitRow, on: boolean) => {
    const { error } = await db.from("document_scope_hits").update({ reviewed_at: on ? new Date().toISOString() : null, reviewed_by: on ? (user?.id ?? null) : null }).eq("id", h.id);
    if (error) toast.error(`Could not save: ${errText(error)}`);
    refresh();
  };

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [["Group", "Keyword", "Document", "Page", "Count", "Snippet", "AI verdict", "AI suggestion", "Reviewed"]];
    for (const h of hits) {
      const k = kwById.get(h.keyword_id);
      rows.push([scopeGroupLabel(k?.group_key ?? ""), k?.term ?? "", docName.get(h.document_id) ?? "", h.page, h.count, h.snippet, verdictLabel(h.ai_verdict), h.ai_suggestion ?? "", h.reviewed_at ? h.reviewed_at.slice(0, 10) : ""]);
    }
    const url = URL.createObjectURL(new Blob([`\uFEFF${toCsv(rows)}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `bmd-scope-hits-${projectId.slice(0, 8)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label="Scope review" className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">Scope review</h2>
          <p className="text-xs text-muted-foreground">BMD scope terms found in plans and specs · {unreviewed} to review</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as "unreviewed" | "all" | "in_scope")} aria-label="Show">
            <option value="unreviewed">Unreviewed</option>
            <option value="in_scope">AI: likely scope</option>
            <option value="all">All</option>
          </select>
          {canAi && (
            <Button variant="outline" size="sm" className="h-10" onClick={() => void runAi()} disabled={aiBusy || unreviewed === 0}>
              <Sparkles className="mr-2 h-4 w-4" /> {aiBusy ? "Reviewing…" : "AI review"}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-10" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </header>
      {groups.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Everything has been reviewed.</p>
      ) : (
        <div className="max-h-[28rem] divide-y divide-border overflow-auto">
          {groups.map(({ g, kws }) => (
            <div key={g.key} className="px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
              {kws.map(({ k, hits: hs }) => (
                <div key={k.id} className="mt-2">
                  <p className="text-sm font-medium">{k.term} <span className="text-xs font-normal text-muted-foreground">· {hs.reduce((t, h) => t + h.count, 0)}</span></p>
                  <ul className="mt-1 space-y-1">
                    {hs.map((h) => (
                      <li key={h.id} className="flex items-start gap-2 text-sm">
                        <Checkbox className="mt-0.5" checked={!!h.reviewed_at} disabled={!canReview} onCheckedChange={(v) => void setReviewed(h, v === true)} aria-label={`Reviewed: ${k.term} in ${docName.get(h.document_id) ?? "document"}${h.page ? ` page ${h.page}` : ""}`} />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {docName.get(h.document_id) ?? "Document"}
                            {h.page ? ` · p. ${h.page}` : ""}
                            {h.count > 1 ? ` · ${h.count}×` : ""}
                          </p>
                          <p className="text-sm">{h.snippet}</p>
                          {h.ai_verdict && (
                            <p className="mt-0.5 text-xs">
                              <span className={cn("mr-1.5 rounded px-1.5 py-0.5 font-medium", h.ai_verdict === "in_scope" ? "bg-primary/10 text-primary" : h.ai_verdict === "not_scope" ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground")}>{verdictLabel(h.ai_verdict)}</span>
                              <span className="text-muted-foreground">{h.ai_suggestion}</span>
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
