import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ASSESSMENTS, itemNo, STATUS_LABEL, type Assessment, type Status } from "@/lib/bmd";
import {
  useDeficiencies,
  useFloors,
  useInvalidateDeficiencies,
  useProfiles,
  useProject,
  type DefRow,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/list")({
  component: ListPage,
});

type SortKey = "item_number" | "floor" | "material" | "assessment" | "status" | "created_at";

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

  const [search, setSearch] = useState("");
  const [floor, setFloor] = useState("all");
  const [assessment, setAssessment] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("item_number");
  const [asc, setAsc] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = items.filter((d) => {
      if (floor !== "all" && String(d.locations?.floors?.number ?? "") !== floor) return false;
      if (assessment !== "all" && d.assessment !== assessment) return false;
      if (status !== "all" && d.status !== status) return false;
      if (!q) return true;
      return [
        itemNo(d.item_number),
        d.locations?.name,
        d.area,
        d.material,
        d.issue_type,
        d.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    const value = (d: DefRow) => {
      switch (sort) {
        case "floor":
          return d.locations?.floors?.number ?? 0;
        case "material":
          return d.material;
        case "assessment":
          return d.assessment;
        case "status":
          return d.status;
        case "created_at":
          return d.created_at;
        default:
          return d.item_number;
      }
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
  }, [items, search, floor, assessment, status, sort, asc]);

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
    if (sort === key) setAsc(!asc);
    else {
      setSort(key);
      setAsc(true);
    }
  };

  return (
    <div>
      <PageHeader title="All items" subtitle={`${filtered.length} of ${items.length} items`} />

      <div className="flex flex-wrap gap-2 border-b border-border bg-card px-4 py-3 md:px-6">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search room, issue, note…"
          className="h-11 w-full sm:w-64"
        />
        <FilterSelect
          value={floor}
          onChange={setFloor}
          placeholder="Floor"
          options={[{ value: "all", label: "All floors" }, ...floors.map((f) => ({ value: String(f.number), label: floorLabel(f) }))]}
        />
        <FilterSelect
          value={assessment}
          onChange={setAssessment}
          placeholder="Assessment"
          options={[{ value: "all", label: "All assessments" }, ...ASSESSMENTS.map((a) => ({ value: a.value, label: a.label }))]}
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="Status"
          options={[
            { value: "all", label: "All statuses" },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
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
          {canAssign && (<FilterSelect
            value="none"
            placeholder="Assign"
            onChange={(v) => void bulkUpdate({ assigned_to: v === "unassign" ? null : v })}
            options={[
              { value: "none", label: "Assign to…" },
              { value: "unassign", label: "Unassigned" },
              ...profiles.map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? p.id })),
            ]}
          />)}
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-x-auto p-4 md:p-6">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              {canCapture && <th className="w-8 py-2" />}
              <SortableTh label="Item" onClick={() => toggleSort("item_number")} />
              <SortableTh label="Floor" onClick={() => toggleSort("floor")} />
              <th className="py-2 pr-3">Location</th>
              <th className="py-2 pr-3">Area</th>
              <SortableTh label="Material" onClick={() => toggleSort("material")} />
              <th className="py-2 pr-3">Issue</th>
              <SortableTh label="Assessment" onClick={() => toggleSort("assessment")} />
              <SortableTh label="Status" onClick={() => toggleSort("status")} />
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableTh({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <th className="py-2 pr-3">
      <button type="button" onClick={onClick} className="uppercase hover:text-foreground">
        {label}
      </button>
    </th>
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
