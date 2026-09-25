import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { itemNo } from "@/lib/bmd";
import { cn } from "@/lib/utils";
import { checkMailboxNow, reparseEmail, saveIntakeCorrection } from "@/lib/intake.functions";

export const Route = createFileRoute("/_authenticated/email-intake")({
  head: () => ({
    meta: [
      { title: "Email intake — BMD Deficiency Tracker" },
      { name: "description", content: "Issues emailed to dan+ingest@bmdmaterials.com, turned into open deficiencies." },
      { property: "og:title", content: "Email intake — BMD Deficiency Tracker" },
      { property: "og:description", content: "Issues emailed in, turned into open deficiencies." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntakePage,
});

const ASSESS = [
  { v: "acceptable", l: "Acceptable" },
  { v: "client_review", l: "Needs client review" },
  { v: "must_fix", l: "Must fix" },
] as const;

type Intake = {
  id: string; subject: string | null; from_name: string | null; from_email: string | null; body_text: string | null;
  received_at: string | null; project_id: string | null; deficiency_id: string | null; status: string; error: string | null;
  confidence: { missing?: string[]; score?: number } | null;
};
type Job = { id: string; name: string; floors: { id: string; label: string; sort_order: number; locations: { id: string; name: string }[] }[]; picks: { kind: string; value: string }[] };

function useJobs() {
  return useQuery({
    queryKey: ["intake-jobs"],
    queryFn: async (): Promise<Job[]> => {
      const { data: projects } = await supabase.from("projects").select("id,name").is("archived_at", null).order("name");
      const out: Job[] = [];
      for (const p of projects ?? []) {
        const { data: floors } = await supabase.from("floors").select("id,label,sort_order,locations(id,name)").eq("project_id", p.id).order("sort_order");
        const { data: picks } = await supabase.from("pick_lists").select("kind,value").eq("project_id", p.id).order("sort_order");
        out.push({ ...p, floors: (floors ?? []) as Job["floors"], picks: picks ?? [] });
      }
      return out;
    },
  });
}

function IntakePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const check = useServerFn(checkMailboxNow);
  const [busy, setBusy] = useState(false);
  const { data: rows = [] } = useQuery({
    queryKey: ["email-intake"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_intake").select("*").order("received_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as unknown as Intake[];
    },
  });
  const { data: jobs = [] } = useJobs();
  const [filter, setFilter] = useState<"review" | "all">("review");
  const shown = rows.filter((r) => filter === "all" || r.status === "needs_review" || r.status === "error");
  const reviewed = rows.filter((r) => typeof r.confidence?.score === "number").slice(0, 30);
  const acc = reviewed.length ? Math.round((reviewed.reduce((s, r) => s + (r.confidence!.score ?? 0), 0) / reviewed.length) * 100) : null;

  if (!can("manage_settings")) return <div className="p-6 text-sm text-muted-foreground">Only BMD managers can see email intake.</div>;

  const runCheck = async () => {
    setBusy(true);
    try {
      const r = await check();
      toast.success(r.created ? `${r.created} new item${r.created === 1 ? "" : "s"} from email` : "No new issue emails");
      qc.invalidateQueries({ queryKey: ["email-intake"] });
    } catch (e) {
      toast.error(`Could not check the mailbox: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Email intake"
        subtitle="Issues sent to dan+ingest@bmdmaterials.com"
      />
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">Sync email items</p>
            <p className="text-sm text-muted-foreground">Checked automatically every 3 hours. Sync now to pick up new issue emails straight away.</p>
          </div>
          <Button size="lg" onClick={runCheck} disabled={busy} className="h-12 shrink-0 px-6 text-base shadow-md">
            <RefreshCw className={cn("mr-2 h-5 w-5", busy && "animate-spin")} /> {busy ? "Syncing…" : "Sync email items now"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(["review", "all"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("rounded px-3 py-1.5", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {f === "review" ? `Needs review (${rows.filter((r) => r.status === "needs_review" || r.status === "error").length})` : `All (${rows.length})`}
              </button>
            ))}
          </div>
          {acc !== null && <span className="text-muted-foreground">Last {reviewed.length} reviewed emails: {acc}% of fields right first time</span>}
        </div>

        {shown.length === 0 && (
          <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-center">
            <Mail className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              {filter === "review" ? "Nothing needs review" : "No emails yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {filter === "review" ? "All caught up. New forwarded emails will show here." : "Forward an issue to dan+ingest@bmdmaterials.com."}
            </p>
          </div>
        )}
        {shown.map((r) => <IntakeRow key={r.id} row={r} jobs={jobs} />)}

        <div className="mt-[20vh] border-t border-border pt-6">
          <Training jobs={jobs} />
        </div>
      </div>
    </div>
  );
}

function IntakeRow({ row, jobs }: { row: Intake; jobs: Job[] }) {
  const qc = useQueryClient();
  const save = useServerFn(saveIntakeCorrection);
  const reparse = useServerFn(reparseEmail);
  const { data: def } = useQuery({
    queryKey: ["intake-def", row.deficiency_id],
    enabled: !!row.deficiency_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("deficiencies")
        .select("id,item_number,project_id,location_id,area,material,issue_type,assessment,description,locations(floor_id)")
        .eq("id", row.deficiency_id!)
        .maybeSingle();
      return data;
    },
  });
  const [f, setF] = useState({ projectId: "", floorId: "", locationId: "", area: "", material: "", issue_type: "", assessment: "must_fix", description: "" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!def) return;
    const loc = def.locations as { floor_id: string } | null;
    setF({
      projectId: def.project_id, floorId: loc?.floor_id ?? "", locationId: def.location_id, area: def.area, material: def.material,
      issue_type: def.issue_type, assessment: def.assessment, description: def.description ?? "",
    });
  }, [def]);
  const job = jobs.find((j) => j.id === f.projectId);
  const floor = job?.floors.find((x) => x.id === f.floorId);
  const missing = new Set(row.confidence?.missing ?? []);
  const warn = (k: string) => (row.status === "needs_review" && missing.has(k) ? "border-amber-500 bg-amber-50" : "");
  const picks = (k: string) => job?.picks.filter((p) => p.kind === k).map((p) => p.value) ?? [];
  const locName = floor?.locations.find((l) => l.id === f.locationId)?.name;

  const submit = async () => {
    setErr(null);
    if (!f.projectId || !f.locationId || locName?.startsWith("From email")) return setErr("Pick the job, floor and room.");
    setSaving(true);
    try {
      await save({ data: { intakeId: row.id, projectId: f.projectId, locationId: f.locationId, area: f.area, material: f.material, issue_type: f.issue_type, assessment: f.assessment as "must_fix", description: f.description } });
      toast.success("Saved. The AI will learn from any corrections.");
      qc.invalidateQueries({ queryKey: ["email-intake"] });
      qc.invalidateQueries({ queryKey: ["intake-def"] });
      qc.invalidateQueries({ queryKey: ["intake-examples"] });
    } catch (e) {
      setErr((e as Error).message);
      toast.error(`Could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const Sel = ({ k, label, opts, value, onChange }: { k: string; label: string; opts: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) => (
    <label className="block text-xs font-medium">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cn("mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm", warn(k))}>
        <option value="">— choose —</option>
        {value && !opts.some((o) => o.v === value) && <option value={value}>{value} (not on list)</option>}
        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="grid gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("rounded-full px-2 py-0.5 font-semibold", row.status === "reviewed" || row.status === "parsed" ? "bg-acceptable text-primary-foreground" : row.status === "error" ? "bg-mustfix text-primary-foreground" : "bg-amber-500 text-primary-foreground")}>
            {row.status === "needs_review" ? "Needs review" : row.status === "error" ? "Couldn't read" : row.status === "reviewed" ? "Reviewed" : "Created"}
          </span>
          {row.received_at && new Date(row.received_at).toLocaleString()}
        </div>
        <p className="mt-2 font-semibold">{row.subject || "(no subject)"}</p>
        <p className="text-xs text-muted-foreground">{row.from_name} &lt;{row.from_email}&gt;</p>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans text-xs">{row.body_text}</pre>
        {row.error && <p className="mt-2 text-sm text-destructive">{row.error}</p>}
      </div>
      <div className="space-y-3">
        {def ? (
          <>
            <div className="flex items-center justify-between">
              <Link to="/item/$id" params={{ id: def.id }} className="font-mono text-sm font-semibold hover:underline">{itemNo(def.item_number)}</Link>
              <Button size="sm" variant="ghost" onClick={async () => {
                try {
                  const p = await reparse({ data: { id: row.id } });
                  const j = jobs.find((x) => x.name === p.job) ?? job;
                  const fl = j?.floors.find((x) => x.label === p.floor);
                  const lo = fl?.locations.find((x) => x.name === p.location);
                  setF((o) => ({ ...o, projectId: j?.id ?? o.projectId, floorId: fl?.id ?? o.floorId, locationId: lo?.id ?? o.locationId, area: p.area ?? o.area, material: p.material ?? o.material, issue_type: p.issue_type ?? o.issue_type, assessment: p.assessment ?? o.assessment, description: p.description ?? o.description }));
                  toast.success("Re-read with AI — check and save");
                } catch (e) { toast.error((e as Error).message); }
              }}>
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Re-read with AI
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Sel k="job" label="Job" value={f.projectId} opts={jobs.map((j) => ({ v: j.id, l: j.name }))} onChange={(v) => setF({ ...f, projectId: v, floorId: "", locationId: "" })} />
              <Sel k="location" label="Floor" value={f.floorId} opts={(job?.floors ?? []).map((x) => ({ v: x.id, l: x.label }))} onChange={(v) => setF({ ...f, floorId: v, locationId: "" })} />
              <Sel k="location" label="Room / location" value={f.locationId} opts={(floor?.locations ?? []).map((x) => ({ v: x.id, l: x.name }))} onChange={(v) => setF({ ...f, locationId: v })} />
              <Sel k="area" label="Area" value={f.area} opts={picks("area").map((v) => ({ v, l: v }))} onChange={(v) => setF({ ...f, area: v })} />
              <Sel k="material" label="Material" value={f.material} opts={picks("material").map((v) => ({ v, l: v }))} onChange={(v) => setF({ ...f, material: v })} />
              <Sel k="issue_type" label="Issue" value={f.issue_type} opts={picks("issue_type").map((v) => ({ v, l: v }))} onChange={(v) => setF({ ...f, issue_type: v })} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ASSESS.map((a) => (
                <Button key={a.v} type="button" size="sm" variant={f.assessment === a.v ? "default" : "outline"} onClick={() => setF({ ...f, assessment: a.v })}>{a.l}</Button>
              ))}
            </div>
            <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button onClick={submit} disabled={saving} className="w-full">{saving ? "Saving…" : "Save and mark reviewed"}</Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No item was created for this email.</p>
        )}
      </div>
    </div>
  );
}

function Training({ jobs }: { jobs: Job[] }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["intake-settings"],
    queryFn: async () => (await supabase.from("intake_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const { data: examples = [] } = useQuery({
    queryKey: ["intake-examples"],
    queryFn: async () => (await supabase.from("intake_examples").select("*").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });
  const [rules, setRules] = useState("");
  const [def, setDef] = useState("");
  useEffect(() => {
    if (settings) { setRules(settings.rules ?? ""); setDef(settings.default_project_id ?? ""); }
  }, [settings]);
  const saveSettings = async () => {
    const { error } = await supabase.from("intake_settings").update({ rules, default_project_id: def || null, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) toast.error(`Could not save: ${error.message}`);
    else { toast.success("Intake settings saved"); qc.invalidateQueries({ queryKey: ["intake-settings"] }); }
  };
  const summary = useMemo(() => (c: Record<string, unknown>) => [c["job"], c["floor"], c["location"], c["material"], c["issue_type"]].filter(Boolean).join(" · "), []);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Teaching the AI</h2>
        <label className="block text-xs font-medium">
          Job for emails that don't match a job
          <select value={def} onChange={(e) => setDef(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium">
          House rules (plain English, one per line)
          <Textarea rows={6} value={rules} onChange={(e) => setRules(e.target.value)} placeholder={"Emails from Azim are always Hyatt Centric 325 Broadway.\n'Lippage' means Wall tile / Lippage unless floor is mentioned."} />
        </label>
        <Button onClick={saveSettings}>Save settings</Button>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Learned examples ({examples.filter((e) => e.active).length} active)</h2>
        <p className="mb-2 text-xs text-muted-foreground">Saved whenever someone corrects the AI. Switch one off if it teaches the wrong thing.</p>
        <div className="max-h-80 space-y-2 overflow-auto">
          {examples.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {examples.map((e) => (
            <div key={e.id} className="flex items-start gap-2 border-b border-border pb-2 text-sm">
              <Switch checked={e.active} onCheckedChange={async (v) => {
                await supabase.from("intake_examples").update({ active: v }).eq("id", e.id);
                qc.invalidateQueries({ queryKey: ["intake-examples"] });
              }} />
              <div className="min-w-0">
                <p className="truncate">{e.email_text.split("\n")[1]?.replace("Subject: ", "") || "(email)"}</p>
                <p className="truncate text-xs text-muted-foreground">{summary(e.corrected as Record<string, unknown>)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
