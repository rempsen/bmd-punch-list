import { useAuth } from "@/lib/auth";
import { AiSummary } from "@/components/AiSummary";
import { JobOverall } from "@/components/JobOverall";
import { EmailInbox } from "@/components/EmailInbox";
import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Plus, X } from "lucide-react";
import { StatusBadge } from "@/components/badges";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSESSMENTS, isClosed, itemNo } from "@/lib/bmd";
import { RESPONSIBLE } from "@/lib/responsible";
import { assigneeText, peopleMap, useProjectPeople } from "@/lib/assign";
import { clientLine, useContacts, useDeficiencies, useFloors, usePickLists, useProject, type DefRow } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (s: Record<string, unknown>): { welcome?: string | undefined } => ({
    welcome: typeof s["welcome"] === "string" ? s["welcome"] : undefined,
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { can, isSuperAdmin, role } = useAuth();
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { data: people = [] } = useProjectPeople(project?.id);
  const { data: floors = [] } = useFloors(project?.id);
  const { data: picks } = usePickLists();
  const { data: contacts = [] } = useContacts(project?.id);
  const { welcome } = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard" });

  const [view, setView] = useState<"deficiencies" | "overall">("deficiencies");
  const [floor, setFloor] = useState("all");
  const [assessment, setAssessment] = useState("all");
  const [material, setMaterial] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () =>
      items.filter((d) => {
        if (floor !== "all" && String(d.locations?.floors?.number ?? "") !== floor) return false;
        if (assessment !== "all" && d.assessment !== assessment) return false;
        if (material !== "all" && d.material !== material) return false;
        if (from && d.created_at < from) return false;
        if (to && d.created_at > `${to}T23:59:59`) return false;
        return true;
      }),
    [items, floor, assessment, material, from, to],
  );

  const stats = {
    total: filtered.length,
    acceptable: filtered.filter((d) => d.assessment === "acceptable").length,
    review: filtered.filter((d) => d.assessment === "client_review").length,
    mustFix: filtered.filter((d) => d.assessment === "must_fix").length,
    open: filtered.filter((d) => !isClosed(d.status)).length,
    closed: filtered.filter((d) => isClosed(d.status)).length,
  };

  const byFloor = floors.map((f) => ({
    name: floorShort(f),
    open: filtered.filter((d) => d.locations?.floors?.number === f.number && !isClosed(d.status))
      .length,
  }));

  const byMaterial = (picks?.material ?? []).map((m) => ({
    name: m,
    open: filtered.filter((d) => d.material === m && !isClosed(d.status)).length,
  }));

  const openRows = filtered.filter((d) => !isClosed(d.status));
  const byResp = RESPONSIBLE.map((r) => ({
    label: r.short,
    count: openRows.filter((d) => d.responsible_party === r.value).length,
  }));
  const byAssignee = (() => {
    const pm = peopleMap(people);
    const map = new Map<string, { name: string; sub: string; count: number; mustFix: number }>();
    for (const d of openRows) {
      const a = assigneeText(d, pm);
      const name = a.person || a.trade || "Unassigned";
      const k = name.toLowerCase();
      const row = map.get(k) ?? { name, sub: a.person && a.trade ? a.trade : "", count: 0, mustFix: 0 };
      row.count += 1;
      if (d.assessment === "must_fix") row.mustFix += 1;
      map.set(k, row);
    }
    return [...map.values()].sort((x, y) => (x.name === "Unassigned" ? 1 : y.name === "Unassigned" ? -1 : y.count - x.count));
  })();

  const byIssue = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of filtered) map.set(d.issue_type, (map.get(d.issue_type) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  if (!can("view_dashboard"))
    return (
      <div>
        <PageHeader title="Dashboard" />
        <p className="p-6 text-sm text-muted-foreground">You don't have access to the dashboard.</p>
      </div>
    );

  return (
    <div>
      <PageHeader title={project?.name ?? "Dashboard"} subtitle={[project?.address, clientLine(project?.client_name, contacts)].filter(Boolean).join(" · ") || undefined} />
      <div className="md:hidden">
        <MobileDashboard items={items} people={people} />
      </div>
      <div className="hidden md:block">
      {(isSuperAdmin || role === "bmd_manager") && <EmailInbox />}
      {welcome && (
        <div className="mx-4 mt-4 rounded-lg border border-blush bg-card p-4 md:mx-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">Your new job is set up</p>
              <p className="text-sm text-muted-foreground">Three things to do next:</p>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => void navigate({ search: {}, replace: true })} className="rounded p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { to: "/settings" as const, search: { tab: "users" }, label: "Invite users", hint: "Settings → Users" },
              { to: "/settings" as const, search: { tab: "lists" }, label: "Review pick lists", hint: "Settings → Pick lists" },
              { to: "/capture" as const, search: undefined, label: "Add a deficiency", hint: "Log the first deficiency" },
            ].map((c) => (
              <li key={c.label}>
                <Link to={c.to} search={c.search as never} className="flex min-h-14 items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <span>
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div role="tablist" className="flex gap-1 border-b border-border bg-card px-4 pt-3 md:px-6">
        {(["deficiencies", "overall"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`min-h-11 border-b-2 px-4 text-sm font-medium ${view === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {v === "deficiencies" ? "Deficiencies" : "Overall"}
          </button>
        ))}
      </div>

      {view === "overall" && project ? (
        <JobOverall project={project} items={items} contacts={contacts} />
      ) : (
      <>
      <div className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-3 md:px-6">
        <Filter
          value={floor}
          onChange={setFloor}
          options={[
            { value: "all", label: "All floors" },
            ...floors.map((f) => ({ value: String(f.number), label: `Floor ${f.number}` })),
          ]}
        />
        <Filter
          value={assessment}
          onChange={setAssessment}
          options={[
            { value: "all", label: "All assessments" },
            ...ASSESSMENTS.map((a) => ({ value: a.value, label: a.label })),
          ]}
        />
        <Filter
          value={material}
          onChange={setMaterial}
          options={[
            { value: "all", label: "All materials" },
            ...(picks?.material ?? []).map((m) => ({ value: m, label: m })),
          ]}
        />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-40" />
      </div>

      <div className="space-y-6 p-4 md:p-6">
        <AiSummary />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Total" value={stats.total} />
          <Stat label="Acceptable" value={stats.acceptable} tone="bg-acceptable/15" />
          <Stat label="Needs client review" value={stats.review} tone="bg-review/20" />
          <Stat label="Must fix" value={stats.mustFix} tone="bg-mustfix/10" />
          <Stat label="Open" value={stats.open} />
          <Stat label="Closed" value={stats.closed} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Open items by assignee / trade">
            {byAssignee.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open items.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                    <th className="py-1.5">Assignee / trade</th>
                    <th className="py-1.5 text-right">Open</th>
                    <th className="py-1.5 text-right">Must fix</th>
                  </tr>
                </thead>
                <tbody>
                  {byAssignee.map((r) => (
                    <tr key={r.name} className="border-b border-border/60">
                      <td className="py-1.5">
                        {r.name}
                        {r.sub && <span className="block text-xs text-muted-foreground">{r.sub}</span>}
                      </td>
                      <td className="py-1.5 text-right font-medium">{r.count}</td>
                      <td className="py-1.5 text-right">{r.mustFix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Breakdown by issue type">
            <ul className="space-y-2">
              {byIssue.map(([name, count]) => (
                <li key={name} className="flex items-center gap-3 text-sm">
                  <span className="w-48 shrink-0 truncate">{name}</span>
                  <span className="h-2 flex-1 rounded bg-muted">
                    <span
                      className="block h-2 rounded bg-primary"
                      style={{ width: `${(count / Math.max(1, byIssue[0]?.[1] ?? 1)) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 text-right font-medium">{count}</span>
                </li>
              ))}
              {byIssue.length === 0 && <p className="text-sm text-muted-foreground">No items.</p>}
            </ul>
          </Panel>

          <Panel title="Open items by material">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byMaterial}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip cursor={false} content={({ active, payload, label }) => active && payload?.length && Number(payload[0]?.value) > 0 ? <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm">{label}: {payload[0]?.value} open</div> : null} />
                <Bar dataKey="open" activeBar={false} fill="var(--mustfix)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Open items by floor">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byFloor}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip cursor={false} content={({ active, payload, label }) => active && payload?.length && Number(payload[0]?.value) > 0 ? <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm">{label}: {payload[0]?.value} open</div> : null} />
                <Bar dataKey="open" activeBar={false} fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs">
          <span className="font-semibold text-muted-foreground uppercase">Open by responsible party</span>
          {byResp.map((r) => (
            <span key={r.label} className="flex items-center gap-1.5 text-muted-foreground">
              {r.label}
              <span className={`rounded-full px-2 py-0.5 font-semibold ${r.count > 0 ? "bg-muted text-foreground" : "text-muted-foreground"}`}>{r.count}</span>
            </span>
          ))}
        </section>
      </div>
      </>
      )}
      </div>
    </div>
  );
}

function MobileDashboard({ items, people }: { items: DefRow[]; people: Parameters<typeof peopleMap>[0] }) {
  const { user, can } = useAuth();
  const [lastFloor, setLastFloor] = useState<string | null>(null);
  useEffect(() => setLastFloor(localStorage.getItem("bmd:lastFloor")), []);
  const today = new Date().toISOString().slice(0, 10);
  const open = items.filter((d) => !isClosed(d.status));
  const stats = [
    { label: "Open", value: open.length },
    { label: "Must fix", value: open.filter((d) => d.assessment === "must_fix").length, tone: "text-mustfix" },
    { label: "Awaiting client", value: items.filter((d) => d.status === "awaiting_client").length },
    { label: "Fixed today", value: items.filter((d) => d.status === "fixed" && d.updated_at.slice(0, 10) === today).length },
  ];
  const mine = items
    .filter((d) => d.created_by === user?.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);
  const attention = open.filter(
    (d) => d.assessment === "must_fix" && (!lastFloor || d.locations?.floor_id === lastFloor),
  );
  const pm = peopleMap(people);
  const Row = ({ d }: { d: DefRow }) => (
    <li>
      <Link to="/item/$id" params={{ id: d.id }} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-muted">
        <span className="shrink-0 font-mono text-sm font-semibold">{itemNo(d.item_number)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{d.locations?.name} · {d.issue_type}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {d.material}{assigneeText(d, pm).person || assigneeText(d, pm).trade ? ` · ${assigneeText(d, pm).person || assigneeText(d, pm).trade}` : ""}
          </span>
        </span>
        <StatusBadge value={d.status} />
      </Link>
    </li>
  );
  return (
    <div className="space-y-5 p-4">
      {can("capture_items") && (
        <Link to="/capture" className="flex min-h-20 items-center gap-4 rounded-xl bg-primary px-5 text-primary-foreground shadow-md active:scale-[0.99]">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-foreground/15">
            <Plus className="h-7 w-7" strokeWidth={3} />
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-semibold">Add a deficiency</span>
            <span className="block text-xs opacity-80">Picks up where you left off</span>
          </span>
        </Link>
      )}
      <div className="grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-2 py-2.5 text-center">
            <p className={`text-xl font-semibold ${s.tone ?? ""}`}>{s.value}</p>
            <p className="text-[10px] leading-tight font-medium text-muted-foreground uppercase">{s.label}</p>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground uppercase">Needs attention</h2>
        {attention.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No open must-fix items{lastFloor ? " on your last floor" : ""}.</p>
        ) : (
          <ul className="divide-y divide-border">{attention.slice(0, 15).map((d) => <Row key={d.id} d={d} />)}</ul>
        )}
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground uppercase">My recent items</h2>
        {mine.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">You haven't added any items yet.</p>
        ) : (
          <ul className="divide-y divide-border">{mine.map((d) => <Row key={d.id} d={d} />)}</ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-card p-4 ${tone ?? ""}`}>
      <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Filter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
