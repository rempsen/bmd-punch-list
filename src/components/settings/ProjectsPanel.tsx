import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Job } from "@/lib/auth";

export function ProjectsPanel() {
  const { jobs, refreshPermissions, setProjectId, projectId } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const reload = async () => {
    await refreshPermissions();
    void qc.invalidateQueries({ queryKey: ["project"] });
  };

  const create = async () => {
    if (!name.trim()) {
      toast.error("Enter a job name");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("create_project", { _name: name, _client: client, _address: address });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    setClient("");
    setAddress("");
    await reload();
    toast.success("Job created with the default pick lists", {
      action: data ? { label: "Open it", onClick: () => setProjectId(data as string) } : undefined,
    });
  };

  const archive = async (job: Job, on: boolean) => {
    if (on && job.id === projectId && !confirm("Archive the job you're working in?")) return;
    const { error } = await supabase
      .from("projects")
      .update({ archived_at: on ? new Date().toISOString() : null })
      .eq("id", job.id);
    if (error) toast.error(error.message);
    else {
      toast.success(on ? "Job archived" : "Job restored");
      await reload();
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground uppercase">New job</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          A new job starts empty with the default pick lists. Open it, then add floors and rooms under Floors &amp; rooms.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input className="h-11" placeholder="Job name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="h-11" placeholder="Client name" value={client} onChange={(e) => setClient(e.target.value)} />
          <Input className="h-11" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <Button className="mt-3 h-11" disabled={busy} onClick={() => void create()}>
          Create job
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Jobs</h2>
        <ul className="divide-y divide-border">
          {jobs.map((j) =>
            editing === j.id ? (
              <EditRow key={j.id} job={j} onDone={async () => { setEditing(null); await reload(); }} />
            ) : (
              <li key={j.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {j.name} {j.archived_at && <span className="ml-1 text-xs text-muted-foreground">(archived)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[j.address, j.client_name].filter(Boolean).join(" · ") || "No address"} · {j.open_count} open
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(j.id)} aria-label="Edit job">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void archive(j, !j.archived_at)}>
                  {j.archived_at ? <ArchiveRestore className="mr-1 h-4 w-4" /> : <Archive className="mr-1 h-4 w-4" />}
                  {j.archived_at ? "Restore" : "Archive"}
                </Button>
              </li>
            ),
          )}
        </ul>
      </section>
    </div>
  );
}

function EditRow({ job, onDone }: { job: Job; onDone: () => Promise<void> }) {
  const [name, setName] = useState(job.name);
  const [client, setClient] = useState(job.client_name ?? "");
  const [address, setAddress] = useState(job.address ?? "");
  const save = async () => {
    const { error } = await supabase
      .from("projects")
      .update({ name: name.trim() || job.name, client_name: client.trim() || null, address: address.trim() || null })
      .eq("id", job.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Job updated");
      await onDone();
    }
  };
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <Input className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
      <Input className="h-10" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
      <Input className="h-10" placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
      <Button className="h-10" onClick={() => void save()}>Save</Button>
    </li>
  );
}
