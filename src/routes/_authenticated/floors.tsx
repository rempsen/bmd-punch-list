import { useAuth } from "@/lib/auth";
import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { isClosed, itemNo } from "@/lib/bmd";
import { useDeficiencies, useFloors, useLocations, useProject, type DefRow } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/floors")({
  component: FloorsPage,
});

type Tone = "empty" | "mustfix" | "review" | "closed" | "open";

function toneFor(items: DefRow[]): Tone {
  if (items.length === 0) return "empty";
  if (items.some((i) => i.assessment === "must_fix" && !isClosed(i.status))) return "mustfix";
  if (items.some((i) => i.status === "awaiting_client")) return "review";
  if (items.every((i) => isClosed(i.status))) return "closed";
  return "open";
}

const toneClass: Record<Tone, string> = {
  empty: "bg-muted text-muted-foreground border-border",
  mustfix: "bg-mustfix text-mustfix-foreground border-mustfix",
  review: "bg-review text-review-foreground border-review",
  closed: "bg-acceptable text-acceptable-foreground border-acceptable",
  open: "bg-primary text-primary-foreground border-primary",
};

function FloorsPage() {
  const { isAdmin } = useAuth();
  const { data: project } = useProject();
  const { data: floors = [] } = useFloors(project?.id);
  const floorIds = useMemo(() => floors.map((f) => f.id), [floors]);
  const { data: locations = [] } = useLocations(floorIds);
  const { data: items = [] } = useDeficiencies(project?.id);

  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const floorId = activeFloor ?? floors[0]?.id ?? null;
  const floorLocations = locations.filter((l) => l.floor_id === floorId);
  const rooms = floorLocations.filter((l) => l.type === "room");
  const commons = floorLocations.filter((l) => l.type === "common_area");

  const byLocation = useMemo(() => {
    const map = new Map<string, DefRow[]>();
    for (const item of items) {
      const list = map.get(item.location_id) ?? [];
      list.push(item);
      map.set(item.location_id, list);
    }
    return map;
  }, [items]);

  const selectedItems = selected ? (byLocation.get(selected) ?? []) : [];
  const selectedName = locations.find((l) => l.id === selected)?.name;

  const Tile = ({ id, name }: { id: string; name: string }) => {
    const list = byLocation.get(id) ?? [];
    const tone = toneFor(list);
    return (
      <button
        type="button"
        onClick={() => setSelected(id)}
        className={cn(
          "flex min-h-[56px] flex-col items-center justify-center rounded-lg border-2 px-1 text-sm font-semibold",
          toneClass[tone],
          selected === id && "ring-4 ring-foreground/20",
        )}
      >
        <span className="truncate px-1">{name}</span>
        {list.length > 0 && <span className="text-[11px] font-medium opacity-90">{list.length}</span>}
      </button>
    );
  };

  return (
    <div>
      <PageHeader title="Floor grid" subtitle={project?.name ?? undefined} />

      <div className="flex gap-2 overflow-x-auto border-b border-border bg-card px-4 py-3 md:px-6">
        {floors.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setActiveFloor(f.id);
              setSelected(null);
            }}
            className={cn(
              "min-h-[44px] min-w-[56px] rounded-md px-3 text-sm font-semibold",
              f.id === floorId
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {floorShort(f)}
          </button>
        ))}
      </div>

      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <Legend className="bg-muted border-border" label="No items" />
          <Legend className="bg-mustfix border-mustfix" label="Must fix open" />
          <Legend className="bg-review border-review" label="Awaiting client" />
          <Legend className="bg-primary border-primary" label="Open work" />
          <Legend className="bg-acceptable border-acceptable" label="All closed" />
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">
            Common areas
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {commons.map((l) => (
              <Tile key={l.id} id={l.id} name={l.name} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Rooms</h2>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7 xl:grid-cols-14">
            {rooms.map((l) => (
              <Tile key={l.id} id={l.id} name={l.name} />
            ))}
          </div>
          {rooms.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No guest rooms on this floor.
              {isAdmin && (
                <>
                  {" "}
                  <Link to="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
                    Add rooms in Settings
                  </Link>
                </>
              )}
            </p>
          )}
        </section>

        {selected && (
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{selectedName}</h2>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            {selectedItems.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No deficiencies logged here.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {selectedItems.map((d) => (
                  <li key={d.id}>
                    <Link
                      to="/item/$id"
                      params={{ id: d.id }}
                      className="flex flex-wrap items-center gap-2 py-3 text-sm hover:bg-muted/50"
                    >
                      <span className="font-mono font-semibold">{itemNo(d.item_number)}</span>
                      <span className="text-muted-foreground">
                        {d.area} · {d.material} · {d.issue_type}
                      </span>
                      <AssessmentBadge value={d.assessment} />
                      <StatusBadge value={d.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded border-2", className)} />
      {label}
    </span>
  );
}
