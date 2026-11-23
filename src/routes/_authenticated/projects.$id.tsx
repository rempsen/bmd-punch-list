import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeft, ArrowRightLeft, Hammer, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/job/fields";
import { EstimateTab } from "@/components/estimate/EstimateTab";
import { BillingTab } from "@/components/billing/BillingTab";
import { QuotesTab } from "@/components/quotes/QuotesTab";
import { VisitsPanel } from "@/components/visits/VisitsPanel";
import { useProjectDocuments } from "@/lib/documents/data";
import { buildTimeline } from "@/lib/projects/timeline";
import { useQuotes } from "@/lib/quotes/data";
import { useQuery } from "@tanstack/react-query";

// The plan viewer brings pdf.js with it, so it is fetched only when the Takeoff tab is opened.
import { TakeoffWorkspace } from "@/components/takeoff/TakeoffWorkspace";
import { DocumentsTab } from "@/components/projects/DocumentsTab";
import { MoveStageDialog } from "@/components/projects/MoveStageDialog";
import { StageBadge } from "@/components/projects/StageBadge";
import { SearchSelect } from "@/components/SearchSelect";
import { OneDriveFolderPicker } from "@/components/settings/OneDriveFolderPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { db, errText } from "@/lib/platform/db";
import {
  holderOf,
  money,
  saveProjectDetails,
  setProjectJobRole,
  shortDate,
  staffName,
  useBmdStaff,
  usePipelineProject,
  useRefreshPipeline,
  useStageEvents,
  type PipelineProject,
} from "@/lib/projects/data";
import { JOB_ROLES, JOB_TYPES, LOST_REASONS, daysInStage, isOverdue, stageLabel } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "takeoff", label: "Takeoff" },
  { key: "estimate", label: "Estimate" },
  { key: "quotes", label: "Quotes" },
  { key: "site", label: "Site" },
  { key: "billing", label: "Billing" },
  { key: "activity", label: "Activity" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Project — BMD Projects" }] }),
  validateSearch: (s: Record<string, unknown>): { tab?: TabKey | undefined } => ({
    tab: TABS.some((t) => t.key === s["tab"]) ? (s["tab"] as TabKey) : undefined,
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const { canAny } = useAuth();
  const canEdit = canAny("manage_projects");
  const { data: project, isLoading, error } = usePipelineProject(id);
  const refresh = useRefreshPipeline();
  const [moving, setMoving] = useState(false);

  if (!canAny("view_pipeline")) return <p className="p-6 text-sm text-muted-foreground">You don't have access to projects.</p>;
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-6 text-sm text-destructive">Could not load the project: {errText(error)}</p>;
  if (!project)
    return (
      <div className="p-6 text-sm">
        <p className="text-muted-foreground">This project doesn't exist or you don't have access to it.</p>
        <Link to="/projects" className="mt-2 inline-block font-medium text-primary hover:underline">
          Back to projects
        </Link>
      </div>
    );

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div>
      <header className="border-b border-border bg-card px-4 pt-4 md:px-6">
        <Link to="/pipeline" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Pipeline
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              <span className="mr-2 font-mono text-sm font-normal text-muted-foreground">{project.project_number}</span>
              {project.name}
            </h1>
            <p className="text-sm text-muted-foreground">{[project.client_name, project.address].filter(Boolean).join(" · ") || "No client"}</p>
          </div>
          <div className="flex items-center gap-2">
            <StageBadge stage={project.stage} className="px-3 py-1 text-sm" />
            {canEdit && (
              <Button variant="outline" onClick={() => setMoving(true)}>
                <ArrowRightLeft className="mr-2 h-4 w-4" /> Move
              </Button>
            )}
          </div>
        </div>
        <nav aria-label="Project sections" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.key}
              to="/projects/$id"
              params={{ id }}
              search={t.key === "overview" ? {} : { tab: t.key }}
              aria-current={t.key === tab ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
                t.key === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "takeoff" && <TakeoffWorkspace projectId={project.id} />}
      <div className={cn("mx-auto p-4 md:p-6", tab === "takeoff" && "hidden", tab === "estimate" ? "max-w-7xl" : "max-w-5xl")}>
        {tab === "overview" && <Overview project={project} canEdit={canEdit} onChanged={refresh} />}
        {tab === "overview" && <VisitsPanel projectId={project.id} canEdit={canEdit} project={{ name: project.name, number: project.project_number, address: project.address, client: project.client_name }} />}
        {tab === "documents" && <DocumentsTab projectId={project.id} />}
        {tab === "estimate" && <EstimateTab projectId={project.id} />}
        {tab === "quotes" && <QuotesTab projectId={project.id} />}
        {tab === "billing" && <BillingTab projectId={project.id} />}
        {tab === "site" && <SiteTab project={project} canEdit={canEdit} />}
        {tab === "activity" && <Activity projectId={project.id} />}
      </div>

      {moving && (
        <MoveStageDialog
          project={project}
          onClose={() => setMoving(false)}
          onMoved={() => {
            refresh();
            setMoving(false);
          }}
        />
      )}
    </div>
  );
}

function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Overview({ project, canEdit, onChanged }: { project: PipelineProject; canEdit: boolean; onChanged: () => void }) {
  const { data: staff = [] } = useBmdStaff();
  const blank = () => ({
    name: project.name,
    bid_due_date: project.bid_due_date ?? "",
    job_type: project.job_type ?? "",
    value: project.estimated_value_cents == null ? "" : String(project.estimated_value_cents / 100),
    notes: project.notes ?? "",
  });
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Refetched data replaces the form only while it is not being edited.
  useEffect(() => {
    if (!editing) setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, editing]);

  const save = async () => {
    const value = f.value.trim() === "" ? null : Number(f.value.replace(/[$,\s]/g, ""));
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Enter the value as a dollar amount");
      return;
    }
    setBusy(true);
    try {
      await saveProjectDetails(project.id, {
        name: f.name,
        bid_due_date: f.bid_due_date || null,
        job_type: f.job_type || null,
        estimated_value_cents: value == null ? null : Math.round(value * 100),
        notes: f.notes.trim() || null,
      });
      toast.success("Project saved");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const assign = async (role: (typeof JOB_ROLES)[number]["value"], user: string | null) => {
    try {
      await setProjectJobRole(project.id, role, user);
      onChanged();
    } catch (e) {
      toast.error(`Could not assign: ${errText(e)}`);
    }
  };

  const staffOptions = staff.map((s) => ({ value: s.id, label: s.full_name || s.email || "Unknown" }));
  const overdue = isOverdue(project.bid_due_date, project.stage);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel
          title="Details"
          actions={
            canEdit &&
            (editing ? (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ))
          }
        >
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Project name" required>
                  <Input className="h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </Field>
              </div>
              <Field label="Bid due">
                <Input className="h-11" type="date" value={f.bid_due_date} onChange={(e) => setF({ ...f, bid_due_date: e.target.value })} />
              </Field>
              <Field label="Job type">
                <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={f.job_type} onChange={(e) => setF({ ...f, job_type: e.target.value })}>
                  <option value="">Not set</option>
                  {JOB_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estimated value ($)">
                <Input className="h-11" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="Leave blank until known" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
                </Field>
              </div>
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Fact label="Client" value={project.client_name ?? "—"} />
              <Fact label="Site address" value={project.address ?? "—"} />
              <Fact label="Bid due" value={shortDate(project.bid_due_date)} tone={overdue ? "bad" : undefined} note={overdue ? "Overdue" : undefined} />
              <Fact label="Job type" value={project.job_type ?? "—"} />
              <Fact label="Estimated value" value={money(project.estimated_value_cents)} />
              <Fact label="In this stage" value={`${daysInStage(project.stage_entered_at)} days, since ${shortDate(project.stage_entered_at)}`} />
              {project.stage === "lost" && (
                <Fact
                  label="Lost"
                  value={[LOST_REASONS.find((r) => r.value === project.lost_reason)?.label, project.lost_note].filter(Boolean).join(" — ") || "—"}
                />
              )}
              {project.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{project.notes}</dd>
                </div>
              )}
            </dl>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
      <Panel title="BMD team">
        <div className="space-y-3">
          {JOB_ROLES.filter((r) => r.value !== "other").map((r) => {
            const holder = holderOf(project, r.value);
            return (
              <div key={r.value}>
                <p className="mb-1 text-xs text-muted-foreground">{r.label}</p>
                {canEdit ? (
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchSelect value={holder ?? null} onChange={(v) => void assign(r.value, v)} options={staffOptions} placeholder="Unassigned" />
                    </div>
                    {holder && (
                      <Button variant="ghost" className="h-11 px-2 text-xs" onClick={() => void assign(r.value, null)}>
                        Clear
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm">{staffName(staff, holder) ?? "Unassigned"}</p>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
      <OneDrivePlacement project={project} canEdit={canEdit} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** Where the project's documents are copied in OneDrive. The parent can be chosen until the folder exists. */
function OneDrivePlacement({ project, canEdit, onChanged }: { project: PipelineProject; canEdit: boolean; onChanged: () => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <Panel title="OneDrive">
      <p className="text-sm text-muted-foreground">
        {project.onedrive_folder_id
          ? "Documents are copied to this project's OneDrive folder."
          : project.onedrive_parent_path
            ? `Will be created under ${project.onedrive_parent_path}.`
            : "Will be created under the client's folder."}
      </p>
      {canEdit && !project.onedrive_folder_id && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setPicking(true)}>
          Place under another folder
        </Button>
      )}
      {picking && (
        <OneDriveFolderPicker
          title="OneDrive parent folder"
          description="For a client with sub-customer folders, open the one this project belongs under."
          onClose={() => setPicking(false)}
          onPick={async (itemId, path) => {
            const { error } = await db.rpc("set_project_onedrive_parent", { _project: project.id, _item_id: itemId, _path: path });
            if (error) toast.error(error.message);
            else {
              toast.success("OneDrive folder set");
              setPicking(false);
              onChanged();
            }
          }}
        />
      )}
    </Panel>
  );
}

function Fact({ label, value, tone, note }: { label: string; value: string; tone?: "bad" | undefined; note?: string | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn(tone === "bad" && "font-semibold text-destructive")}>
        {value}
        {note ? ` · ${note}` : ""}
      </dd>
    </div>
  );
}

function SiteTab({ project, canEdit }: { project: PipelineProject; canEdit: boolean }) {
  const { jobs, setProjectId } = useAuth();
  const navigate = useNavigate();
  const isMine = jobs.some((j) => j.id === project.id);
  const won = project.stage === "won" || project.stage === "in_progress" || project.stage === "closed";

  if (project.floorCount > 0)
    return (
      <Panel title="Site">
        <p className="text-sm text-muted-foreground">
          {project.floorCount} {project.floorCount === 1 ? "floor" : "floors"} set up. The site tracker holds the dashboard, board, floors, deficiency list, exports and job photos.
        </p>
        {isMine ? (
          <Button
            className="mt-4 h-11"
            onClick={() => {
              setProjectId(project.id);
              void navigate({ to: "/dashboard" });
            }}
          >
            <LayoutDashboard className="mr-2 h-4 w-4" /> Open site tracker
          </Button>
        ) : (
          <p className="mt-3 text-sm">You aren't on this job's site team yet. Ask an admin to add you in Job settings → Users on this job.</p>
        )}
      </Panel>
    );

  return (
    <Panel title="Site">
      <p className="text-sm text-muted-foreground">
        {won ? "Floors and rooms haven't been set up for this job yet." : "Floors and rooms are set up once the job is won."}
      </p>
      {won && canEdit && (
        <Button className="mt-4 h-11" onClick={() => void navigate({ to: "/new-job", search: { project: project.id } })}>
          <Hammer className="mr-2 h-4 w-4" /> Set up site
        </Button>
      )}
    </Panel>
  );
}

function Activity({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const showPrices = canAny("view_pricing");
  const { data: stages = [], isLoading } = useStageEvents(projectId);
  const { data: staff = [] } = useBmdStaff();
  const { data: documents = [] } = useProjectDocuments(projectId);
  const { data: quotes = [] } = useQuotes(projectId, showPrices);
  const { data: bills = [] } = useQuery({
    queryKey: ["bills-activity", projectId],
    enabled: showPrices,
    queryFn: async () => {
      const { data } = await db.from("progress_bills").select("id,number,kind,status,issued_at,total_cents").eq("project_id", projectId);
      return (data ?? []) as { id: string; number: string; kind: string; status: string; issued_at: string | null; total_cents: number }[];
    },
  });
  const { data: visits = [] } = useQuery({
    queryKey: ["visit-events", projectId],
    queryFn: async () => {
      const { data } = await db.from("install_visit_events").select("id,note,at,source").eq("project_id", projectId);
      return (data ?? []) as { id: string; note: string; at: string; source: string }[];
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const entries = buildTimeline({ stages, documents, quotes, bills, visits }, { showPrices });
  return (
    <Panel title="Activity">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3 text-sm">
              <p>{e.text}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(e.at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                {e.by ? ` · ${staffName(staff, e.by) ?? "Someone"}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
