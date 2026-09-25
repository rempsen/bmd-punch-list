import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, CheckCircle2, ExternalLink, Link2, Plus, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { itemNo } from "@/lib/bmd";
import { useDeficiencies, usePickLists, useProject } from "@/lib/data";
import { cn } from "@/lib/utils";
import {
  ccCreateProject, ccInboxAction, ccLinkProject, ccRefreshUsers, ccSaveOptions, ccSearchProjects, ccStatus, ccSuggestionAction, ccSyncNow, ccWebhook,
} from "@/lib/companycam.functions";

export const Route = createFileRoute("/_authenticated/companycam")({
  head: () => ({
    meta: [
      { title: "CompanyCam — BMD Deficiency Tracker" },
      { name: "description", content: "Link jobs to CompanyCam, sync deficiency photos and tasks, and review incoming jobsite photos." },
      { property: "og:title", content: "CompanyCam — BMD Deficiency Tracker" },
      { property: "og:description", content: "Two-way CompanyCam photo and task sync for BMD jobs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompanyCamPage,
});

const OPTS = [
  ["photos_out", "Send deficiency photos to CompanyCam"],
  ["tasks_out", "Create CompanyCam tasks for must-fix items"],
  ["comments_out", "Post status changes and client decisions as comments"],
  ["documents_out", "Allow “Send to CompanyCam” from Exports"],
  ["photos_in", "Bring new CompanyCam photos into the Photo inbox"],
  ["comments_in", "Copy CompanyCam photo comments into item history"],
  ["tasks_in", "Task completed in CompanyCam marks the item Fixed"],
] as const;

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");

function useStatus(projectId: string | undefined) {
  const status = useServerFn(ccStatus);
  return useQuery({ queryKey: ["cc-status", projectId], enabled: !!projectId, queryFn: () => status({ data: { projectId: projectId! } }) });
}

function CompanyCamPage() {
  const { can, role, currentJob } = useAuth();
  const manager = can("manage_settings");
  const { data: st } = useStatus(currentJob?.id);
  if (!currentJob) return null;
  if (!manager && role !== "bmd_field" && !can("capture_items")) return <div className="p-6 text-sm text-muted-foreground">You don't have access to CompanyCam.</div>;

  return (
    <div>
      <PageHeader title={manager ? "CompanyCam" : "Photo inbox"} subtitle={currentJob.name} />
      <div className="px-4 py-4 md:px-6">
        <ConnectionBanner st={st} />
        {manager ? (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="inbox">Photo inbox</TabsTrigger>
              <TabsTrigger value="match">Match &amp; link</TabsTrigger>
              <TabsTrigger value="log">Sync log</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview"><Overview st={st} /></TabsContent>
            <TabsContent value="inbox"><Inbox canAct /></TabsContent>
            <TabsContent value="match"><Match st={st} /></TabsContent>
            <TabsContent value="log"><SyncLog /></TabsContent>
            <TabsContent value="settings"><SettingsTab st={st} /></TabsContent>
          </Tabs>
        ) : (
          <div className="mt-4"><Inbox canAct={false} /></div>
        )}
      </div>
    </div>
  );
}

type St = Awaited<ReturnType<typeof ccStatus>> | undefined;

function ConnectionBanner({ st }: { st: St }) {
  if (!st) return <div className="h-14 animate-pulse rounded-lg bg-muted" />;
  return st.connected ? (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <CheckCircle2 className="h-5 w-5 text-primary" /> Connected as <strong>{st.company}</strong>
    </div>
  ) : (
    <div className="rounded-lg border border-blush bg-card px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold"><XCircle className="h-5 w-5 text-muted-foreground" /> Not connected</p>
      <p className="mt-1 text-muted-foreground">
        {st.error ? `CompanyCam refused the saved token: ${st.error}` : "CompanyCam's access token hasn't been added yet. Everything below will start working once it is."}
      </p>
    </div>
  );
}

function Overview({ st }: { st: St }) {
  const qc = useQueryClient();
  const { currentJob } = useAuth();
  const sync = useServerFn(ccSyncNow);
  const [busy, setBusy] = useState(false);
  const p = st?.project;
  const { data: counts } = useQuery({
    queryKey: ["cc-counts", currentJob?.id],
    enabled: !!currentJob,
    queryFn: async () => {
      const [inbox, logOk, logErr] = await Promise.all([
        supabase.from("companycam_inbox").select("id", { count: "exact", head: true }).eq("project_id", currentJob!.id).eq("status", "new"),
        supabase.from("companycam_sync_log").select("id", { count: "exact", head: true }).eq("project_id", currentJob!.id).eq("status", "ok"),
        supabase.from("companycam_sync_log").select("id", { count: "exact", head: true }).eq("project_id", currentJob!.id).eq("status", "error"),
      ]);
      return { inbox: inbox.count ?? 0, ok: logOk.count ?? 0, err: logErr.count ?? 0 };
    },
  });
  const run = async () => {
    setBusy(true);
    try {
      const r = await sync({ data: { projectId: currentJob!.id } });
      toast.success(`Synced: ${r.photosOut} photos sent, ${r.photosIn} new in inbox, ${r.tasks} tasks, ${r.comments} comments${r.errors ? ` — ${r.errors} problem(s), see Sync log` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["cc-status"] });
      void qc.invalidateQueries({ queryKey: ["cc-counts"] });
      void qc.invalidateQueries({ queryKey: ["cc-log"] });
      void qc.invalidateQueries({ queryKey: ["cc-inbox"] });
    }
  };
  if (!p?.companycam_project_id)
    return <p className="mt-4 rounded-lg border border-border bg-card p-4 text-sm">This job isn't linked to a CompanyCam project yet. Open <strong>Match &amp; link</strong> to find or create it.</p>;
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Linked CompanyCam project</h2>
        <p className="mt-2 text-sm">{st?.ccProject?.name ?? `Project #${p.companycam_project_id}`}</p>
        <p className="text-sm text-muted-foreground">ID {p.companycam_project_id}{typeof st?.ccProject?.photo_count === "number" ? ` · ${st.ccProject.photo_count} photos` : ""}</p>
        {p.companycam_project_url && (
          <a href={p.companycam_project_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
            Open in CompanyCam <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <p className="mt-3 text-sm">Sync is <strong>{p.companycam_sync_enabled ? "on" : "off"}</strong> · Last sync {fmt(p.companycam_last_sync_at)}</p>
      </section>
      <section className="rounded-lg border-2 border-primary/30 bg-card p-4">
        <h2 className="font-semibold">Sync</h2>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Stat n={counts?.inbox} l="New in inbox" />
          <Stat n={counts?.ok} l="Synced" />
          <Stat n={counts?.err} l="Problems" />
        </div>
        <Button className="mt-4 h-12 w-full text-base" disabled={busy || !st?.connected || !p.companycam_sync_enabled} onClick={() => void run()}>
          <RefreshCw className={cn("mr-2 h-5 w-5", busy && "animate-spin")} /> {busy ? "Syncing…" : "Sync now"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Also runs automatically every 3 hours, and instantly for CompanyCam events once the webhook is registered.</p>
      </section>
    </div>
  );
}
const Stat = ({ n, l }: { n?: number | undefined; l: string }) => (
  <div className="rounded-md bg-muted px-2 py-2">
    <p className="text-xl font-semibold">{n ?? "–"}</p>
    <p className="text-xs text-muted-foreground">{l}</p>
  </div>
);

// ---------------- Match & link ----------------
function Match({ st }: { st: St }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentJob } = useAuth();
  const search = useServerFn(ccSearchProjects);
  const link = useServerFn(ccLinkProject);
  const create = useServerFn(ccCreateProject);
  const act = useServerFn(ccSuggestionAction);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof ccSearchProjects>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const linked = st?.project?.companycam_project_id;
  const { data: sugg = [] } = useQuery({
    queryKey: ["cc-suggestions"],
    queryFn: async () => (await supabase.from("companycam_suggestions").select("*").eq("status", "open").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["cc-jobs"],
    queryFn: async () => (await supabase.from("projects").select("id,name,address,client_name,companycam_project_id").is("archived_at", null).order("name")).data ?? [],
  });
  const doSearch = async (query?: string) => {
    setBusy("search");
    try {
      setResults(await search({ data: { projectId: currentJob!.id, query } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (st?.connected && !linked && !results) void doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.connected, linked]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["cc-status"] });
    void qc.invalidateQueries({ queryKey: ["cc-suggestions"] });
    void qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const doLink = async (id: string | null, url?: string | null) => {
    if (id && !confirm(`Link “${currentJob!.name}” to CompanyCam project ${id}?`)) return;
    if (!id && !confirm("Unlink this job from CompanyCam? Nothing is deleted in either app.")) return;
    try {
      await link({ data: { projectId: currentJob!.id, ccProjectId: id, url } });
      toast.success(id ? "Linked" : "Unlinked");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 1));
  const jobScore = (j: { name: string; address: string | null }, s: { name: string | null; address: string | null }) => {
    const a = words(`${j.name} ${j.address ?? ""}`), b = words(`${s.name ?? ""} ${s.address ?? ""}`);
    let n = 0;
    for (const w of b) if (a.has(w)) n++;
    return b.size ? Math.round((n / b.size) * 100) : 0;
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">This job: {currentJob?.name}</h2>
        {linked ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span>Linked to CompanyCam project <strong>{linked}</strong></span>
            {st?.project?.companycam_project_url && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={st.project.companycam_project_url} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3.5 w-3.5" /></a>}
            <Button size="sm" variant="outline" onClick={() => void doLink(null)}>Unlink</Button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not linked. Pick the matching CompanyCam project below — nothing is ever linked automatically.</p>
        )}
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void doSearch(q.trim() || undefined); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CompanyCam projects by name or address" disabled={!st?.connected} />
          <Button type="submit" variant="secondary" disabled={!st?.connected || busy !== null}><Search className="mr-1 h-4 w-4" /> Search</Button>
        </form>
        {!st?.connected && <p className="mt-2 text-xs text-muted-foreground">Search needs the CompanyCam connection.</p>}
        {results && (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {results.length === 0 && <li className="p-3 text-sm text-muted-foreground">No CompanyCam projects found.</li>}
            {results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className={cn("w-12 rounded-full px-2 py-0.5 text-center text-xs font-semibold", r.score >= 60 ? "bg-primary text-primary-foreground" : "bg-muted")}>{r.score}%</span>
                <span className="min-w-0 flex-1"><span className="block font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.address || "No address"} · #{r.id}</span></span>
                <Button size="sm" disabled={r.id === linked} onClick={() => void doLink(r.id, r.url)}><Link2 className="mr-1 h-4 w-4" /> {r.id === linked ? "Linked" : "Link"}</Button>
              </li>
            ))}
          </ul>
        )}
        {!linked && (
          <Button className="mt-3" variant="outline" disabled={!st?.connected || busy !== null} onClick={async () => {
            if (!confirm(`Create “${currentJob!.name}” as a new CompanyCam project and link it?`)) return;
            setBusy("create");
            try { await create({ data: { projectId: currentJob!.id } }); toast.success("Created in CompanyCam and linked"); refresh(); }
            catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
          }}><Plus className="mr-1 h-4 w-4" /> Create this job in CompanyCam</Button>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">New in CompanyCam</h2>
        <p className="text-sm text-muted-foreground">CompanyCam projects not linked to any job yet — link to an existing job or create a job?</p>
        {sugg.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nothing waiting.</p>}
        <ul className="mt-3 space-y-3">
          {sugg.map((s) => {
            const ranked = jobs.filter((j) => !j.companycam_project_id).map((j) => ({ ...j, sc: jobScore(j, s) })).sort((a, b) => b.sc - a.sc).slice(0, 3);
            return (
              <li key={s.id} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{s.kind === "project_update" ? "Updated in CompanyCam: " : ""}{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.address || "No address"} · CompanyCam #{s.cc_project_id}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {s.kind === "project_update" ? (
                    <Button size="sm" onClick={async () => { if (!confirm("Update the job's name and address to match CompanyCam?")) return; try { await act({ data: { id: s.id, action: "apply" } }); refresh(); } catch (e) { toast.error((e as Error).message); } }}>Update job</Button>
                  ) : (
                    <>
                      {ranked.map((j) => (
                        <Button key={j.id} size="sm" variant="outline" onClick={async () => { if (!confirm(`Link CompanyCam “${s.name}” to job “${j.name}”?`)) return; try { await act({ data: { id: s.id, action: "link", projectId: j.id } }); toast.success("Linked"); refresh(); } catch (e) { toast.error((e as Error).message); } }}>
                          Link to {j.name} ({j.sc}%)
                        </Button>
                      ))}
                      <Button size="sm" onClick={async () => { try { const r = await act({ data: { id: s.id, action: "create" } }); if (r.draftId) void navigate({ to: "/new-job", search: { draft: r.draftId } }); } catch (e) { toast.error((e as Error).message); } }}>
                        <Plus className="mr-1 h-4 w-4" /> Create a job
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={async () => { await act({ data: { id: s.id, action: "dismiss" } }); refresh(); }}>Dismiss</Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------------- Photo inbox ----------------
type InboxRow = { id: string; cc_photo_id: string; thumb_url: string | null; photo_url: string | null; web_url: string | null; description: string | null; tags: string[]; taken_at: string | null; creator_name: string | null; status: string; deficiency_id: string | null };

function Inbox({ canAct }: { canAct: boolean }) {
  const { currentJob, can } = useAuth();
  const qc = useQueryClient();
  const act = useServerFn(ccInboxAction);
  const [show, setShow] = useState<"new" | "all">("new");
  const [open, setOpen] = useState<{ row: InboxRow; mode: "create" | "attach" } | null>(null);
  const { data: rows = [] } = useQuery({
    queryKey: ["cc-inbox", currentJob?.id],
    enabled: !!currentJob,
    queryFn: async () => ((await supabase.from("companycam_inbox").select("*").eq("project_id", currentJob!.id).order("taken_at", { ascending: false }).limit(200)).data ?? []) as InboxRow[],
  });
  const isDef = (r: InboxRow) => r.tags.some((t) => t.toLowerCase() === "deficiency");
  const shown = rows.filter((r) => show === "all" || r.status === "new").sort((a, b) => Number(isDef(b)) - Number(isDef(a)));
  const actions = canAct || can("capture_items");

  return (
    <div className="mt-4">
      <div className="mb-3 flex gap-2">
        {(["new", "all"] as const).map((k) => (
          <Button key={k} size="sm" variant={show === k ? "default" : "outline"} onClick={() => setShow(k)}>{k === "new" ? `New (${rows.filter((r) => r.status === "new").length})` : "All"}</Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No CompanyCam photos waiting. New photos on the linked CompanyCam project appear here after a sync.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id} className={cn("overflow-hidden rounded-lg border bg-card", isDef(r) ? "border-blush ring-1 ring-blush" : "border-border")}>
              {r.thumb_url ? <img src={r.thumb_url} alt={r.description ?? "CompanyCam photo"} className="aspect-[4/3] w-full object-cover" loading="lazy" /> : <div className="flex aspect-[4/3] items-center justify-center bg-muted"><Camera className="h-8 w-8 text-muted-foreground" /></div>}
              <div className="space-y-2 p-3 text-sm">
                <p className="line-clamp-2">{r.description || <span className="text-muted-foreground">No description</span>}</p>
                <p className="text-xs text-muted-foreground">{r.creator_name ?? "Unknown"} · {fmt(r.taken_at)}</p>
                {r.tags.length > 0 && <div className="flex flex-wrap gap-1">{r.tags.map((t) => <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">{t}</span>)}</div>}
                {r.status !== "new" ? (
                  <p className="text-xs font-medium">{r.status === "attached" && r.deficiency_id ? <Link to="/item/$id" params={{ id: r.deficiency_id }} className="text-primary hover:underline">Attached — open item</Link> : r.status === "ignored" ? "Ignored" : r.status}</p>
                ) : actions ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setOpen({ row: r, mode: "create" })}>Create deficiency</Button>
                    <Button size="sm" variant="secondary" onClick={() => setOpen({ row: r, mode: "attach" })}>Attach to item</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await act({ data: { id: r.id, action: "ignore" } }); void qc.invalidateQueries({ queryKey: ["cc-inbox"] }); }}>Ignore</Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <InboxDialog row={open.row} mode={open.mode} onClose={() => setOpen(null)} />}
    </div>
  );
}

function InboxDialog({ row, mode, onClose }: { row: InboxRow; mode: "create" | "attach"; onClose: () => void }) {
  const qc = useQueryClient();
  const { currentJob } = useAuth();
  const act = useServerFn(ccInboxAction);
  const { data: items = [] } = useDeficiencies(currentJob?.id);
  const { data: picks } = usePickLists();
  const { data: locs = [] } = useQuery({
    queryKey: ["cc-locs", currentJob?.id],
    queryFn: async () => {
      const { data } = await supabase.from("floors").select("label,sort_order,locations(id,name,sort_order)").eq("project_id", currentJob!.id).order("sort_order");
      return (data ?? []).flatMap((f) => (f.locations as { id: string; name: string; sort_order: number }[]).sort((a, b) => a.sort_order - b.sort_order).map((l) => ({ id: l.id, label: `${f.label} · ${l.name}`, name: l.name })));
    },
  });
  const desc = row.description ?? "";
  const kind0: "before" | "after" = row.tags.some((t) => t.toLowerCase() === "after") ? "after" : "before";
  const dMatch = desc.match(/D-?0*(\d{1,5})/i);
  const [defId, setDefId] = useState("");
  const [q, setQ] = useState(dMatch ? `D-${(dMatch[1] ?? "").padStart(4, "0")}` : "");
  const [kind, setKind] = useState(kind0);
  const pickIn = (list: string[] | undefined) => list?.find((v) => desc.toLowerCase().includes(v.toLowerCase())) ?? "";
  const room = desc.match(/\b(?:room|rm|suite)\s*#?\s*(\w+)/i)?.[1];
  const [f, setF] = useState({ locationId: "", area: "", material: "", issue_type: "", assessment: "must_fix" as "must_fix" | "client_review" | "acceptable", description: desc });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dMatch && !defId) {
      const hit = items.find((i) => i.item_number === Number(dMatch[1]));
      if (hit) setDefId(hit.id);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setF((s) => ({
      ...s,
      locationId: s.locationId || (room ? locs.find((l) => l.name.toLowerCase() === room.toLowerCase())?.id ?? "" : ""),
      area: s.area || pickIn(picks?.area),
      material: s.material || pickIn(picks?.material),
      issue_type: s.issue_type || pickIn(picks?.issue_type),
    }));
  }, [locs, picks]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => !t || itemNo(i.item_number).toLowerCase().includes(t) || (i.locations?.name ?? "").toLowerCase().includes(t)).slice(0, 30);
  }, [items, q]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = mode === "attach" ? await act({ data: { id: row.id, action: "attach", deficiencyId: defId, kind } }) : await act({ data: { id: row.id, action: "create", kind, item: f } });
      toast.success(mode === "attach" ? "Photo attached" : "Deficiency created");
      void qc.invalidateQueries({ queryKey: ["cc-inbox"] });
      void qc.invalidateQueries({ queryKey: ["deficiencies"] });
      onClose();
      void r;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sel = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{mode === "attach" ? "Attach to an existing item" : "Create a deficiency from this photo"}</DialogTitle></DialogHeader>
        {row.thumb_url && <img src={row.thumb_url} alt="" className="max-h-48 w-full rounded-md object-cover" />}
        <div className="flex gap-2">
          {(["before", "after"] as const).map((k) => <Button key={k} size="sm" type="button" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{k === "before" ? "Before photo" : "After photo"}</Button>)}
        </div>
        {mode === "attach" ? (
          <div className="space-y-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search D-number or room" />
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {matches.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => setDefId(i.id)} className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted", defId === i.id && "bg-muted font-medium")}>
                    {itemNo(i.item_number)} · {i.locations?.name} · {i.material} · {i.issue_type}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-2">
            <select className={sel} value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
              <option value="">Location…</option>
              {locs.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            {(["area", "material", "issue_type"] as const).map((k) => (
              <select key={k} className={sel} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                <option value="">{k === "issue_type" ? "Issue…" : k === "area" ? "Area…" : "Material…"}</option>
                {(picks?.[k] ?? []).map((v) => <option key={v}>{v}</option>)}
              </select>
            ))}
            <select className={sel} value={f.assessment} onChange={(e) => setF({ ...f, assessment: e.target.value as typeof f.assessment })}>
              <option value="must_fix">Must fix</option>
              <option value="client_review">Needs client review</option>
              <option value="acceptable">Acceptable</option>
            </select>
            <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || (mode === "attach" && !defId)} onClick={() => void submit()}>{busy ? "Saving…" : mode === "attach" ? "Attach photo" : "Create deficiency"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Sync log ----------------
function SyncLog() {
  const { currentJob } = useAuth();
  const qc = useQueryClient();
  const sync = useServerFn(ccSyncNow);
  const { data: rows = [] } = useQuery({
    queryKey: ["cc-log", currentJob?.id],
    enabled: !!currentJob,
    queryFn: async () => (await supabase.from("companycam_sync_log").select("*").eq("project_id", currentJob!.id).order("created_at", { ascending: false }).limit(200)).data ?? [],
  });
  const retry = async () => {
    try {
      await sync({ data: { projectId: currentJob!.id } });
      toast.success("Retried");
    } catch (e) {
      toast.error((e as Error).message);
    }
    void qc.invalidateQueries({ queryKey: ["cc-log"] });
  };
  if (!rows.length) return <p className="mt-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No sync activity yet.</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Result</th><th className="px-3 py-2" /></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-2">{fmt(r.created_at)}</td>
              <td className="px-3 py-2">{r.direction === "out" ? "App → CompanyCam" : "CompanyCam → App"}</td>
              <td className="px-3 py-2">{r.entity}{r.remote_id ? ` #${r.remote_id}` : ""}</td>
              <td className="px-3 py-2">{r.status === "error" ? <span className="text-destructive">{r.error}</span> : r.status === "ok" ? (r.payload ? JSON.stringify(r.payload) : "OK") : r.status}</td>
              <td className="px-3 py-2">{r.status === "error" && <Button size="sm" variant="outline" onClick={() => void retry()}>Retry</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Settings ----------------
function SettingsTab({ st }: { st: St }) {
  const qc = useQueryClient();
  const { currentJob } = useAuth();
  const { data: project } = useProject();
  const save = useServerFn(ccSaveOptions);
  const users = useServerFn(ccRefreshUsers);
  const hook = useServerFn(ccWebhook);
  const opts = (st?.project?.companycam_options ?? {}) as Record<string, boolean>;
  const [busy, setBusy] = useState<string | null>(null);
  const update = async (enabled: boolean, options: Record<string, boolean>) => {
    try {
      await save({ data: { projectId: currentJob!.id, enabled, options } });
      void qc.invalidateQueries({ queryKey: ["cc-status"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const go = async (k: string, fn: () => Promise<unknown>, ok: (r: never) => string) => {
    setBusy(k);
    try {
      toast.success(ok((await fn()) as never));
      void qc.invalidateQueries({ queryKey: ["cc-status"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  void project;
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Sync for this job</h2>
        <label className="mt-3 flex items-center justify-between gap-3 border-b border-border pb-3 text-sm font-medium">
          Sync on
          <Switch checked={!!st?.project?.companycam_sync_enabled} disabled={!st?.project?.companycam_project_id} onCheckedChange={(v) => void update(v, opts)} />
        </label>
        <ul className="mt-2 space-y-2">
          {OPTS.map(([k, l]) => (
            <li key={k} className="flex items-center justify-between gap-3 text-sm">
              {l}
              <Switch checked={opts[k] !== false} onCheckedChange={(v) => void update(!!st?.project?.companycam_sync_enabled, { ...opts, [k]: v })} />
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">Webhook (instant updates)</h2>
          <p className="mt-1 text-sm text-muted-foreground">{st?.webhook?.webhook_id ? `Registered (#${st.webhook.webhook_id}) on ${fmt(st.webhook.created_at)}` : "Not registered — CompanyCam changes arrive on Sync now or the 3-hour check."}</p>
          <div className="mt-3 flex gap-2">
            <Button disabled={!st?.connected || busy !== null} onClick={() => void go("reg", () => hook({ data: { action: "register" } }), () => "Webhook registered")}>{st?.webhook?.webhook_id ? "Re-register webhook" : "Register webhook"}</Button>
            <Button variant="outline" disabled={!st?.connected || !st?.webhook?.webhook_id || busy !== null} onClick={() => void go("rm", () => hook({ data: { action: "remove" } }), () => "Webhook removed")}>Remove webhook</Button>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">People</h2>
          <p className="mt-1 text-sm text-muted-foreground">Matches app users to CompanyCam users by email so tasks are assigned to the right person.</p>
          <Button className="mt-3" variant="secondary" disabled={!st?.connected || busy !== null} onClick={() => void go("users", () => users(), (r: { companycamUsers: number; matched: number }) => `${r.matched} of ${r.companycamUsers} CompanyCam users matched`)}>
            <RefreshCw className={cn("mr-1 h-4 w-4", busy === "users" && "animate-spin")} /> Refresh users
          </Button>
        </div>
      </section>
    </div>
  );
}
