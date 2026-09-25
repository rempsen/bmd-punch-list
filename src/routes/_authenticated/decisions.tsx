import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { itemNo } from "@/lib/bmd";
import { useDeficiencies, usePhotos, useProject, useUpdateDeficiency } from "@/lib/data";
import { useSignedUrls } from "@/lib/photos";
import { DecisionRequestNote } from "@/components/DecisionRequest";

export const Route = createFileRoute("/_authenticated/decisions")({
  component: DecisionsPage,
});

function DecisionsPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const queue = items.filter((i) => i.status === "awaiting_client");
  const ids = useMemo(() => queue.map((i) => i.id), [queue]);
  const { data: photos = [] } = usePhotos(ids);
  const paths = useMemo(() => photos.map((p) => p.storage_path), [photos]);
  const { data: urls = {} } = useSignedUrls(paths);
  const update = useUpdateDeficiency();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = (id: string, status: "accepted_as_is" | "fix_required") => {
    update.mutate(
      { id, patch: { status, client_decision_note: notes[id] ?? null } },
      {
        onSuccess: () => toast.success("Decision recorded"),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <div>
      <PageHeader
        title="Needs your decision"
        subtitle={`${queue.length} item${queue.length === 1 ? "" : "s"} awaiting review`}
      />
      <div className="space-y-4 p-4 md:p-6">
        {queue.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting on you right now. You can still review the dashboard, floor grid and
            full item list.
          </p>
        )}
        {queue.map((d) => {
          const shots = photos.filter((p) => p.deficiency_id === d.id);
          return (
            <article key={d.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/item/$id"
                  params={{ id: d.id }}
                  className="font-mono text-sm font-semibold hover:underline"
                >
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
                    <img
                      key={p.id}
                      src={urls[p.storage_path]}
                      alt="Deficiency"
                      className="h-28 w-full rounded-md object-cover"
                    />
                  ))}
                </div>
              )}

              <Textarea
                placeholder="Optional note for BMD"
                value={notes[d.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
                className="mt-3 min-h-[70px]"
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button className="h-12" onClick={() => decide(d.id, "accepted_as_is")}>
                  Accept as-is
                </Button>
                <Button
                  variant="destructive"
                  className="h-12"
                  onClick={() => decide(d.id, "fix_required")}
                >
                  Fix required
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
