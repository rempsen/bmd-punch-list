import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { floorShort } from "@/lib/data";
import { cn } from "@/lib/utils";

export type BoardFilters = { floor?: string | undefined; assess?: string | undefined; q?: string | undefined };

const ASSESS_OPTS = [
  { value: "all", label: "All" },
  { value: "acceptable", label: "Acceptable" },
  { value: "client_review", label: "Needs client review" },
  { value: "must_fix", label: "Must fix" },
];

function Pills({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 rounded px-3 text-sm font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Drop({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 flex-1" aria-label={label}>
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

export function BoardFilterBar({
  filters,
  onChange,
  floors,
  shown,
  total,
}: {
  filters: BoardFilters;
  onChange: (f: BoardFilters) => void;
  floors: { number: number; label: string | null }[];
  shown: number;
  total: number;
}) {
  const floorOpts = [
    { value: "all", label: "All floors" },
    ...floors.map((f) => ({ value: String(f.number), label: floorShort(f) })),
  ];
  const floor = filters.floor ?? "all";
  const assess = filters.assess ?? "all";
  const set = (patch: BoardFilters) => {
    const next = { ...filters, ...patch };
    onChange({
      floor: next.floor && next.floor !== "all" ? next.floor : undefined,
      assess: next.assess && next.assess !== "all" ? next.assess : undefined,
      q: next.q?.trim() ? next.q : undefined,
    });
  };
  const active = !!(filters.floor || filters.assess || filters.q);

  return (
    <div className="space-y-2 border-b border-border bg-card px-4 py-3 md:px-6">
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        <span className="text-xs font-semibold text-muted-foreground uppercase">Floor</span>
        <Pills value={floor} options={floorOpts} onChange={(v) => set({ floor: v })} />
      </div>
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        <span className="text-xs font-semibold text-muted-foreground uppercase">Assessment</span>
        <Pills value={assess} options={ASSESS_OPTS} onChange={(v) => set({ assess: v })} />
      </div>
      <div className="flex gap-2 md:hidden">
        <Drop label="Floor" value={floor} options={floorOpts} onChange={(v) => set({ floor: v })} />
        <Drop
          label="Assessment"
          value={assess}
          options={ASSESS_OPTS.map((o) => (o.value === "all" ? { ...o, label: "All assessments" } : o))}
          onChange={(v) => set({ assess: v })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search D-number or room"
          className="h-10 w-full sm:w-60"
        />
        <span className="text-sm text-muted-foreground">
          Showing {shown} of {total} items
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
