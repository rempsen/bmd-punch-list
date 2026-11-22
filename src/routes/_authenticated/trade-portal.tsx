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
      { title: "Trade portal — BMD Projects" },
      { name: "description", content: "Items assigned to you or your company, with progress updates." },
      { property: "og:title", content: "Trade portal — BMD Projects" },
      { property: "og:description", content: "Items assigned to you or your company, with progress updates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TradePortal,
});

type Tab = "todo" | "in_progress" | "fixed" | "done" | "all";
const TABS: { value: Tab; label: string; match: (d: DefRow) => boolean }[] = [
  { value: "todo", label: "To start", match: (d) => d.status === "fix_required" || d.status === "open" },
  { value: "in_progress", label: "In progress", match: (d) => d.status === "in_progress" },
  { value: "fixed", label: "Fixed", match: (d) => d.status === "fixed" },
  { value: "done", label: "Completed", match: (d) => d.status === "verified" },
  { value: "all", label: "All", match: () => true },
];

function TradePortal() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { user, projectId, role } = useAuth();
  const isTrade = role === "trade";
  const { data: people = [] } = useProjectPeople(projectId);
  const [tab, setTab] = useState<Tab>("all");

  const pmap = useMemo(() => peopleMap(people), [people]);
  const company = (user ? pmap.get(user.id)?.company : null)?.trim() || "";
  const statuses = isTrade ? ["fix_required", "in_progress", "fixed", "verified"] : ["open", "fix_required", "in_progress", "fixed", "verified"];
  const mine = useMemo(() => {
    // Trades also see work assigned to their company; BMD crews see only items assigned to them.
    const c = isTrade ? company.toLowerCase() : "";
    return items
      .filter((i) => statuses.includes(i.status))
      .filter((i) => (!!user && i.assigned_to === user.id) || (!!c && tradeOf(i, pmap).toLowerCase() === c))
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.item_number - b.item_number);
  }, [items, pmap, user, company, isTrade]);

  const shown = mine.filter(TABS.find((t) => t.value === tab)!.match);
  const ids = useMemo(() => mine.map((i) => i.id), [mine]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));
  const overdue = mine.filter((i) => i.status !== "fixed" && i.status !== "verified" && i.due_date && i.due_date < today()).length;

  return (
    <div>
      <PageHeader
        title={isTrade ? "Trade portal" : "My items"}
        subtitle={`${isTrade ? company || "Your work" : "Assigned to you"} · ${mine.filter((i) => i.status !== "verified").length} assigned${overdue ? ` · ${overdue} overdue` : ""}`}
        actions={
          isTrade ? (
            <Button variant="ghost" className="h-11" asChild>
              <Link to="/my-work">
                <ArrowLeft className="mr-2 h-4 w-4" /> My work
              </Link>
            </Button>
          ) : undefined
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
            {mine.length === 0 ? isTrade ? "Nothing is assigned to you or your company on this job." : "Nothing is assigned to you on this job yet." : "No items in this view."}
          </p>
        ) : (
          TABS.filter((t) => t.value !== "all" && (tab === "all" || tab === t.value)).map((g) => {
            const group = shown.filter(g.match);
            if (group.length === 0) return null;
            return (
              <section key={g.value} className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase">
                  {g.value === "fixed" ? "Fixed — done, waiting for BMD to verify" : g.value === "done" ? "Completed — verified by BMD" : g.label} ({group.length})
                </h2>
                <ul className={`grid gap-3 lg:grid-cols-2 ${g.value === "fixed" || g.value === "done" ? "opacity-90" : ""}`}>
                  {group.map((d) => {
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
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
