import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DefRow } from "./data";

export type Person = { id: string; email: string | null; full_name: string | null; company: string | null; role: string | null };

export function useProjectPeople(projectId?: string | null) {
  return useQuery({
    queryKey: ["project-people", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("project_people" as never, { _project: projectId } as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Person[];
    },
  });
}

export const personName = (p?: Person | null) => p?.full_name?.trim() || p?.email || "Unknown person";

/** Filter/group key: "u:<id>", "t:<trade>", or "none". Person wins over trade. */
export function assignKey(d: Pick<DefRow, "assigned_to" | "assigned_trade">) {
  if (d.assigned_to) return `u:${d.assigned_to}`;
  if (d.assigned_trade?.trim()) return `t:${d.assigned_trade.trim().toLowerCase()}`;
  return "none";
}

/** Trade/company key: explicit trade, else the person's company. */
export function tradeOf(d: Pick<DefRow, "assigned_to" | "assigned_trade">, people: Map<string, Person>) {
  const t = d.assigned_trade?.trim() || (d.assigned_to ? people.get(d.assigned_to)?.company?.trim() : "") || "";
  return t;
}

export function assigneeText(d: Pick<DefRow, "assigned_to" | "assigned_trade">, people: Map<string, Person>) {
  const p = d.assigned_to ? people.get(d.assigned_to) : undefined;
  const person = d.assigned_to ? personName(p) : "";
  const trade = tradeOf(d, people);
  return { person, trade, label: person || trade || "Unassigned" };
}

export const peopleMap = (people: Person[]) => new Map(people.map((p) => [p.id, p]));

export type AssignOption = { value: string; label: string; group: "People" | "Trades" | "" };

/** All · Unassigned · People who have items · Trades. */
export function assignFilterOptions(items: DefRow[], people: Map<string, Person>): AssignOption[] {
  const ppl = new Map<string, string>();
  const trades = new Map<string, string>();
  for (const d of items) {
    if (d.assigned_to) ppl.set(d.assigned_to, personName(people.get(d.assigned_to)));
    const t = tradeOf(d, people);
    if (t) trades.set(t.toLowerCase(), t);
  }
  return [
    { value: "all", label: "Anyone", group: "" },
    { value: "none", label: "Unassigned", group: "" },
    ...[...ppl].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => ({ value: `u:${id}`, label: n, group: "People" as const })),
    ...[...trades].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => ({ value: `t:${k}`, label: n, group: "Trades" as const })),
  ];
}

/** "t:" filters match the trade (explicit or the person's company). */
export function matchesAssign(d: DefRow, filter: string | undefined, people: Map<string, Person>) {
  if (!filter || filter === "all") return true;
  if (filter === "none") return assignKey(d) === "none";
  if (filter.startsWith("u:")) return d.assigned_to === filter.slice(2);
  if (filter.startsWith("t:")) return tradeOf(d, people).toLowerCase() === filter.slice(2);
  return true;
}

/** True when an item has a person, trade, or a responsible party set. */
export const isAssigned = (d: Pick<DefRow, "assigned_to" | "assigned_trade"> & { responsible_party?: string | null }) =>
  !!d.assigned_to || !!d.assigned_trade?.trim() || (!!d.responsible_party && d.responsible_party !== "unassigned");
