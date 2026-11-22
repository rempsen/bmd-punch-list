import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { dueInfo, today } from "@/components/TradeWork";
import { useAuth } from "@/lib/auth";
import { isClosed, itemNo } from "@/lib/bmd";
import { floorLabel, useDeficiencies, usePhotos, useProject, type DefRow } from "@/lib/data";
import { assigneeText, peopleMap, tradeOf, useProjectPeople } from "@/lib/assign";
import { respLabel } from "@/lib/responsible";
import { useSignedUrls } from "@/lib/photos";

export const Route = createFileRoute("/_authenticated/company-work")({
  head: () => ({
    meta: [
      { title: "Company items — BMD Projects" },
      { name: "description", content: "Items assigned to your company, with status, due dates and photos." },
      { property: "og:title", content: "Company items — BMD Projects" },
      { property: "og:description", content: "Items assigned to your company, with status, due dates and photos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompanyWork,
});

type Tab = "open" | "overdue" | "closed" | "all";

function CompanyWork() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { user, projectId, role } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const pmap = useMemo(() => peopleMap(people), [people]);
  const [tab, setTab] = useState<Tab>("open");

  const me = user ? pmap.get(user.id) : undefined;
  const company = me?.company?.trim() || "";
  const isBmd = /^bmd\b/i.test(company) || ["super_admin", "bmd_manager", "bmd_field"].includes(role ?? "");
  const isClient = role === "client";

  const mine = useMemo(() => {
    const c = company.toLowerCase();
    return items
      .filter(
        (d) =>
          (!!user && d.assigned_to === user.id) ||
          (!!c && tradeOf(d, pmap).toLowerCase() === c) ||
          (isBmd && d.responsible_party === "bmd") ||
          (isClient && d.responsible_party === "client"),
      )
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.item_number - b.item_number);
  }, [items, pmap, user, company, isBmd, isClient]);

  const t = today();
  const overdue = (d: DefRow) => !isClosed(d.status) && d.status !== "fixed" && !!d.due_date && d.due_date < t;
  const tabs: { value: Tab; label: string; match: (d: DefRow) => boolean }[] = [
    { value: "open", label: "Open", match: (d) => !isClosed(d.status) },
    { value: "overdue", label: "Overdue", match: overdue },
    { value: "closed", label: "Closed", match: (d) => isClosed(d.status) },
    { value: "all", label: "All", match: () => true },
  ];
  const shown = mine.filter(tabs.find((x) => x.value === tab)!.match);

  const ids = useMemo(() => mine.map((d) => d.id), [mine]);
  const { data: photos = [] } = usePhotos(ids);
  const { data: urls = {} } = useSignedUrls(useMemo(() => photos.map((p) => p.storage_path), [photos]));

  const stats = [
    { label: "Assigned", value: mine.length },
    { label: "Open", value: mine.filter((d) => !isClosed(d.status)).length },
    { label: "Fixed, to verify", value: mine.filter((d) => d.status === "fixed").length },
    { label: "Overdue", value: mine.filter(overdue).length },
  ];

  return (
    <div>
      <PageHeader title="Company items" subtitle={`Assigned to ${company || "you"} on ${project?.name ?? "this job"}`} />
      <div className="space-y-5 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground uppercase">{s.label}</p>
              <p className={`text-2xl font-semibold ${s.label === "Overdue" && s.value ? "text-destructive" : ""}`}>{s.value}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((x) => (
            <Button key={x.value} className="h-11" variant={tab === x.value ? "default" : "outline"} onClick={() => setTab(x.value)}>
              {x.label} ({mine.filter(x.match).length})
            </Button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {mine.length === 0 ? "Nothing is assigned to your company on this job." : "No items in this view."}
          </p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {shown.map((d) => {
              const due = dueInfo(d.due_date);
              const shots = photos.filter((p) => p.deficiency_id === d.id);
              const a = assigneeText(d, pmap);
              return (
                <li key={d.id} className="rounded-lg border border-border bg-card p-4 transition hover:border-primary hover:shadow-md">
                  <Link to="/item/$id" params={{ id: d.id }} className="group block">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold group-hover:underline">
                        {itemNo(d.item_number)} · {floorLabel(d.locations?.floors)} · {d.locations?.name}
                      </span>
                      <StatusBadge value={d.status} />
                      <AssessmentBadge value={d.assessment} />
                    </div>
                    <p className="mt-1 text-sm">{d.material} — {d.issue_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.area} · {respLabel(d.responsible_party)}{a.label !== "Unassigned" ? ` · ${a.label}` : ""}
                    </p>
                    <p className={`mt-1 flex items-center gap-1 text-xs ${due.tone}`}>
                      <CalendarClock className="h-3.5 w-3.5" /> {due.text}
                    </p>
                    {shots.length > 0 ? (
                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {shots.slice(0, 8).map((p) => (
                          <div key={p.id} className="relative">
                            <img src={urls[p.storage_path]} alt={`${p.kind} photo`} className="h-20 w-full rounded-md bg-muted object-cover" />
                            <span className="absolute bottom-1 left-1 rounded bg-card/90 px-1 text-[10px] font-semibold uppercase">{p.kind}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground">No photos yet.</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
