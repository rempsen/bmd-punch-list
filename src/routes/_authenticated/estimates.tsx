import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { StageBadge } from "@/components/projects/StageBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useTaxSettings } from "@/lib/catalogue/data";
import { shapeLine } from "@/lib/estimating/data";
import { versionSummary } from "@/lib/estimating/worksheet";
import { db } from "@/lib/platform/db";
import { holderOf, money, shortDate, staffName, useBmdStaff, usePipelineProjects } from "@/lib/projects/data";
import { clientJobs } from "@/lib/projects/joblist";
import { toCsv } from "@/lib/projects/pipeline";
import { STAGES, stageLabel } from "@/lib/projects/stages";
import { QUOTE_STATUSES, latestQuote, listSummary, quoteTotal, type ListQuote } from "@/lib/quotes/list";

type Search = { q?: string | undefined; status?: string | undefined; stage?: string | undefined };

export const Route = createFileRoute("/_authenticated/estimates")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    status: typeof s["status"] === "string" && s["status"] ? s["status"] : undefined,
    stage: typeof s["stage"] === "string" && s["stage"] ? s["stage"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Estimates & Quotes · BMD Materials" },
      { name: "description", content: "Every BMD estimate and quote across all jobs, with status, totals and who owns it." },
      { property: "og:title", content: "Estimates & Quotes · BMD Materials" },
      { property: "og:description", content: "Every estimate and quote, across all jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EstimatesPage,
});

const field = "h-10 rounded-md border border-input bg-background px-2 text-sm";

function EstimatesPage() {
  const { canAny } = useAuth();
  if (!canAny("view_pricing")) return <Navigate to="/" replace />;
  return <EstimatesList />;
}

function EstimatesList() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/estimates" });
  const set = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const projects = usePipelineProjects();
  const staff = useBmdStaff();
  const tax = useTaxSettings();
  // One query for every project's base estimate, priced here the same way the Estimate tab prices it.
  const estimates = useQuery({
    queryKey: ["all-estimates"],
    queryFn: async () => {
      const { data, error } = await db
        .from("estimate_versions")
        .select("id,project_id,created_at,lines:estimate_lines(*,components:estimate_line_components(*))")
        .eq("kind", "estimate")
        .eq("is_base", true);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    },
  });
  const quotes = useQuery({
    queryKey: ["all-quotes"],
    queryFn: async () => {
      const { data, error } = await db.from("quotes").select("id,project_id,number,status,value_cents,accepted_value_cents,sent_at,accepted_at,created_at").eq("kind", "quote");
      if (error) throw error;
      return (data ?? []) as ListQuote[];
    },
  });

  const rows = useMemo(() => {
    const t = tax.data;
    const rates = t ? { pstPct: t.pst_pct, gstPct: t.gst_pct, hstPct: t.hst_pct } : null;
    const est = new Map<string, { cents: number | null; at: string }>();
    for (const v of estimates.data ?? []) {
      const lines = (v.lines as unknown[]).map(shapeLine);
      est.set(v.project_id, { cents: rates ? versionSummary(lines, rates).sellCents : null, at: v.created_at });
    }
    const qs = new Map<string, ListQuote[]>();
    for (const q of quotes.data ?? []) qs.set(q.project_id, [...(qs.get(q.project_id) ?? []), q]);
    return clientJobs(projects.data ?? [])
      .filter((p) => est.has(p.id) || qs.has(p.id))
      .map((p) => {
        const list = qs.get(p.id) ?? [];
        const quote = latestQuote(list);
        const stamps = [est.get(p.id)?.at, ...list.flatMap((q) => [q.created_at, q.sent_at, q.accepted_at])].filter((x): x is string => !!x);
        return {
          p,
          estimateCents: est.get(p.id)?.cents ?? null,
          hasEstimate: est.has(p.id),
          quote,
          more: Math.max(0, list.filter((q) => q.status !== "superseded").length - 1),
          owner: staffName(staff.data ?? [], holderOf(p, "estimator")),
          updated: stamps.sort().at(-1) ?? p.created_at,
        };
      })
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }, [projects.data, estimates.data, quotes.data, tax.data, staff.data]);

  const shown = rows.filter((r) => {
    const s = search.q?.toLowerCase().trim();
    if (s && ![r.p.name, r.p.client_name, r.p.project_number, r.quote?.number].some((x) => x?.toLowerCase().includes(s))) return false;
    if (search.status && r.quote?.status !== search.status) return false;
    if (search.stage && r.p.stage !== search.stage) return false;
    return true;
  });
  const sum = listSummary(shown.map((r) => ({ projectId: r.p.id, hasEstimate: r.hasEstimate, quote: r.quote })), new Date());
  const loading = projects.isLoading || estimates.isLoading || quotes.isLoading;
  const err = projects.error || estimates.error || quotes.error;

  const exportCsv = () => {
    const data = [
      ["Project #", "Project", "Client", "Stage", "Estimate total", "Quote", "Quote status", "Quote total", "Sent", "Owner", "Updated"],
      ...shown.map((r) => [
        r.p.project_number, r.p.name, r.p.client_name, stageLabel(r.p.stage),
        r.estimateCents == null ? null : r.estimateCents / 100,
        r.quote?.number ?? null, r.quote ? (QUOTE_STATUSES.find((s) => s.value === r.quote!.status)?.label ?? r.quote.status) : null,
        quoteTotal(r.quote) == null ? null : quoteTotal(r.quote)! / 100,
        r.quote?.sent_at?.slice(0, 10) ?? null, r.owner || null, r.updated.slice(0, 10),
      ]),
    ];
    const url = URL.createObjectURL(new Blob([`\uFEFF${toCsv(data)}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `bmd-estimates-quotes-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Estimates & Quotes" subtitle="Every estimate and quote, across all jobs" />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Search" placeholder="Search project, client, number or quote…" defaultValue={search.q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} className="h-10 w-72 max-w-full" />
          <select aria-label="Quote status" className={field} value={search.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">All quote statuses</option>
            {QUOTE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select aria-label="Stage" className={field} value={search.stage ?? ""} onChange={(e) => set({ stage: e.target.value || undefined })}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <Button variant="outline" onClick={exportCsv} disabled={shown.length === 0} className="ml-auto">
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Estimates with no quote" value={String(sum.noQuote)} />
          <Stat label={`Quotes out (${sum.outCount})`} value={money(sum.outCents)} />
          <Stat label="Won this month" value={money(sum.wonCents)} />
        </div>

        {err ? (
          <p className="text-sm text-destructive">{err instanceof Error ? err.message : String(err)}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No estimates or quotes match.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  {["Project", "Client", "Stage", "Estimate total", "Quote", "Quote total", "Sent", "Owner", "Updated", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => {
                  const st = r.quote ? QUOTE_STATUSES.find((s) => s.value === r.quote!.status) : null;
                  const qt = quoteTotal(r.quote);
                  return (
                    <tr key={r.p.id}>
                      <td className="px-3 py-2">
                        <Link to="/projects/$id" params={{ id: r.p.id }} className="font-medium hover:underline">
                          {r.p.project_number && <span className="mr-1 text-muted-foreground">{r.p.project_number}</span>}
                          {r.p.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{r.p.client_name}</td>
                      <td className="px-3 py-2"><StageBadge stage={r.p.stage} /></td>
                      <td className="px-3 py-2 tabular-nums">{r.hasEstimate ? money(r.estimateCents) : "—"}</td>
                      <td className="px-3 py-2">
                        {r.quote ? (
                          <span className="whitespace-nowrap">
                            {r.quote.number}
                            {st && <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>}
                            {r.more > 0 && <span className="ml-1 text-xs text-muted-foreground">+{r.more} more</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No quote</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{qt == null ? "—" : money(qt)}</td>
                      <td className="px-3 py-2">{r.quote?.sent_at ? shortDate(r.quote.sent_at) : "—"}</td>
                      <td className="px-3 py-2">{r.owner || "—"}</td>
                      <td className="px-3 py-2">{shortDate(r.updated)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Link to="/projects/$id" params={{ id: r.p.id }} search={{ tab: "estimate" }} className="mr-3 text-primary hover:underline">Open estimate</Link>
                        <Link to="/projects/$id" params={{ id: r.p.id }} search={{ tab: "quotes" }} className="text-primary hover:underline">Open quotes</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
