import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createJobFromInbox, ignoreInboxWorkOrder, linkInboxWorkOrder } from "@/lib/arriveping/arriveping.functions";
import { db, errText } from "@/lib/platform/db";
import { scheduleRange } from "@/lib/visits/logic";

/**
 * Work orders scheduled in ArrivePing that BMD could not place on a job by itself. Each can be put on a job, turned into
 * a new job, or set aside. Shown at the top of Scheduling → Work orders only while there is something waiting.
 */

export type InboxRow = {
  id: string;
  arriveping_job_id: string;
  title: string | null;
  reference: string | null;
  customer_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  assigned_to: string | null;
  ap_status: string | null;
  reason: string | null;
};

export function useArrivePingInbox() {
  return useQuery({
    queryKey: ["arriveping-inbox"],
    queryFn: async () => {
      const { data, error } = await db
        .from("arriveping_inbox" as never)
        .select("id,arriveping_job_id,title,reference,customer_name,starts_at,ends_at,assigned_to,ap_status,reason")
        .eq("status", "unmatched")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as InboxRow[];
    },
  });
}

export function ArrivePingInbox({
  rows,
  jobs,
  canEdit,
}: {
  rows: InboxRow[];
  jobs: { id: string; name: string; project_number: string | null }[];
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [picking, setPicking] = useState<string | null>(null);
  const [job, setJob] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows.length) return null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["arriveping-inbox"] });
    void qc.invalidateQueries({ queryKey: ["sched-visits"] });
    void qc.invalidateQueries({ queryKey: ["pipeline-projects"] });
  };
  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id);
    try {
      const r = await fn();
      if (!r.ok) throw new Error(r.error ?? "Something went wrong");
      toast.success(done);
      refresh();
      return r;
    } catch (e) {
      toast.error(errText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/20">
      <div className="border-b border-amber-200 px-3 py-2 text-sm font-medium dark:border-amber-800">
        Unmatched from ArrivePing ({rows.length})
        <span className="ml-2 font-normal text-muted-foreground">
          Scheduled in ArrivePing; BMD could not tell which job they belong to.
        </span>
      </div>
      <ul className="divide-y divide-amber-200 dark:divide-amber-800">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm">
            <div className="min-w-[220px] flex-1">
              <div className="font-medium">{r.title ?? r.reference ?? `Work order ${r.arriveping_job_id}`}</div>
              <div className="text-xs text-muted-foreground">
                {[r.customer_name, r.reference && r.title ? `Ref ${r.reference}` : null, r.reason].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="whitespace-nowrap">{r.starts_at ? scheduleRange(r.starts_at, r.ends_at) : "No date"}</div>
            <div className="whitespace-nowrap text-muted-foreground">{r.assigned_to ?? "Unassigned"}</div>
            {canEdit && (
              <div className="flex items-center gap-2">
                {picking === r.id ? (
                  <>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      value={job}
                      onChange={(e) => setJob(e.target.value)}
                    >
                      <option value="">Choose a job…</option>
                      {jobs.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.project_number ? `${j.project_number} ` : ""}
                          {j.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!job || busy === r.id}
                      onClick={() =>
                        void run(r.id, () => linkInboxWorkOrder({ data: { inboxId: r.id, projectId: job } }), "Added to the job's visits.").then((ok) => ok && setPicking(null))
                      }
                    >
                      Link
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => { setJob(""); setPicking(r.id); }}>
                      Link to job…
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() =>
                        void run(r.id, () => createJobFromInbox({ data: { inboxId: r.id } }), "Job created.").then((res) => {
                          const pid = (res as { projectId?: string } | null)?.projectId;
                          if (pid) void navigate({ to: "/projects/$id", params: { id: pid } });
                        })
                      }
                    >
                      Create a job from it
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void run(r.id, () => ignoreInboxWorkOrder({ data: { inboxId: r.id } }), "Set aside.")}>
                      Ignore
                    </Button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
