import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { today, WorkCard } from "@/components/TradeWork";
import { useAuth } from "@/lib/auth";
import { useDeficiencies, usePhotos, useProject, type DefRow } from "@/lib/data";
import { peopleMap, tradeOf, useProjectPeople } from "@/lib/assign";
import { useSignedUrls } from "@/lib/photos";

export const Route = createFileRoute("/_authenticated/trade-portal")({
  head: () => ({
    meta: [
      { title: "Trade portal — BMD Deficiency Tracker" },
      { name: "description", content: "Items assigned to you or your company, with progress updates." },
      { property: "og:title", content: "Trade portal — BMD Deficiency Tracker" },
      { property: "og:description", content: "Items assigned to you or your company, with progress updates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TradePortal,
});

type Tab = "todo" | "in_progress" | "fixed" | "all";
const TABS: { value: Tab; label: string; match: (d: DefRow) => boolean }[] = [
  { value: "todo", label: "To start", match: (d) => d.status === "fix_required" },
  { value: "in_progress", label: "In progress", match: (d) => d.status === "in_progress" },
  { value: "fixed", label: "Fixed", match: (d) => d.status === "fixed" },
  { value: "all", label: "All", match: () => true },
];

function TradePortal() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { user, projectId } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const [tab, setTab] = useState<Tab>("all");

  const pmap = useMemo(() => peopleMap(people), [people]);
  const company = (user ? pmap.get(user.id)?.company : null)?.trim() || "";
  const mine = useMemo(() => {
    const c = company.toLowerCase();
    return items
      .filter((i) => ["fix_required", "in_progress", "fixed"].includes(i.status))
      .filter((i) => (!!user && i.assigned_to === user.id) || (!!c && tradeOf(i, pmap).toLowerCase() === c))
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.item_number - b.item_number);
  }, [items, pmap, user, company]);

  const shown = mine.filter(TABS.find((t) => t.value === tab)!.match);
  const ids = useMemo(() => mine.map((i) => i.id), [mine]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));
  const overdue = mine.filter((i) => i.status !== "fixed" && i.due_date && i.due_date < today()).length;

  return (
    <div>
      <PageHeader
        title="Trade portal"
        subtitle={`${company || "Your work"} · ${mine.length} assigned${overdue ? ` · ${overdue} overdue` : ""}`}
        actions={
          <Button variant="ghost" className="h-11" asChild>
            <Link to="/my-work">
              <ArrowLeft className="mr-2 h-4 w-4" /> My work
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="grid grid-cols-4 gap-2 md:max-w-xl">
          {TABS.map((t) => (
            <Button
              key={t.value}
              className="h-11"
              variant={tab === t.value ? "default" : "outline"}
              onClick={() => setTab(t.value)}
            >
              {t.label} ({mine.filter(t.match).length})
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {mine.length === 0 ? "Nothing is assigned to you or your company on this job." : "No items in this view."}
          </p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((d) => {
              const before = photos.find((p) => p.deficiency_id === d.id && p.kind === "before");
              return (
                <WorkCard
                  key={d.id}
                  item={d}
                  beforeUrl={before ? urls[before.storage_path] : undefined}
                  hasAfter={photos.some((p) => p.deficiency_id === d.id && p.kind === "after")}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
