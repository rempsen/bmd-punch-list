import { EXTERNAL_SOURCE } from "./core";

/**
 * Which BMD job a work order scheduled in ArrivePing belongs to. Pure: the caller reads the work order and the open
 * projects, this decides. A work order BMD itself sent is recognised by its external source and left to the visit it
 * already has; anything else is matched by job number, then by the client, and set aside when neither settles it.
 */

/** The parts of an ArrivePing work order the matcher and the importer read. Missing fields are null. */
export type ApWorkOrder = {
  id: string;
  title: string | null;
  reference: string | null;
  externalSource: string | null;
  externalRef: string | null;
  customerId: string | null;
  customerName: string | null;
  startAt: string | null;
  endAt: string | null;
  status: string | null;
  assignedTo: string | null;
  siteContact: string | null;
  notes: string | null;
};

export type OpenProject = { id: string; number: string | null; name: string; client_id: string | null };

export type MatchContext = {
  projects: OpenProject[];
  /** ArrivePing client id → BMD client id, from sync_links. */
  clientLinks: Record<string, string>;
};

export type MatchResult =
  | { kind: "bmd" }
  | { kind: "match"; projectId: string; how: "number" | "client" }
  | { kind: "unmatched"; reason: string };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

const personName = (v: unknown): string | null => {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o["name"]) ?? str(o["full_name"]) ?? str(o["display_name"]);
  }
  return null;
};

/** Reads a work order as ArrivePing returns it (bare, or wrapped in `data` / `work_order`). */
export function readWorkOrder(json: unknown): ApWorkOrder | null {
  let o = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!o) return null;
  for (const key of ["data", "work_order", "workorder"]) {
    const inner = o[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner) && (inner as Record<string, unknown>)["id"] != null) {
      o = inner as Record<string, unknown>;
      break;
    }
  }
  const id = str(o["id"]);
  if (!id) return null;
  const customer = (o["customer"] ?? o["client"]) as Record<string, unknown> | null | undefined;
  const schedule = (o["schedule"] ?? {}) as Record<string, unknown>;
  const techs = Array.isArray(o["assigned_techs"]) ? (o["assigned_techs"] as unknown[]).map(personName).filter((n): n is string => n != null) : null;
  const contact = o["site_contact"];
  const siteContact =
    typeof contact === "string"
      ? str(contact)
      : contact && typeof contact === "object"
        ? [str((contact as Record<string, unknown>)["name"]), str((contact as Record<string, unknown>)["phone"])].filter(Boolean).join(" ") || null
        : null;
  return {
    id,
    title: str(o["title"]),
    reference: str(o["reference"]) ?? str(o["job_number"]),
    externalSource: str(o["external_source"]),
    externalRef: str(o["external_ref"]),
    customerId: str(customer?.["id"]) ?? str(o["customer_id"]) ?? str(o["client_id"]),
    customerName: str(customer?.["name"]) ?? str(o["customer_name"]),
    startAt: str(o["start_at"]) ?? str(schedule["start_at"]),
    endAt: str(o["end_at"]) ?? str(schedule["end_at"]),
    status: str(o["status"])?.toLowerCase() ?? null,
    assignedTo: techs ? (techs.length ? techs.join(", ") : null) : (personName(o["assigned_to"]) ?? personName(o["assigned_tech"])),
    siteContact,
    notes: str(o["notes_for_crew"]) ?? str(o["notes"]),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Matching rules, in order:
 * 1. `external_source` is BMD's → `bmd` (the visit that sent it is the record).
 * 2. Exactly one open project's job number appears in the work order's reference or title → `match` by number.
 * 3. The work order's customer is linked to a BMD client with exactly one open project → `match` by client.
 * 4. Otherwise `unmatched`, with the reason (no number, several candidates, unknown customer).
 */
export function matchWorkOrder(wo: ApWorkOrder, ctx: MatchContext): MatchResult {
  if (wo.externalSource === EXTERNAL_SOURCE) return { kind: "bmd" };
  const haystack = [wo.reference, wo.title].filter((s): s is string => !!s).map(norm);
  if (haystack.length) {
    const byNumber = ctx.projects.filter((p) => p.number && norm(p.number).length >= 3 && haystack.some((h) => h.includes(norm(p.number!))));
    if (byNumber.length === 1) return { kind: "match", projectId: byNumber[0]!.id, how: "number" };
    if (byNumber.length > 1) return { kind: "unmatched", reason: `Job number fits ${byNumber.length} open jobs` };
  }
  if (wo.customerId) {
    const clientId = ctx.clientLinks[wo.customerId];
    if (clientId) {
      const byClient = ctx.projects.filter((p) => p.client_id === clientId);
      if (byClient.length === 1) return { kind: "match", projectId: byClient[0]!.id, how: "client" };
      if (byClient.length > 1) return { kind: "unmatched", reason: `Client has ${byClient.length} open jobs` };
      return { kind: "unmatched", reason: "Client has no open job" };
    }
    return { kind: "unmatched", reason: "Customer is not linked to a BMD client" };
  }
  return { kind: "unmatched", reason: "No job number or customer to go by" };
}

/** ArrivePing statuses as BMD visit statuses; anything unknown schedules. */
export function visitStatusFor(apStatus: string | null): "scheduled" | "en_route" | "arrived" | "completed" | "cancelled" {
  switch (apStatus) {
    case "en_route":
    case "enroute":
      return "en_route";
    case "arrived":
    case "on_site":
    case "started":
    case "in_progress":
      return "arrived";
    case "completed":
    case "complete":
      return "completed";
    case "cancelled":
    case "canceled":
    case "deleted":
      return "cancelled";
    default:
      return "scheduled";
  }
}

/** Reads a page of the work-order list, whatever ArrivePing calls the array and the cursor. */
export function readWorkOrderPage(json: unknown): { items: ApWorkOrder[]; next: string | null } {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const list = Array.isArray(json) ? json : o ? [o["data"], o["items"], o["work_orders"], o["workorders"], o["results"]].find(Array.isArray) : null;
  const items = ((list as unknown[] | undefined) ?? []).map(readWorkOrder).filter((w): w is ApWorkOrder => w != null);
  const meta = (o?.["meta"] ?? o?.["pagination"] ?? o ?? {}) as Record<string, unknown>;
  const next = str(meta["next_cursor"]) ?? str(meta["cursor"]) ?? str(meta["next"]) ?? str(o?.["next_cursor"]);
  return { items, next };
}

/** What a new BMD job made from an ArrivePing work order starts as. The address is the site address when ArrivePing gave one. */
export type JobDraft = { name: string; street: string; city: string; province: string; postal_code: string; notes: string };

export function jobDraftFor(wo: ApWorkOrder, siteAddress: Record<string, unknown> | string | null): JobDraft {
  const name = wo.title ?? [wo.customerName, wo.reference].filter(Boolean).join(" — ") ?? "";
  const a = siteAddress && typeof siteAddress === "object" ? siteAddress : null;
  const field = (k: string) => (a && typeof a[k] === "string" ? (a[k] as string).trim() : "");
  const street = a ? [field("line1"), field("line2")].filter(Boolean).join(", ") : typeof siteAddress === "string" ? siteAddress.trim() : "";
  return {
    name: name || `ArrivePing work order ${wo.id}`,
    street,
    city: field("city"),
    province: field("region") || field("province") || field("state"),
    postal_code: field("postal_code") || field("postcode") || field("zip"),
    notes: [wo.reference ? `ArrivePing reference ${wo.reference}` : null, wo.notes].filter(Boolean).join("\n"),
  };
}
