import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ClipboardList, Briefcase } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { itemNo, STATUS_LABEL, type Status } from "@/lib/bmd";
import {
  floorLabel,
  useAllEvents,
  useDeficiencies,
  usePhotos,
  useProject,
  type DefRow,
  type EventRow,
} from "@/lib/data";
import { peopleMap, personName, tradeOf, useProjectPeople, type Person } from "@/lib/assign";
import { useSignedUrls } from "@/lib/photos";
import { today, WorkCard } from "@/components/TradeWork";

export const Route = createFileRoute("/_authenticated/my-work")({
  head: () => ({
    meta: [
      { title: "My work — BMD Deficiency Tracker" },
      { name: "description", content: "Trade dashboard: assigned items, due dates and work log." },
      { property: "og:title", content: "My work — BMD Deficiency Tracker" },
      { property: "og:description", content: "Trade dashboard: assigned items, due dates and work log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyWorkPage,
});

const WORK = ["fix_required", "in_progress", "fixed"];
function MyWorkPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { user, projectId } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const pmap = useMemo(() => peopleMap(people), [people]);

  const work = useMemo(() => items.filter((i) => WORK.includes(i.status)), [items]);
  const { mine, others } = useMemo(() => {
    const myCompany = (user ? pmap.get(user.id)?.company : null)?.trim().toLowerCase();
    const isMine = (i: DefRow) =>
      (!!user && i.assigned_to === user.id) || (!!myCompany && tradeOf(i, pmap).toLowerCase() === myCompany);
    const byDue = (a: DefRow, b: DefRow) =>
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.item_number - b.item_number;
    return {
      mine: work.filter(isMine).sort(byDue),
      others: work.filter((i) => !isMine(i)).sort(byDue),
    };
  }, [work, pmap, user]);

  const ids = useMemo(() => work.map((i) => i.id), [work]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));
  const { data: events = [] } = useAllEvents(project?.id);

  const mineIds = useMemo(() => new Set(mine.map((i) => i.id)), [mine]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const log = useMemo(
    () => events.filter((e) => mineIds.has(e.deficiency_id)).slice(-30).reverse(),
    [events, mineIds],
  );

  const t = today();
  const stats = [
    { label: "Assigned to you", value: mine.length },
    { label: "To start", value: mine.filter((i) => i.status === "fix_required").length },
    { label: "In progress", value: mine.filter((i) => i.status === "in_progress").length },
    { label: "Overdue", value: mine.filter((i) => i.status !== "fixed" && i.due_date && i.due_date < t).length },
  ];

  const floorGroups = useMemo(() => {
    const m = new Map<number, { label: string; items: DefRow[] }>();
    for (const i of others) {
      const f = i.locations?.floors;
      const n = f?.number ?? -1;
      if (!m.has(n)) m.set(n, { label: floorLabel(f), items: [] });
      m.get(n)!.items.push(i);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }, [others]);

  const card = (d: DefRow) => {
    const before = photos.find((p) => p.deficiency_id === d.id && p.kind === "before");
    return (
      <WorkCard
        key={d.id}
        item={d}
        beforeUrl={before ? urls[before.storage_path] : undefined}
        hasAfter={photos.some((p) => p.deficiency_id === d.id && p.kind === "after")}
      />
    );
  };

  return (
    <div>
      <PageHeader
        title="My work"
        subtitle={`${mine.length} assigned to you · ${work.length} open must-fix items on this job`}
        actions={
          <Button asChild className="h-11">
            <Link to="/trade-portal">
              <Briefcase className="mr-2 h-4 w-4" /> Trade portal
            </Link>
          </Button>
        }
      />
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase">{s.label}</p>
              <p className={`text-2xl font-semibold ${s.label === "Overdue" && s.value ? "text-destructive" : ""}`}>{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Assigned to you</h2>
              {mine.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Nothing assigned to you right now.
                </p>
              ) : (
                <ul className="space-y-3">{mine.map(card)}</ul>
              )}
            </section>
            {floorGroups.map((g) => (
              <section key={g.label}>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">Other open work · {g.label}</h2>
                <ul className="space-y-3">{g.items.map(card)}</ul>
              </section>
            ))}
          </div>

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase">
              <ClipboardList className="h-4 w-4" /> Work log
            </h2>
            <div className="rounded-lg border border-border bg-card">
              {log.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No activity on your items yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {log.map((e) => (
                    <LogRow key={e.id} e={e} item={byId.get(e.deficiency_id)} pmap={pmap} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function describe(e: EventRow, pmap: Map<string, Person>) {
  const s = (v: string | null) => (v && v in STATUS_LABEL ? STATUS_LABEL[v as Status] : v ?? "—");
  switch (e.event_type) {
    case "status_change":
      return `Status: ${s(e.from_value)} → ${s(e.to_value)}`;
    case "comment":
      return e.note ?? "Comment";
    case "photo_added":
      return `Added ${e.to_value ?? ""} photo`.replace("  ", " ");
    case "assignment":
      return e.to_value ? `Assigned to ${personName(pmap.get(e.to_value))}` : "Unassigned";
    case "created":
      return "Item created";
    default:
      return e.to_value ? `${e.event_type.replace(/_/g, " ")}: ${e.to_value}` : e.event_type.replace(/_/g, " ");
  }
}

function LogRow({ e, item, pmap }: { e: EventRow; item: DefRow | undefined; pmap: Map<string, Person> }) {
  return (
    <li className="p-3 text-sm">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {item ? (
          <Link to="/item/$id" params={{ id: item.id }} className="font-semibold text-foreground hover:underline">
            {itemNo(item.item_number)} · {item.locations?.name}
          </Link>
        ) : (
          <span />
        )}
        <span>{new Date(e.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <p className="mt-1 first-letter:uppercase">{describe(e, pmap)}</p>
      {e.event_type === "status_change" && e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
      <p className="text-xs text-muted-foreground">{e.user_id ? personName(pmap.get(e.user_id)) : "System"}</p>
    </li>
  );
}
