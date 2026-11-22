import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge } from "@/components/badges";
import { ConfirmDialog, type Outcome } from "@/components/DecisionConfirm";
import { DecisionRequestNote } from "@/components/DecisionRequest";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { itemNo } from "@/lib/bmd";
import { floorLabel, useDeficiencies, usePhotos, useProject, type DefRow } from "@/lib/data";
import { useSignedUrls } from "@/lib/photos";

export const Route = createFileRoute("/_authenticated/client-portal")({
  head: () => ({
    meta: [
      { title: "Client portal — BMD Projects" },
      { name: "description", content: "Review items BMD has sent for your decision and accept or request a fix." },
      { property: "og:title", content: "Client portal — BMD Projects" },
      { property: "og:description", content: "Review items BMD has sent for your decision and accept or request a fix." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientPortal,
});

function ClientPortal() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { can } = useAuth();
  const canDecide = can("decide_client_items");
  const queue = useMemo(
    () => items.filter((i) => i.status === "awaiting_client").sort((a, b) => a.item_number - b.item_number),
    [items],
  );
  const accepted = items.filter((i) => i.decision_outcome === "accepted_as_is").length;
  const fixes = items.filter((i) => i.decision_outcome === "fix_required").length;
  const ids = useMemo(() => queue.map((i) => i.id), [queue]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));
  const [pending, setPending] = useState<{ item: DefRow; outcome: Outcome } | null>(null);

  const stats = [
    { label: "Waiting on you", value: queue.length },
    { label: "Accepted as-is", value: accepted },
    { label: "Fix requested", value: fixes },
  ];

  return (
    <div>
      <PageHeader
        title="Client portal"
        subtitle={`${project?.client_name ?? project?.name ?? ""} · ${project?.name ?? ""}`}
        actions={
          <Button variant="ghost" className="h-11" asChild>
            <Link to="/decisions">
              <ArrowLeft className="mr-2 h-4 w-4" /> Decisions
            </Link>
          </Button>
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase">{s.label}</p>
              <p className="text-2xl font-semibold">{s.value}</p>
            </div>
          ))}
        </div>
        {queue.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You're all caught up — nothing is waiting on your decision.
          </p>
        ) : (
          queue.map((d) => {
            const shots = photos.filter((p) => p.deficiency_id === d.id);
            return (
              <article key={d.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/item/$id" params={{ id: d.id }} className="font-semibold hover:underline">
                    {itemNo(d.item_number)} · {floorLabel(d.locations?.floors)} · {d.locations?.name}
                  </Link>
                  <AssessmentBadge value={d.assessment} />
                </div>
                <p className="mt-1 text-sm">{d.material} — {d.issue_type}</p>
                <p className="text-xs text-muted-foreground">{d.area}</p>
                {d.description && <p className="mt-2 text-sm">{d.description}</p>}
                <div className="mt-3">
                  <DecisionRequestNote item={d} />
                </div>
                {shots.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {shots.map((p) => (
                      <img key={p.id} src={urls[p.storage_path]} alt={`${p.kind} photo`} className="h-28 w-full rounded-md bg-muted object-cover" />
                    ))}
                  </div>
                )}
                {canDecide && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button className="h-12" onClick={() => setPending({ item: d, outcome: "accepted_as_is" })}>
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Accept as-is
                    </Button>
                    <Button variant="destructive" className="h-12" onClick={() => setPending({ item: d, outcome: "fix_required" })}>
                      <XCircle className="mr-2 h-4 w-4" /> Fix required
                    </Button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
      <ConfirmDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}
