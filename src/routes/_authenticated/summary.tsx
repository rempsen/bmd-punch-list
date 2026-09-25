import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Camera, ImageOff, MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { isClosed, itemNo } from "@/lib/bmd";
import { useAllEvents, useDeficiencies, usePhotos, type DefRow } from "@/lib/data";
import { useSignedUrls } from "@/lib/photos";
import { summarisePunchList } from "@/lib/summary.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/summary")({
  head: () => ({
    meta: [
      { title: "Punch list summary — BMD Materials" },
      { name: "description", content: "What's still open on the job: open deficiencies with photos, latest notes and an AI-written status summary." },
      { property: "og:title", content: "Punch list summary — BMD Materials" },
      { property: "og:description", content: "Open deficiencies, photos, notes and an AI status summary for the current job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SummaryPage,
});

const today = () => new Date().toISOString().slice(0, 10);

function SummaryPage() {
  const { projectId, currentJob } = useAuth();
  const { data: items = [] } = useDeficiencies(projectId ?? undefined);
  const open = useMemo(() => items.filter((d) => !isClosed(d.status)).sort((a, b) => a.item_number - b.item_number), [items]);
  const { data: photos = [] } = usePhotos(open.map((d) => d.id));
  const { data: events = [] } = useAllEvents(projectId ?? undefined);
  const paths = useMemo(() => photos.map((p) => p.storage_path), [photos]);
  const { data: urls = {} } = useSignedUrls(paths);
  const run = useServerFn(summarisePunchList);
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byDef = useMemo(() => {
    const m = new Map<string, { before: string[]; after: string[]; notes: { note: string; at: string }[] }>();
    for (const d of open) m.set(d.id, { before: [], after: [], notes: [] });
    for (const p of photos) m.get(p.deficiency_id)?.[p.kind === "after" ? "after" : "before"].push(p.storage_path);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      const x = m.get(e.deficiency_id);
      if (x && e.note && x.notes.length < 2) x.notes.push({ note: e.note, at: e.created_at });
    }
    return m;
  }, [open, photos, events]);

  const t = today();
  const stats = {
    open: open.length,
    mustFix: open.filter((d) => d.assessment === "must_fix").length,
    client: open.filter((d) => d.status === "awaiting_client").length,
    overdue: open.filter((d) => d.due_date && d.due_date < t).length,
    noAfter: open.filter((d) => d.status === "fixed" && !byDef.get(d.id)?.after.length).length,
    noPhoto: open.filter((d) => !byDef.get(d.id)?.before.length && !byDef.get(d.id)?.after.length).length,
  };

  const floors = useMemo(() => {
    const g = new Map<string, { label: string; order: number; rows: DefRow[] }>();
    for (const d of open) {
      const f = d.locations?.floors;
      const k = f?.label ?? "No floor";
      const cur = g.get(k) ?? { label: k, order: f?.number ?? 999, rows: [] };
      cur.rows.push(d);
      g.set(k, cur);
    }
    return [...g.values()].sort((a, b) => a.order - b.order);
  }, [open]);

  const generate = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await run({ data: { projectId } });
      setAi(r.summary);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <PageHeader title="Punch list summary" subtitle={currentJob?.name} />
      <div className="space-y-6 px-4 md:px-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat n={stats.open} l="Still open" />
          <Stat n={stats.mustFix} l="Must fix" tone={stats.mustFix ? "bad" : undefined} />
          <Stat n={stats.client} l="Waiting on client" />
          <Stat n={stats.overdue} l="Overdue" tone={stats.overdue ? "bad" : undefined} />
          <Stat n={stats.noAfter} l="Fixed, no after photo" tone={stats.noAfter ? "warn" : undefined} />
          <Stat n={stats.noPhoto} l="No photos at all" tone={stats.noPhoto ? "warn" : undefined} />
        </div>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> AI status summary</h2>
            <Button size="sm" onClick={generate} disabled={busy || !projectId}>
              {busy ? "Writing summary…" : ai ? "Refresh summary" : "Write summary"}
            </Button>
          </div>
          {ai ? (
            <div className="prose prose-sm mt-3 max-w-none text-foreground [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_li]:my-0.5">
              <ReactMarkdown>{ai}</ReactMarkdown>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {busy ? "Reading every item, photo count, note and client request… this can take up to a minute." : "Reads every item, its photos, notes, client requests and the CompanyCam Photo inbox, then writes a plain-English summary of what's still open and what to do next."}
            </p>
          )}
        </section>

        {open.length === 0 ? (
          <div className="flex min-h-[30vh] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
            <p className="text-3xl font-bold">Nothing open</p>
            <p className="mt-1 text-sm text-muted-foreground">Every item on this job is verified or accepted.</p>
          </div>
        ) : (
          floors.map((f) => (
            <section key={f.label}>
              <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">{f.label} · {f.rows.length} open</h2>
              <ul className="space-y-2">
                {f.rows.map((d) => {
                  const x = byDef.get(d.id)!;
                  const overdue = d.due_date && d.due_date < t;
                  const thumbs = [...x.before.map((p) => ({ p, k: "Before" })), ...x.after.map((p) => ({ p, k: "After" }))].slice(0, 3);
                  return (
                    <li key={d.id}>
                      <Link to="/item/$id" params={{ id: d.id }} className="flex gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted/50">
                        <div className="flex shrink-0 gap-1.5">
                          {thumbs.length ? thumbs.map((t) => (
                            <div key={t.p} className="relative">
                              {urls[t.p] ? <img src={urls[t.p]} alt={`${t.k} photo`} className="h-24 w-32 rounded-md bg-muted object-cover" loading="lazy" /> : <div className="h-24 w-32 rounded-md bg-muted" />}
                              <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-semibold">{t.k}</span>
                            </div>
                          )) : (
                            <div className="flex h-24 w-32 flex-col items-center justify-center rounded-md bg-muted text-xs text-muted-foreground"><ImageOff className="mb-1 h-5 w-5" />No photo</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{itemNo(d.item_number)} · {d.locations?.name}</span>
                            <AssessmentBadge value={d.assessment} />
                            <StatusBadge value={d.status} />
                            {overdue && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">Overdue</span>}
                            {d.status === "fixed" && !x.after.length && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium"><Camera className="mr-1 inline h-3 w-3" />Needs after photo</span>}
                          </div>
                          <p className="text-muted-foreground">{d.material} · {d.issue_type} · {d.area}</p>
                          {d.description && <p className="line-clamp-2">{d.description}</p>}
                          <p className="text-xs text-muted-foreground">
                            {d.assigned_trade ? `Assigned: ${d.assigned_trade}` : "Not yet assigned"}
                            {d.due_date ? ` · Due ${d.due_date}` : ""}
                            {` · ${x.before.length} before / ${x.after.length} after`}
                          </p>
                          {x.notes.map((n) => (
                            <p key={n.at} className="flex gap-1.5 text-xs"><MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" /><span className="line-clamp-2">{n.note}</span></p>
                          ))}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ n, l, tone }: { n: number; l: string; tone?: "bad" | "warn" | undefined }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", tone === "bad" ? "border-destructive/40" : tone === "warn" ? "border-blush" : "border-border")}>
      <p className={cn("text-2xl font-bold", tone === "bad" && "text-destructive")}>{n}</p>
      <p className="text-xs text-muted-foreground">{l}</p>
    </div>
  );
}
