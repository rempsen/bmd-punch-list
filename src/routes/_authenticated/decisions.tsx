import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { ConfirmDialog, type Outcome } from "@/components/DecisionConfirm";
import { AssessmentBadge, StatusBadge } from "@/components/badges";
import { DecisionRequestNote } from "@/components/DecisionRequest";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { itemNo } from "@/lib/bmd";
import { floorLabel, useDeficiencies, usePhotos, useProject, useUpdateDeficiency, type DefRow } from "@/lib/data";
import { peopleMap, personName, useProjectPeople } from "@/lib/assign";
import { useSignedUrls } from "@/lib/photos";

export const Route = createFileRoute("/_authenticated/decisions")({
  head: () => ({
    meta: [
      { title: "Decisions — BMD Deficiency Tracker" },
      { name: "description", content: "Items waiting on the client's approval." },
      { property: "og:title", content: "Decisions — BMD Deficiency Tracker" },
      { property: "og:description", content: "Items waiting on the client's approval." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DecisionsPage,
});


function DecisionsPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { projectId, can } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const pmap = useMemo(() => peopleMap(people), [people]);
  const queue = useMemo(
    () => items.filter((i) => i.status === "awaiting_client").sort((a, b) => a.item_number - b.item_number),
    [items],
  );
  const decided = useMemo(
    () =>
      items
        .filter((i) => i.decided_at && i.status !== "awaiting_client")
        .sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? ""))
        .slice(0, 25),
    [items],
  );
  const ids = useMemo(() => queue.map((i) => i.id), [queue]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));
  const [pending, setPending] = useState<{ item: DefRow; outcome: Outcome } | null>(null);
  const canDecide = can("decide_client_items");

  return (
    <div>
      <PageHeader
        title="Decisions"
        subtitle={`${queue.length} item${queue.length === 1 ? "" : "s"} waiting on the client's approval`}
        actions={
          <Button variant="outline" className="h-11" asChild>
            <Link to="/client-portal">Client portal</Link>
          </Button>
        }
      />
      <div className="space-y-8 p-4 md:p-6">
        <section className="space-y-4">
          {queue.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nothing is waiting on a decision right now.
            </p>
          )}
          {queue.map((d) => {
            const shots = photos.filter((p) => p.deficiency_id === d.id);
            return (
              <article key={d.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/item/$id" params={{ id: d.id }} className="font-mono text-sm font-semibold hover:underline">
                    {itemNo(d.item_number)}
                  </Link>
                  <span className="text-sm font-medium">
                    {floorLabel(d.locations?.floors)} · {d.locations?.name}
                  </span>
                  <AssessmentBadge value={d.assessment} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {d.area} · {d.material} · {d.issue_type}
                </p>
                {d.description && <p className="mt-2 text-sm">{d.description}</p>}
                <div className="mt-3">
                  <DecisionRequestNote item={d} />
                </div>
                {shots.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {shots.map((p) => (
                      <img key={p.id} src={urls[p.storage_path]} alt="Deficiency" className="h-28 w-full rounded-md object-cover" />
                    ))}
                  </div>
                )}
                {canDecide ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button className="h-12" onClick={() => setPending({ item: d, outcome: "accepted_as_is" })}>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm — accept as-is
                    </Button>
                    <Button variant="destructive" className="h-12" onClick={() => setPending({ item: d, outcome: "fix_required" })}>
                      <XCircle className="mr-2 h-4 w-4" /> Reject — fix required
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Waiting on the client.</p>
                )}
              </article>
            );
          })}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Decision record</h2>
          {decided.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="p-3">Item</th>
                    <th className="p-3">Decision</th>
                    <th className="p-3">By</th>
                    <th className="p-3">When</th>
                    <th className="p-3">Note</th>
                    <th className="p-3">Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {decided.map((d) => (
                    <tr key={d.id}>
                      <td className="p-3">
                        <Link to="/item/$id" params={{ id: d.id }} className="font-mono font-semibold hover:underline">
                          {itemNo(d.item_number)}
                        </Link>{" "}
                        · {d.locations?.name}
                      </td>
                      <td className={`p-3 font-medium ${d.decision_outcome === "fix_required" ? "text-destructive" : ""}`}>
                        {d.decision_outcome === "fix_required" ? "Rejected — fix required" : "Confirmed — accepted as-is"}
                      </td>
                      <td className="p-3">{d.decided_by ? personName(pmap.get(d.decided_by)) : "—"}</td>
                      <td className="p-3 whitespace-nowrap">{new Date(d.decided_at!).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="p-3 text-muted-foreground">{d.client_decision_note ?? ""}</td>
                      <td className="p-3"><StatusBadge value={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}

