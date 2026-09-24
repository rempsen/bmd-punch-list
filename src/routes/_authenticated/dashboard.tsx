import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
import { ASSESSMENTS, isClosed } from "@/lib/bmd";
import { useAllEvents, useDeficiencies, useFloors, usePickLists, useProject } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { data: floors = [] } = useFloors(project?.id);
  const { data: picks } = usePickLists();
  const { data: events = [] } = useAllEvents(project?.id);

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
    name: floorShort(f) === f.label ? f.label : `F${f.number}`,
    open: filtered.filter((d) => d.locations?.floors?.number === f.number && !isClosed(d.status))
      .length,
  }));

  const byMaterial = (picks?.material ?? []).map((m) => ({
    name: m,
    open: filtered.filter((d) => d.material === m && !isClosed(d.status)).length,
  }));

  const byIssue = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of filtered) map.set(d.issue_type, (map.get(d.issue_type) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const burndown = useMemo(() => {
    const ids = new Set(filtered.map((d) => d.id));
    const relevant = events.filter((e) => ids.has(e.deficiency_id));
    const closedStates = new Set(["verified", "accepted_as_is"]);
    let open = 0;
    const perDay = new Map<string, number>();
    for (const e of relevant) {
      const day = e.created_at.slice(0, 10);
      if (e.event_type === "created") {
        if (!closedStates.has(e.to_value ?? "")) open += 1;
      } else if (e.event_type === "status_change") {
        const wasClosed = closedStates.has(e.from_value ?? "");
        const nowClosed = closedStates.has(e.to_value ?? "");
        if (!wasClosed && nowClosed) open -= 1;
        if (wasClosed && !nowClosed) open += 1;
      } else {
        continue;
      }
      perDay.set(day, Math.max(open, 0));
    }
    return [...perDay.entries()].map(([date, value]) => ({ date, open: value }));
  }, [events, filtered]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={project?.name ?? undefined} />

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Total" value={stats.total} />
          <Stat label="Acceptable" value={stats.acceptable} tone="bg-acceptable/15" />
          <Stat label="Needs client review" value={stats.review} tone="bg-review/20" />
          <Stat label="Must fix" value={stats.mustFix} tone="bg-mustfix/10" />
          <Stat label="Open" value={stats.open} />
          <Stat label="Closed" value={stats.closed} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Open items by floor">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byFloor}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="open" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Open items by material">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byMaterial}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="open" fill="var(--mustfix)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Burn-down (open items over time)">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={burndown}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Line type="monotone" dataKey="open" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
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
        </div>
      </div>
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
