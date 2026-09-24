import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge } from "@/components/badges";
import { StatusActions } from "@/components/StatusActions";
import { PhotoThumb } from "@/components/PhotoThumb";
import { BOARD_COLUMNS, itemNo, type Status } from "@/lib/bmd";
import { useDeficiencies, usePhotos, useProject, useUpdateDeficiency, type DefRow } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/board")({
  component: BoardPage,
});

function BoardPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const { data: photos = [] } = usePhotos(ids);
  const update = useUpdateDeficiency();
  const [dragging, setDragging] = useState<string | null>(null);

  const firstPhoto = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of photos) if (!map.has(p.deficiency_id)) map.set(p.deficiency_id, p.storage_path);
    return map;
  }, [photos]);

  const drop = (column: (typeof BOARD_COLUMNS)[number]) => {
    if (!dragging) return;
    const target = column.statuses[0] as Status;
    update.mutate(
      { id: dragging, patch: { status: target } },
      { onError: (e) => toast.error(e.message) },
    );
    setDragging(null);
  };

  return (
    <div>
      <PageHeader title="Board" subtitle={project?.name ?? undefined} />
      <div className="flex gap-3 overflow-x-auto p-4 md:p-6">
        {BOARD_COLUMNS.map((col) => {
          const cards = items.filter((i) => col.statuses.includes(i.status));
          return (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(col)}
              className="min-w-[268px] flex-1 rounded-lg bg-card/60 p-2"
            >
              <div className="flex items-center justify-between px-2 py-2">
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
                  {cards.length}
                </span>
              </div>
              <div className="space-y-2">
                {cards.map((d) => (
                  <Card
                    key={d.id}
                    d={d}
                    photo={firstPhoto.get(d.id)}
                    onDragStart={() => setDragging(d.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  d,
  photo,
  onDragStart,
}: {
  d: DefRow;
  photo?: string | undefined;
  onDragStart: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn("rounded-lg border border-border bg-card p-3 shadow-sm")}
    >
      <div className="flex gap-3">
        <PhotoThumb path={photo ?? null} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <Link
            to="/item/$id"
            params={{ id: d.id }}
            className="font-mono text-sm font-semibold hover:underline"
          >
            {itemNo(d.item_number)}
          </Link>
          <p className="truncate text-sm font-medium">{d.locations?.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {d.material} · {d.issue_type}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AssessmentBadge value={d.assessment} />
      </div>
      <div className="mt-2">
        <StatusActions id={d.id} status={d.status} size="sm" />
      </div>
    </div>
  );
}
