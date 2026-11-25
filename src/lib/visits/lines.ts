// Work-order lines: the items from the approved estimate a work order covers ("500 SF of LVT", "10 LF of base"), what's
// already on other work orders, and the "Work:" block the crew sees in ArrivePing. Pure; the drawer, the panel and the
// push payload all go through here.

/** A row from the `work_order_items` RPC: one line of the job's approved estimate, without costs. */
export type WorkOrderItem = {
  estimate_line_id: string;
  finish_id: string | null;
  finish_tag: string | null;
  section: string | null;
  kind: string;
  description: string | null;
  quantity: number | string | null;
  uom: string | null;
  cost_code: string | null;
  sort_order: number;
  /** The line's labour parts, for valuing work orders; null for people without view_pricing (see visits/valuation.ts). */
  labour_components?: import("./valuation").LabourComponent[] | null;
  labour_rate_id?: string | null;
};

/** A row of `install_visit_lines` (or a draft of one before the work order is saved). */
export type VisitLine = {
  id?: string;
  visit_id?: string;
  estimate_line_id: string | null;
  finish_id?: string | null;
  description: string;
  quantity: number | string;
  uom: string;
  cost_code?: string | null;
  sort_order?: number;
  /** The rate the line was valued at (whole cents per `uom`); readable only through `work_order_values`, so usually absent here. */
  unit_labour_cost_cents?: number | null;
  labour_rate_source?: "estimate" | "catalogue" | "manual" | null;
  labour_rate_id?: string | null;
  /** Set in the drawer by "Use estimate rate": the manual rate is dropped and the line valued again when saved. */
  clear_manual?: boolean;
};

/** Estimate line kinds that are not work a crew does unless the estimator gave them a quantity. */
const NON_WORK_KINDS = new Set(["misc", "delivery", "allowance", "lump_sum"]);

export const num = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n as number) ? (n as number) : 0;
};

/** The estimate lines a crew can be sent to do: everything except misc / delivery / allowance / lump sums with no quantity. */
export function estimateWorkItems(items: WorkOrderItem[]): WorkOrderItem[] {
  return items
    .filter((i) => !NON_WORK_KINDS.has(i.kind) || num(i.quantity) > 0)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Items grouped for the picker: by finish tag when the line has one ("CPT", "LVT"), else by section, else "Other". */
export function groupWorkItems(items: WorkOrderItem[]): { label: string; items: WorkOrderItem[] }[] {
  const groups = new Map<string, WorkOrderItem[]>();
  for (const i of items) {
    const label = (i.finish_tag || i.section || "Other").trim() || "Other";
    const g = groups.get(label);
    if (g) g.push(i);
    else groups.set(label, [i]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

/** Quantity of an estimate line already on other work orders (lines of this work order excluded by the caller). */
export function onOtherWorkOrders(item: Pick<WorkOrderItem, "estimate_line_id">, otherLines: VisitLine[]): number {
  return otherLines.filter((l) => l.estimate_line_id === item.estimate_line_id).reduce((s, l) => s + num(l.quantity), 0);
}

/** What is left of an estimate line after the other work orders; can go negative when the crews were sent more than the estimate. */
export function remainingFor(item: Pick<WorkOrderItem, "estimate_line_id" | "quantity">, otherLines: VisitLine[]): number {
  return num(item.quantity) - onOtherWorkOrders(item, otherLines);
}

/** Over-remaining is allowed (field conditions change) but flagged. */
export function overRemaining(
  item: Pick<WorkOrderItem, "estimate_line_id" | "quantity">,
  quantity: number | string,
  otherLines: VisitLine[],
): boolean {
  return num(quantity) > remainingFor(item, otherLines) + 1e-9;
}

export function fmtQty(v: number | string | null | undefined): string {
  const n = num(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });
}

/** "500 SF LVT · 10 LF base" — one phrase per line, for cards and the picker. */
export function lineSummary(lines: VisitLine[]): string {
  return lines
    .filter((l) => l.description.trim() || num(l.quantity) > 0)
    .map((l) => `${fmtQty(l.quantity)} ${l.uom} ${l.description.trim()}`.trim())
    .join(" · ");
}

/** The "Work:" block the crew reads in ArrivePing, one item per line; empty string when there are no lines. */
export function workBlock(lines: VisitLine[]): string {
  const rows = lines
    .filter((l) => l.description.trim() || num(l.quantity) > 0)
    .map((l) => `- ${fmtQty(l.quantity)} ${l.uom} ${l.description.trim()}`.trimEnd());
  return rows.length ? ["Work:", ...rows].join("\n") : "";
}

/** Lines changed enough to re-push: compares what matters to the crew, not ids or order of insertion. */
export function linesChanged(before: VisitLine[], after: VisitLine[]): boolean {
  const key = (ls: VisitLine[]) =>
    ls
      .map((l) => `${l.estimate_line_id ?? ""}|${l.description.trim()}|${num(l.quantity)}|${l.uom}`)
      .sort()
      .join("\n");
  return key(before) !== key(after);
}

/** A work-order line drafted from an estimate item, defaulting to what's left of it (or the whole item when none is left). */
export function lineFromItem(item: WorkOrderItem, otherLines: VisitLine[]): VisitLine {
  const remaining = remainingFor(item, otherLines);
  const desc = [item.finish_tag, item.description].filter(Boolean).join(" ").trim();
  return {
    estimate_line_id: item.estimate_line_id,
    finish_id: item.finish_id,
    description: desc || "Work",
    quantity: remaining > 0 ? remaining : num(item.quantity),
    uom: item.uom || "EA",
    cost_code: item.cost_code,
  };
}
