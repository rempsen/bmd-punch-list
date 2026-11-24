import { floorLabel, floorShort } from "@/lib/data";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  useDeficiencies,
  useFloors,
  useLocations,
  usePickLists,
  useProject,
} from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { UsersPanel } from "@/components/settings/UsersPanel";
import { UsersAdmin } from "@/components/settings/users/UsersAdmin";
import { RolesPanel } from "@/components/settings/RolesPanel";
import { ProjectsPanel } from "@/components/settings/ProjectsPanel";
import { JobDetailsPanel } from "@/components/job/JobDetailsPanel";
import { JobsAdminPanel } from "@/components/settings/JobsAdminPanel";
import { AiModelPanel } from "@/components/settings/AiModelPanel";
import { canonicalTab, settingsHeading } from "@/lib/settings-tabs";
import { QuoteSettingsPanel } from "@/components/settings/QuoteSettingsPanel";
import { KnowledgePanel } from "@/components/settings/KnowledgePanel";
import { SyncPanel } from "@/components/settings/SyncPanel";
import { IntegrationsPanel } from "@/components/settings/IntegrationsPanel";

export const Route = createFileRoute("/_authenticated/settings")({
  validateSearch: (s: Record<string, unknown>): { tab?: string | undefined; ms?: string | undefined; qbo?: string | undefined; message?: string | undefined } => ({
    tab: typeof s["tab"] === "string" ? s["tab"] : undefined,
    ms: typeof s["ms"] === "string" ? s["ms"] : undefined,
    qbo: typeof s["qbo"] === "string" ? s["qbo"] : undefined,
    message: typeof s["message"] === "string" ? s["message"].slice(0, 200) : undefined,
  }),
  component: SettingsPage,
});

/** Accepts "1201-1240", "201, 202, 205" or newline separated values. */
export function parseRoomList(input: string): string[] {
  const out: string[] = [];
  for (const chunk of input.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean)) {
    const range = chunk.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range && range[1] && range[2]) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start < 500) {
        for (let n = start; n <= end; n += 1) out.push(String(n));
        continue;
      }
    }
    out.push(chunk);
  }
  return [...new Set(out)];
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data: project } = useProject();
  const { data: floors = [] } = useFloors(project?.id);
  const floorIds = useMemo(() => floors.map((f) => f.id), [floors]);
  const { data: locations = [] } = useLocations(floorIds);
  const { data: picks } = usePickLists();
  const { can, canAny, isSuperAdmin, refreshPermissions } = useAuth();
  const canSettings = can("manage_settings");
  const canUsers = can("manage_users");
  // The company Users screen: super admins, and anyone who manages users on any job.
  const canManageAnyUsers = isSuperAdmin || canAny("manage_users");
  const canMicrosoft = canAny("send_quotes") || canAny("manage_integrations");
  const canQuotes = canAny("send_quotes");
  // Knowledge is for BMD staff: everyone who sees the pipeline can read it, managers and admins change it.
  const canKnowledge = isSuperAdmin || canAny("view_pipeline");
  const canSync = canAny("manage_integrations") || canAny("manage_catalogue");
  const navigate = Route.useNavigate();
  // Company-wide settings first, then the settings of the job that is open. Each list holds only what this person may open.
  const companyTabs = ([
    [canQuotes, "quotes", "Quotes"],
    [canKnowledge, "knowledge", "Knowledge"],
    [canMicrosoft, "integrations", "Integrations"],
    [canSync, "sync", "Sync"],
    [canMicrosoft, "ai", "AI"],
    [canManageAnyUsers, "allusers", "Users"],
    [isSuperAdmin, "roles", "Roles"],
    [canSettings, "projects", "All jobs"],
    [canSettings, "jobs", "Jobs admin"],
  ] as const).filter(([ok]) => ok).map(([, value, label]) => [value, label] as const);
  const jobTabs = ([
    [canSettings, "project", "Job details"],
    [canSettings, "structure", "Floors & rooms"],
    [canSettings, "lists", "Pick lists"],
    [canUsers, "users", "Users on this job"],
    [canSettings, "companycam", "CompanyCam"],
  ] as const).filter(([ok]) => ok).map(([, value, label]) => [value, label] as const);
  const allowed = [...companyTabs, ...jobTabs].map(([value]) => value as string);
  const search = Route.useSearch();
  const asked = canonicalTab(search.tab);
  const tab = asked && allowed.includes(asked) ? asked : (allowed[0] ?? "jobs");
  const heading = settingsHeading(tab, project?.name);
  const { data: items = [] } = useDeficiencies(project?.id);

  const refresh = () => {
    void qc.invalidateQueries();
  };

  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [address, setAddress] = useState("");
  const [floorNumber, setFloorNumber] = useState("");
  const [selectedFloor, setSelectedFloor] = useState<string>("");
  const [roomPaste, setRoomPaste] = useState("");
  const [commonName, setCommonName] = useState("");
  const [newPick, setNewPick] = useState<Record<string, string>>({});

  const activeFloor = selectedFloor || floors[0]?.id || "";
  const sampleCount = items.filter((i) => i.is_sample).length;

  const saveProject = async () => {
    if (!project) return;
    const { error } = await supabase
      .from("projects")
      .update({
        name: projectName || project.name,
        client_name: clientName || project.client_name,
        address: address || project.address,
      })
      .eq("id", project.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Job updated");
      refresh();
      void refreshPermissions();
    }
  };

  const addFloor = async () => {
    if (!project || !floorNumber) return;
    const n = Number(floorNumber);
    const { error } = await supabase
      .from("floors")
      .insert({ project_id: project.id, number: n, label: `Floor ${n}`, sort_order: n });
    if (error) toast.error(error.message);
    else {
      setFloorNumber("");
      toast.success("Floor added");
      refresh();
    }
  };

  const addRooms = async () => {
    if (!activeFloor) return;
    const names = parseRoomList(roomPaste);
    if (names.length === 0) return;
    const existing = new Set(
      locations.filter((l) => l.floor_id === activeFloor).map((l) => l.name),
    );
    const rows = names
      .filter((n) => !existing.has(n))
      .map((name, i) => ({ floor_id: activeFloor, type: "room" as const, name, sort_order: i }));
    if (rows.length === 0) {
      toast.info("Those rooms already exist");
      return;
    }
    const { error } = await supabase.from("locations").insert(rows);
    if (error) toast.error(error.message);
    else {
      setRoomPaste("");
      toast.success(`${rows.length} rooms added`);
      refresh();
    }
  };

  const addCommon = async () => {
    if (!activeFloor || !commonName.trim()) return;
    const { error } = await supabase
      .from("locations")
      .insert({ floor_id: activeFloor, type: "common_area", name: commonName.trim(), sort_order: 50 });
    if (error) toast.error(error.message);
    else {
      setCommonName("");
      refresh();
    }
  };

  const removeLocation = async (id: string) => {
    const { error } = await supabase.from("locations").delete().eq("id", id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const addPick = async (kind: "area" | "material" | "issue_type") => {
    const value = (newPick[kind] ?? "").trim();
    if (!value) return;
    const { error } = await supabase.from("pick_lists").insert({ kind, value, sort_order: 999, project_id: project!.id });
    if (error) toast.error(error.message);
    else {
      setNewPick({ ...newPick, [kind]: "" });
      refresh();
    }
  };

  const removePick = async (id: string) => {
    const { error } = await supabase.from("pick_lists").delete().eq("id", id);
    if (error) toast.error(error.message);
    else refresh();
  };

  const clearSamples = async () => {
    const { error } = await supabase.from("deficiencies").delete().eq("is_sample", true).eq("project_id", project!.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Sample data removed");
      refresh();
    }
  };

  const floorLocations = locations.filter((l) => l.floor_id === activeFloor);

  return (
    <div>
      <PageHeader title={heading.title} subtitle={heading.subtitle} />
      <div className="p-4 md:p-6">
        <Tabs value={tab} onValueChange={(v) => void navigate({ search: (prev) => ({ ...prev, tab: v, ms: undefined, qbo: undefined, message: undefined }), replace: true })}>
          {companyTabs.length > 0 && (
            <div className="mb-3">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company settings · apply to every job</h2>
              <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                {companyTabs.map(([value, label]) => (
                  <TabsTrigger key={value} value={value}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          )}
          {jobTabs.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job settings · {project?.name ?? "no job selected"}</h2>
              <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                {jobTabs.map(([value, label]) => (
                  <TabsTrigger key={value} value={value}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          )}

          {canQuotes && (
            <TabsContent value="quotes">
              <QuoteSettingsPanel />
            </TabsContent>
          )}

          {canKnowledge && (
            <TabsContent value="knowledge">
              <KnowledgePanel />
            </TabsContent>
          )}

          {canSync && (
            <TabsContent value="sync">
              <SyncPanel />
            </TabsContent>
          )}

          {canMicrosoft && (
            <TabsContent value="integrations">
              <IntegrationsPanel result={search.ms} qboResult={search.qbo} message={search.message} />
            </TabsContent>
          )}

          {canMicrosoft && (
            <TabsContent value="ai">
              <AiModelPanel />
            </TabsContent>
          )}

          {canSettings && (
            <TabsContent value="jobs">
              <JobsAdminPanel />
            </TabsContent>
          )}

          <TabsContent value="companycam" className="space-y-4">
            <Card title="CompanyCam">
              <p className="mb-3 text-sm text-muted-foreground">Connection, job linking, photo inbox, sync log and sync options for this job.</p>
              <Link to="/companycam" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Open CompanyCam settings</Link>
            </Card>
          </TabsContent>

          <TabsContent value="structure" className="space-y-4">
            <Card title="Floors">
              <div className="flex flex-wrap gap-2">
                {floors.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFloor(f.id)}
                    className={`h-11 min-w-[56px] rounded-md px-3 text-sm font-semibold ${
                      f.id === activeFloor
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {floorShort(f)}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Input
                  value={floorNumber}
                  onChange={(e) => setFloorNumber(e.target.value)}
                  placeholder="New floor number"
                  className="h-11 w-48"
                />
                <Button className="h-11" onClick={addFloor}>
                  <Plus className="mr-1 h-4 w-4" /> Add floor
                </Button>
              </div>
            </Card>

            <Card title="Rooms and common areas">
              <Textarea
                value={roomPaste}
                onChange={(e) => setRoomPaste(e.target.value)}
                placeholder="Paste room numbers, e.g. 1201-1240 or 201, 202, 205"
                className="min-h-[80px]"
              />
              <Button className="mt-2 h-11" onClick={addRooms}>
                Add rooms to selected floor
              </Button>

              <div className="mt-4 flex gap-2">
                <Input
                  value={commonName}
                  onChange={(e) => setCommonName(e.target.value)}
                  placeholder="Common area name"
                  className="h-11"
                />
                <Button className="h-11" variant="secondary" onClick={addCommon}>
                  Add area
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {floorLocations.map((l) => (
                  <span
                    key={l.id}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm"
                  >
                    {l.name}
                    <button
                      type="button"
                      aria-label={`Remove ${l.name}`}
                      onClick={() => removeLocation(l.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </Card>

            {can("delete_item") && (<Card title="Sample data">
              <p className="text-sm text-muted-foreground">
                {sampleCount} sample items are in this project.
              </p>
              <Button
                variant="destructive"
                className="mt-2 h-11"
                disabled={sampleCount === 0}
                onClick={clearSamples}
              >
                Clear sample data
              </Button>
            </Card>)}
          </TabsContent>

          <TabsContent value="lists" className="space-y-4">
            {(["area", "material", "issue_type"] as const).map((kind) => (
              <Card
                key={kind}
                title={kind === "issue_type" ? "Issue types" : kind === "area" ? "Areas" : "Materials"}
              >
                <div className="flex flex-wrap gap-2">
                  {(picks?.all ?? [])
                    .filter((p) => p.kind === kind)
                    .map((p) => (
                      <span
                        key={p.id}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm"
                      >
                        {p.value}
                        <button
                          type="button"
                          aria-label={`Remove ${p.value}`}
                          onClick={() => removePick(p.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    value={newPick[kind] ?? ""}
                    onChange={(e) => setNewPick({ ...newPick, [kind]: e.target.value })}
                    placeholder="Add option"
                    className="h-11"
                  />
                  <Button className="h-11" onClick={() => addPick(kind)}>
                    Add
                  </Button>
                </div>
              </Card>
            ))}
          </TabsContent>

          {canUsers && (
            <TabsContent value="users">
              <UsersPanel />
            </TabsContent>
          )}
          {canManageAnyUsers && (
            <TabsContent value="allusers">
              <UsersAdmin />
            </TabsContent>
          )}
          {isSuperAdmin && (
            <TabsContent value="roles">
              <RolesPanel />
            </TabsContent>
          )}

          <TabsContent value="project" className="space-y-4">
            <JobDetailsPanel />
          </TabsContent>

          {canSettings && (
            <TabsContent value="projects">
              <ProjectsPanel />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}
