import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { AssignDialog } from "@/components/AssignDialog";
import {
  assigneeText,
  assignFilterOptions,
  matchesAssign,
  peopleMap,
  useProjectPeople,
  type AssignOption,
  type Person,
} from "@/lib/assign";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { AssessmentBadge, StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ASSESSMENTS, isClosed, itemNo, STATUS_LABEL, type Assessment, type Status } from "@/lib/bmd";
import {
  useDeficiencies,
  useFloors,
  useInvalidateDeficiencies,
  useProfiles,
  useProject,
  type DefRow,
} from "@/lib/data";

const SORT_KEYS = ["item_number", "floor", "location", "area", "material", "issue", "assessment", "status", "assigned", "created_at"] as const;
type SortKey = (typeof SORT_KEYS)[number];
type ListSearch = {
  q?: string | undefined;
  floor?: string | undefined;
  assess?: string | undefined;
  status?: string | undefined;
  assign?: string | undefined;
  open?: boolean | undefined;
  sort?: SortKey | undefined;
  dir?: "asc" | "desc" | undefined;
};
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

export const Route = createFileRoute("/_authenticated/list")({
  validateSearch: (s: Record<string, unknown>): ListSearch => ({
    q: str(s["q"]),
    floor: str(s["floor"]),
    assess: str(s["assess"]),
    status: str(s["status"]),
    assign: str(s["assign"]),
    open: s["open"] === true || s["open"] === "1" || s["open"] === 1 ? true : undefined,
    sort: SORT_KEYS.includes(s["sort"] as SortKey) ? (s["sort"] as SortKey) : undefined,
    dir: s["dir"] === "asc" || s["dir"] === "desc" ? s["dir"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "All items — BMD Deficiency Tracker" },
      { name: "description", content: "Search, filter, sort and assign every deficiency on the job." },
      { property: "og:title", content: "All items — BMD Deficiency Tracker" },
      { property: "og:description", content: "Search, filter, sort and assign every deficiency on the job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ListPage,
});

const STATUS_ORDER = Object.keys(STATUS_LABEL);

function ListPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { data: floors = [] } = useFloors(project?.id);
  const { data: profiles = [] } = useProfiles();
  const { can } = useAuth();
  const canCapture = can("edit_any_item") || can("add_photos");
  const isAdmin = can("change_assessment") && can("edit_any_item");
  const canAssign = can("assign_items");
  const invalidate = useInvalidateDeficiencies();

  const sp = Route.useSearch();
  const navigate = useNavigate({ from: "/list" });
  const setSp = (patch: Partial<ListSearch>) =>
    void navigate({ search: (prev: ListSearch) => ({ ...prev, ...patch }), replace: true });
  const search = sp.q ?? "";
  const floor = sp.floor ?? "all";
  const assessment = sp.assess ?? "all";
  const status = sp.status ?? "all";
  const assign = sp.assign ?? "all";
  const openOnly = !!sp.open;
  const sort: SortKey = sp.sort ?? "item_number";
  const asc = sp.dir ? sp.dir === "asc" : false;
  const [selected, setSelected] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const { projectId } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const pmap = useMemo(() => peopleMap(people), [people]);
  const assignOptions = useMemo(() => assignFilterOptions(items, pmap), [items, pmap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = items.filter((d) => {
      if (floor !== "all" && String(d.locations?.floors?.number ?? "") !== floor) return false;
      if (assessment !== "all" && d.assessment !== assessment) return false;
      if (status !== "all" && d.status !== status) return false;
      if (openOnly && isClosed(d.status)) return false;
      if (!matchesAssign(d, assign, pmap)) return false;
      if (!q) return true;
      return [
        itemNo(d.item_number),
        d.locations?.name,
        d.area,
        d.material,
        d.issue_type,
        d.description,
        assigneeText(d, pmap).label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    const value = (d: DefRow): string | number => {
      switch (sort) {
        case "floor":
          return d.locations?.floors?.number ?? 0;
        case "location":
          return d.locations?.name ?? "";
        case "area":
          return d.area;
        case "material":
          return d.material;
        case "issue":
          return d.issue_type;
        case "assessment":
          return d.assessment;
        case "status":
          return STATUS_ORDER.indexOf(d.status);
        case "assigned": {
          const a = assigneeText(d, pmap);
          return a.person || a.trade ? a.label.toLowerCase() : "\uffff";
        }
        case "created_at":
          return d.created_at;
        default:
          return d.item_number;
      }
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return (asc ? cmp : -cmp) || b.item_number - a.item_number;
    });
  }, [items, search, floor, assessment, status, openOnly, assign, pmap, sort, asc]);

  const anyFilter = !!(sp.q || sp.floor || sp.assess || sp.status || sp.assign || sp.open);

  const bulkUpdate = async (patch: Record<string, unknown>) => {
    let failures = 0;
    for (const id of selected) {
      const { error } = await supabase
        .from("deficiencies")
        .update(patch as never)
        .eq("id", id);
      if (error) failures += 1;
    }
    invalidate();
    setSelected([]);
    if (failures) toast.error(`${failures} item(s) could not be updated`);
    else toast.success("Items updated");
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setSp({ sort: key, dir: asc ? "desc" : "asc" });
    else setSp({ sort: key, dir: "asc" });
  };
  const th = (label: string, key: SortKey) => (
    <SortableTh label={label} active={sort === key} asc={asc} onClick={() => toggleSort(key)} />
  );

  return (
    <div>
      <PageHeader title="All items" subtitle={`${filtered.length} of ${items.length} items`} />

      <div className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-3 md:px-6">
        <Input
          value={search}
          onChange={(e) => setSp({ q: e.target.value || undefined })}
          placeholder="Search room, issue, note…"
          className="h-11 w-full sm:w-64"
        />
        <FilterSelect
          value={floor}
          onChange={(v) => setSp({ floor: v === "all" ? undefined : v })}
          placeholder="Floor"
          options={[{ value: "all", label: "All floors" }, ...floors.map((f) => ({ value: String(f.number), label: floorLabel(f) }))]}
        />
        <FilterSelect
          value={assessment}
          onChange={(v) => setSp({ assess: v === "all" ? undefined : v })}
          placeholder="Assessment"
          options={[{ value: "all", label: "All assessments" }, ...ASSESSMENTS.map((a) => ({ value: a.value, label: a.label }))]}
        />
        <FilterSelect
          value={status}
          onChange={(v) => setSp({ status: v === "all" ? undefined : v })}
          placeholder="Status"
          options={[
            { value: "all", label: "All statuses" },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <AssignFilter value={assign} options={assignOptions} onChange={(v) => setSp({ assign: v === "all" ? undefined : v })} />
        <label className="flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
          <Checkbox checked={openOnly} onCheckedChange={(c) => setSp({ open: c ? true : undefined })} />
          Open only
        </label>
        <div className="flex w-full items-center gap-3 text-sm text-muted-foreground sm:ml-auto sm:w-auto">
          <span>
            {filtered.length} of {items.length} items
          </span>
          {anyFilter && (
            <button
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => void navigate({ search: sort !== "item_number" || sp.dir ? { sort: sp.sort, dir: sp.dir } : {}, replace: true })}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {canCapture && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-primary/5 px-4 py-3 md:px-6">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <FilterSelect
            value="none"
            placeholder="Set status"
            onChange={(v) => void bulkUpdate({ status: v as Status })}
            options={[
              { value: "none", label: "Set status…" },
              ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          {isAdmin && (
            <FilterSelect
              value="none"
              placeholder="Set assessment"
              onChange={(v) => void bulkUpdate({ assessment: v as Assessment })}
              options={[
                { value: "none", label: "Set assessment…" },
                ...ASSESSMENTS.map((a) => ({ value: a.value, label: a.label })),
              ]}
            />
          )}
          {canAssign && (
            <Button variant="secondary" className="h-11" onClick={() => setAssignOpen(true)}>
              Assign selected…
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto p-4 md:p-6">
        <AssignDialog open={assignOpen} onOpenChange={setAssignOpen} ids={selected} onDone={() => setSelected([])} />
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              {canCapture && <th className="w-8 py-2" />}
              {th("Item", "item_number")}
              {th("Floor", "floor")}
              {th("Location", "location")}
              {th("Area", "area")}
              {th("Material", "material")}
              {th("Issue", "issue")}
              {th("Assessment", "assessment")}
              {th("Status", "status")}
              {th("Assigned to", "assigned")}
              {th("Created", "created_at")}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} className="border-b border-border/60 hover:bg-muted/40">
                {canCapture && (
                  <td className="py-2">
                    <Checkbox
                      checked={selected.includes(d.id)}
                      onCheckedChange={(c) =>
                        setSelected(c ? [...selected, d.id] : selected.filter((s) => s !== d.id))
                      }
                    />
                  </td>
                )}
                <td className="py-2 pr-3 font-mono font-semibold">
                  <Link to="/item/$id" params={{ id: d.id }} className="hover:underline">
                    {itemNo(d.item_number)}
                  </Link>
                </td>
                <td className="py-2 pr-3">{floorShort(d.locations?.floors)}</td>
                <td className="py-2 pr-3">{d.locations?.name}</td>
                <td className="py-2 pr-3 text-muted-foreground">{d.area}</td>
                <td className="py-2 pr-3">{d.material}</td>
                <td className="py-2 pr-3 text-muted-foreground">{d.issue_type}</td>
                <td className="py-2 pr-3">
                  <AssessmentBadge value={d.assessment} />
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge value={d.status} />
                </td>
                <td className="py-2 pr-3">
                  <AssigneeCell d={d} pmap={pmap} />
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                  {new Date(d.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableTh({ label, active, asc, onClick }: { label: string; active: boolean; asc: boolean; onClick: () => void }) {
  const Icon = !active ? ArrowUpDown : asc ? ArrowUp : ArrowDown;
  return (
    <th className="py-2 pr-3" aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={onClick}
        className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", active && "text-foreground")}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}

function AssigneeCell({ d, pmap }: { d: DefRow; pmap: Map<string, Person> }) {
  const a = assigneeText(d, pmap);
  if (!a.person && !a.trade) return <span className="text-muted-foreground">Unassigned</span>;
  return (
    <span>
      {a.person || a.trade}
      {a.person && a.trade && <span className="block text-xs text-muted-foreground">{a.trade}</span>}
    </span>
  );
}

export function AssignFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: AssignOption[];
  onChange: (v: string) => void;
}) {
  const groups: ("" | "People" | "Trades")[] = ["", "People", "Trades"];
  return (
    <Select value={options.some((o) => o.value === value) ? value : "all"} onValueChange={onChange}>
      <SelectTrigger className="h-11 w-full sm:w-52">
        <span className="mr-1 text-muted-foreground">Assigned:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => {
          const opts = options.filter((o) => o.group === g);
          if (opts.length === 0) return null;
          return (
            <SelectGroup key={g || "base"}>
              {g && <SelectLabel>{g}</SelectLabel>}
              {opts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 w-full sm:w-44">
        <SelectValue placeholder={placeholder} />
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
