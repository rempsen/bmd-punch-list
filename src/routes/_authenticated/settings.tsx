import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute } from "@tanstack/react-router";
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
  useProfiles,
  useProject,
  useUserRoles,
} from "@/lib/data";
import type { AppRole } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/settings")({
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
  const { data: profiles = [] } = useProfiles();
  const { data: roles = [] } = useUserRoles();
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
  const [inviteEmail, setInviteEmail] = useState("");

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
      toast.success("Project updated");
      refresh();
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
    const { error } = await supabase.from("pick_lists").insert({ kind, value, sort_order: 999 });
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

  const setRole = async (userId: string, role: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) toast.error(error.message);
    else {
      toast.success("Access updated");
      refresh();
    }
  };

  const clearSamples = async () => {
    const { error } = await supabase.from("deficiencies").delete().eq("is_sample", true);
    if (error) toast.error(error.message);
    else {
      toast.success("Sample data removed");
      refresh();
    }
  };

  const floorLocations = locations.filter((l) => l.floor_id === activeFloor);

  return (
    <div>
      <PageHeader title="Settings" subtitle={project?.name ?? undefined} />
      <div className="p-4 md:p-6">
        <Tabs defaultValue="structure">
          <TabsList>
            <TabsTrigger value="structure">Floors &amp; rooms</TabsTrigger>
            <TabsTrigger value="lists">Pick lists</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="project">Project</TabsTrigger>
          </TabsList>

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

            <Card title="Sample data">
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
            </Card>
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

          <TabsContent value="users" className="space-y-4">
            <Card title="Invite a user">
              <p className="text-sm text-muted-foreground">
                Send the sign-up link to the person, then set their access below once they have
                created an account.
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="h-11"
                />
                <Button
                  className="h-11"
                  onClick={() => {
                    const link = `${window.location.origin}/auth`;
                    void navigator.clipboard.writeText(
                      `Join the BMD Deficiency Tracker: ${link} (sign up with ${inviteEmail || "your email"})`,
                    );
                    toast.success("Invite text copied");
                  }}
                >
                  Copy invite
                </Button>
              </div>
            </Card>

            <Card title="People and access">
              <ul className="divide-y divide-border">
                {profiles.map((p) => {
                  const role = roles.find((r) => r.user_id === p.id)?.role ?? "";
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.full_name ?? p.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                      </div>
                      <Select value={role} onValueChange={(v) => setRole(p.id, v as AppRole)}>
                        <SelectTrigger className="h-11 w-48">
                          <SelectValue placeholder="No access" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bmd_admin">BMD admin</SelectItem>
                          <SelectItem value="bmd_field">BMD field</SelectItem>
                          <SelectItem value="client">Client</SelectItem>
                        </SelectContent>
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </TabsContent>

          <TabsContent value="project" className="space-y-4">
            <Card title="Project details">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  className="h-11"
                  placeholder="Project name"
                  defaultValue={project?.name ?? ""}
                  onChange={(e) => setProjectName(e.target.value)}
                />
                <Input
                  className="h-11"
                  placeholder="Client"
                  defaultValue={project?.client_name ?? ""}
                  onChange={(e) => setClientName(e.target.value)}
                />
                <Input
                  className="h-11"
                  placeholder="Address"
                  defaultValue={project?.address ?? ""}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <Button className="mt-3 h-11" onClick={saveProject}>
                Save project
              </Button>
            </Card>
          </TabsContent>
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
