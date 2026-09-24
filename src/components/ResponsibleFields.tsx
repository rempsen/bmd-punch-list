import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { personName, useProjectPeople, type Person } from "@/lib/assign";
import { useContacts, useDeficiencies } from "@/lib/data";
import { roleLabel } from "@/lib/roles";
import { RESPONSIBLE, type Responsible } from "@/lib/responsible";
import { cn } from "@/lib/utils";

const BMD_ROLES = ["super_admin", "bmd_admin", "bmd_manager", "bmd_field"];

/** Assignee value: "u:<id>", "t:<trade>" or null. */
export function assigneePatch(value: string | null, people: Person[]) {
  if (!value) return { assigned_to: null, assigned_trade: null };
  if (value.startsWith("u:")) {
    const id = value.slice(2);
    return { assigned_to: id, assigned_trade: people.find((p) => p.id === id)?.company?.trim() || null };
  }
  return { assigned_to: null, assigned_trade: value.slice(2).trim() || null };
}

export function assigneeValue(d: { assigned_to: string | null; assigned_trade: string | null }) {
  if (d.assigned_to) return `u:${d.assigned_to}`;
  if (d.assigned_trade?.trim()) return `t:${d.assigned_trade.trim()}`;
  return null;
}

export function ResponsibleFields({
  projectId,
  responsible,
  onResponsible,
  assignee,
  onAssignee,
  large,
  hint,
}: {
  projectId: string | null | undefined;
  responsible: Responsible;
  onResponsible: (v: Responsible) => void;
  assignee: string | null;
  onAssignee: (v: string | null) => void;
  large?: boolean;
  hint?: string | null;
}) {
  const { data: people = [] } = useProjectPeople(projectId);
  const { data: contacts = [] } = useContacts(projectId);
  const { data: items = [] } = useDeficiencies(projectId ?? undefined);
  const [extra, setExtra] = useState<string[]>([]);

  const options = useMemo<SearchOption[]>(() => {
    const seen = new Map<string, string>();
    for (const t of [
      ...extra,
      ...items.map((d) => d.assigned_trade),
      ...contacts.map((c) => c.company),
      ...people.map((p) => p.company),
      assignee?.startsWith("t:") ? assignee.slice(2) : null,
    ]) {
      const v = t?.trim();
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    }
    const trades = [...seen.values()].sort((a, b) => a.localeCompare(b));
    const isBmd = (p: Person) => BMD_ROLES.includes(p.role ?? "");
    const rank = (p: Person) => {
      if (responsible === "bmd") return isBmd(p) ? 0 : 1;
      if (responsible === "trade") return p.role === "trade" ? 0 : 1;
      if (responsible === "client") return p.role === "client" ? 0 : 1;
      return 0;
    };
    const ppl: SearchOption[] = [...people]
      .sort((a, b) => rank(a) - rank(b) || personName(a).localeCompare(personName(b)))
      .map((p) => ({
        value: `u:${p.id}`,
        group: "People",
        label: `${personName(p)} · ${roleLabel(p.role ?? "")}${p.company ? ` · ${p.company}` : ""}`,
      }));
    const tr: SearchOption[] = trades.map((t) => ({ value: `t:${t}`, label: t, group: "Trades" }));
    const none: SearchOption = { value: "none", label: "Not assigned", group: "" };
    return responsible === "trade" ? [none, ...tr, ...ppl] : [none, ...ppl, ...tr];
  }, [people, contacts, items, extra, responsible, assignee]);

  const h = large ? "h-14 text-base" : "h-11";
  return (
    <div className={cn("grid gap-3", !large && "md:grid-cols-2")}>
      <div className="space-y-1.5">
        <Label htmlFor="resp-party">Responsible party</Label>
        <Select value={responsible} onValueChange={(v) => onResponsible(v as Responsible)}>
          <SelectTrigger id="resp-party" className={h}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESPONSIBLE.map((r) => (
              <SelectItem key={r.value} value={r.value} className={large ? "py-3 text-base" : undefined}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={cn("space-y-1.5", large && "[&_button]:h-14 [&_button]:text-base")}>
        <Label htmlFor="resp-assignee">Assign to (user or trade)</Label>
        <SearchSelect
          id="resp-assignee"
          value={assignee ?? "none"}
          onChange={(v) => onAssignee(v === "none" ? null : v)}
          options={options}
          placeholder="Not assigned"
          createLabel="Add a new trade"
          onCreate={(text) => {
            const t = text.trim();
            if (!t) return;
            setExtra((x) => [...x, t]);
            onAssignee(`t:${t}`);
          }}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground md:col-span-2">{hint}</p>}
    </div>
  );
}
