import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardFilterBar, type BoardFilters } from "@/components/BoardFilterBar";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge } from "@/components/badges";
import { StatusActions } from "@/components/StatusActions";
import { recLabel } from "@/components/DecisionRequest";
import { PhotoThumb } from "@/components/PhotoThumb";
import { BOARD_COLUMNS, itemNo, type Status } from "@/lib/bmd";
import { useFloors, useDeficiencies, usePhotos, useProject, useUpdateDeficiency, type DefRow } from "@/lib/data";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronDown, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssignDialog } from "@/components/AssignDialog";
import { assigneeText, isAssigned, peopleMap, useProjectPeople } from "@/lib/assign";

export const Route = createFileRoute("/_authenticated/board")({
  validateSearch: (s: Record<string, unknown>): BoardFilters => ({
    floor: typeof s["floor"] === "string" || typeof s["floor"] === "number" ? String(s["floor"]) : undefined,
    assess: typeof s["assess"] === "string" ? s["assess"] : undefined,
    q: typeof s["q"] === "string" || typeof s["q"] === "number" ? String(s["q"]) : undefined,
  }),
  component: BoardPage,
});

function BoardPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const { data: photos = [] } = usePhotos(ids);
  const update = useUpdateDeficiency();
  const [dragging, setDragging] = useState<string | null>(null);
  const { data: floors = [] } = useFloors(project?.id);
  const { projectId } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/board" });
  const lsKey = projectId ? `bmd:board-filters:${projectId}` : null;
  const restored = useRef<string | null>(null);

  // Restore saved filters for this job when the URL has none
  useEffect(() => {
    if (!lsKey || restored.current === lsKey) return;
    restored.current = lsKey;
    if (search.floor || search.assess || search.q) return;
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey) ?? "null") as BoardFilters | null;
      if (saved && (saved.floor || saved.assess || saved.q)) void navigate({ search: saved, replace: true });
    } catch {
      /* ignore */
    }
  }, [lsKey, search, navigate]);

  const setFilters = (f: BoardFilters) => {
    if (lsKey) localStorage.setItem(lsKey, JSON.stringify(f));
    void navigate({ search: f, replace: true });
  };

  const visible = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    return items.filter((d) => {
      if (search.floor && String(d.locations?.floors?.number ?? "") !== search.floor) return false;
      if (search.assess && d.assessment !== search.assess) return false;
      if (q && !`${itemNo(d.item_number)} ${d.locations?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search]);

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
      <BoardFilterBar
        filters={search}
        onChange={setFilters}
        floors={floors}
        shown={visible.length}
        total={items.length}
      />
      <div className="flex gap-3 overflow-x-auto p-4 md:p-6">
        {BOARD_COLUMNS.map((col) => {
          const cards = visible.filter((i) => col.statuses.includes(i.status));
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
  const { can, projectId } = useAuth();
  const canAssign = can("assign_items");
  const [open, setOpen] = useState(false);
  const { data: people = [] } = useProjectPeople(projectId);
  const a = assigneeText(d, peopleMap(people));
  const assignee = a.person || a.trade;
  const assigned = isAssigned(d);
  const chipParty =
    d.responsible_party === "bmd" ? "BMD" : d.responsible_party === "trade" ? "Trade" : d.responsible_party === "client" ? "Client" : "Assigned";
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        "rounded-lg border border-border bg-card p-2 shadow-sm transition",
        expanded ? "border-primary" : "hover:border-primary",
      )}
    >
      <button
        type="button"
        draggable={false}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PhotoThumb path={photo ?? null} className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 truncate text-sm">
            <span className="font-mono font-semibold">{itemNo(d.item_number)}</span>
            <span className="truncate font-medium">{d.locations?.name}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {d.material} · {d.issue_type}
          </p>
        </div>
        <span
          aria-hidden
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            d.assessment === "must_fix" ? "bg-mustfix" : d.assessment === "client_review" ? "bg-review" : "bg-acceptable",
          )}
        />
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
      <>
      <div className="mt-2 flex flex-wrap items-center gap-2">
          <AssessmentBadge value={d.assessment} />
          {d.status === "awaiting_client" && (
            <span
              title={d.decision_reason ?? undefined}
              className="inline-flex max-w-full items-center rounded-full border border-primary px-2.5 py-0.5 text-xs font-semibold text-primary"
            >
              <span className="truncate">
                Client decision{recLabel(d.decision_recommendation) ? ` · BMD: ${recLabel(d.decision_recommendation)}` : ""}
              </span>
            </span>
          )}
          {d.decision_outcome && d.status !== "awaiting_client" && (
            <span
              title={d.client_decision_note ?? undefined}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                d.decision_outcome === "fix_required" ? "bg-mustfix text-primary-foreground" : "bg-acceptable text-primary-foreground"
              }`}
            >
              Client: {d.decision_outcome === "fix_required" ? "Fix required" : "Accepted as-is"}
            </span>
          )}
          {assigned && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
              <UserCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {chipParty}
                {assignee ? ` · ${assignee}` : ""}
              </span>
            </span>
          )}
        </div>
        {d.decision_outcome && d.status !== "awaiting_client" && d.client_decision_note && (
          <p className="mt-1 line-clamp-2 text-xs">Client: “{d.client_decision_note}”</p>
        )}
        {d.status === "awaiting_client" && d.decision_reason && (
          <p className="mt-1 line-clamp-2 text-xs">{d.decision_reason}</p>
        )}
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <StatusActions id={d.id} status={d.status} size="sm" />
        {canAssign && (
          <Button size="sm" variant="outline" draggable={false} onClick={() => setOpen(true)}>
            <UserPlus className="mr-1 h-3.5 w-3.5" /> {assigned ? "Reassign" : "Assign"}
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link to="/item/$id" params={{ id: d.id }} draggable={false}>
            Open item <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      </>
      )}
      {canAssign && (
        <AssignDialog
          open={open}
          onOpenChange={setOpen}
          ids={[d.id]}
          initialPerson={d.assigned_to}
          initialTrade={d.assigned_trade}
          initialResponsible={d.responsible_party}
        />
      )}
    </div>
  );
}
