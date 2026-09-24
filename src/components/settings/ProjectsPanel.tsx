import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Job } from "@/lib/auth";

export function ProjectsPanel() {
  const { jobs, refreshPermissions, projectId } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);

  const reload = async () => {
    await refreshPermissions();
    void qc.invalidateQueries({ queryKey: ["project"] });
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
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase">New job</h2>
          <p className="text-sm text-muted-foreground">Guided setup: details, client, scopes and the building's floors and rooms.</p>
        </div>
        <Button asChild className="h-11">
          <Link to="/new-job">
            <Plus className="mr-1 h-4 w-4" /> New job
          </Link>
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
