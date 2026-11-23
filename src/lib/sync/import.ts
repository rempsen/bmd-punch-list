/**
 * The first load from QuickBooks, worked out before anything is written.
 * BMD Projects is the receiver: what it does not have is created, what it already has is linked, and where BMD already
 * holds a value that value stays (see decideInbound). Nothing here touches the database; the plan is shown as a dry run
 * and only then applied.
 */
import { guessCategory } from "@/lib/estimating/lines";
import { decideInbound } from "./logic";

export type StagedRow = { entity: string; external_id: string; kind: string; name: string; data: Record<string, unknown> };
export type Existing = {
  materials: { id: string; name: string; sku: string | null; unit_cost_cents: number | null; active: boolean }[];
  labour: { id: string; name: string; unit_cost_cents: number | null; active: boolean }[];
  suppliers: { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; account_number: string | null; active: boolean }[];
  costCodes: { code: string; name: string; qbo_item_id: string | null }[];
  links: { kind: string; bmd_id: string; external_id: string }[];
};
export type ImportKind = "supplier" | "material" | "labour" | "cost_code";
export type Action = {
  /** create: new in BMD. link: matched to a BMD record, blanks filled. linked: already linked, nothing to do. skip: left in QuickBooks. */
  op: "create" | "link" | "linked" | "skip";
  kind: ImportKind | "other";
  external_id: string;
  name: string;
  bmd_id: string | null;
  fields: Record<string, unknown>;
  /** Fields where BMD and QuickBooks differ and BMD's value stays. */
  kept?: string[];
};

const key = (s: unknown) => String(s ?? "").trim().toLowerCase();
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const cents = (v: unknown) => (typeof v === "number" && v > 0 ? Math.round(v) : null);

/** Fills what BMD is missing from QuickBooks and notes where BMD's own value stays. */
function fill<T extends Record<string, unknown>>(bmd: T, incoming: Record<string, unknown>): { fields: Record<string, unknown>; kept: string[] } {
  const fields: Record<string, unknown> = {};
  const kept: string[] = [];
  for (const [f, v] of Object.entries(incoming)) {
    const d = decideInbound({ bmd: (bmd[f] ?? null) as unknown, lastSynced: undefined, incoming: v ?? null });
    if (d === "apply") fields[f] = v;
    else if (d === "bmd_wins" && v != null) kept.push(f);
  }
  return { fields, kept };
}
const linkAction = (kind: ImportKind, r: StagedRow, name: string, bmd_id: string, f: { fields: Record<string, unknown>; kept: string[] }): Action => ({ op: "link", kind, external_id: r.external_id, name, bmd_id, fields: f.fields, ...(f.kept.length ? { kept: f.kept } : {}) });

export function planImport(staged: StagedRow[], existing: Existing): Action[] {
  const linked = new Map(existing.links.map((l) => [`${l.kind}|${l.external_id}`, l.bmd_id]));
  const taken = new Set(existing.links.map((l) => `${l.kind}|${l.bmd_id}`));   // a BMD record is matched to one QuickBooks record only
  const free = <T extends { id: string }>(kind: string, rows: T[], test: (x: T) => boolean) => rows.find((x) => !taken.has(`${kind}|${x.id}`) && test(x));
  const out: Action[] = [];

  // Vendors first, so a product's preferred vendor is there to point at.
  const ordered = [...staged.filter((r) => r.kind === "supplier"), ...staged.filter((r) => r.kind !== "supplier")];
  for (const r of ordered) {
    const kind = r.kind as ImportKind;
    if (r.kind !== "supplier" && r.kind !== "material" && r.kind !== "labour" && r.kind !== "cost_code") {
      out.push({ op: "skip", kind: "other", external_id: r.external_id, name: r.name, bmd_id: null, fields: {} });
      continue;
    }
    const already = linked.get(`${kind}|${r.external_id}`);
    if (already) {
      out.push({ op: "linked", kind, external_id: r.external_id, name: r.name, bmd_id: already, fields: {} });
      continue;
    }
    const d = r.data;
    if (kind === "supplier") {
      const incoming = { contact_name: text(d["contact_name"]), email: text(d["email"]), phone: text(d["phone"]), account_number: text(d["account_number"]) };
      const m = free("supplier", existing.suppliers, (s) => key(s.name) === key(r.name));
      if (m) {
        taken.add(`supplier|${m.id}`);
        out.push(linkAction(kind, r, m.name, m.id, fill(m, incoming)));
      } else out.push({ op: "create", kind, external_id: r.external_id, name: r.name, bmd_id: null, fields: { name: r.name, ...incoming, active: d["active"] !== false } });
    } else if (kind === "material") {
      const sku = text(d["sku"]);
      const m = (sku ? free("material", existing.materials, (x) => key(x.sku) === key(sku)) : undefined) ?? free("material", existing.materials, (x) => key(x.name) === key(r.name));
      if (m) {
        taken.add(`material|${m.id}`);
        out.push(linkAction(kind, r, m.name, m.id, fill(m, { unit_cost_cents: cents(d["cost_cents"]), sku })));
      } else out.push({ op: "create", kind, external_id: r.external_id, name: r.name, bmd_id: null, fields: { name: r.name, sku, unit_cost_cents: cents(d["cost_cents"]), supplier_external_id: text(d["vendor_id"]), category: guessCategory(r.name), active: d["active"] !== false } });
    } else if (kind === "labour") {
      const m = free("labour", existing.labour, (x) => key(x.name) === key(r.name));
      if (m) {
        taken.add(`labour|${m.id}`);
        out.push(linkAction(kind, r, m.name, m.id, fill(m, { unit_cost_cents: cents(d["cost_cents"]) })));
      } else out.push({ op: "create", kind, external_id: r.external_id, name: r.name, bmd_id: null, fields: { name: r.name, unit_cost_cents: cents(d["cost_cents"]), active: d["active"] !== false } });
    } else {
      const code = text(d["code"]) ?? "";
      const label = r.name.replace(/^\S+\s+-\s+/, "").trim() || r.name;
      const m = existing.costCodes.find((c) => c.code === code);
      if (m) out.push({ op: "link", kind, external_id: r.external_id, name: m.name, bmd_id: m.code, fields: { qbo_item_id: r.external_id } });
      else out.push({ op: "create", kind, external_id: r.external_id, name: label, bmd_id: code, fields: { code, name: label, qbo_item_id: r.external_id } });
    }
  }
  return out;
}

export type PlanSummary = { byKind: Record<ImportKind, { create: number; link: number; linked: number }>; skipped: number; unknownCosts: number; kept: number; duplicates: string[][]; writes: number };

/** A base name for spotting likely duplicates: "4in Standard Rubber Base - Black D40-4-R" and "4in Standard Rubber Base" are the same thing to a person. */
const stem = (name: string) => key(name).split(/\s+-\s+/)[0]!.replace(/[^a-z0-9]+/g, " ").trim();

export function planSummary(plan: Action[]): PlanSummary {
  const byKind = { supplier: { create: 0, link: 0, linked: 0 }, material: { create: 0, link: 0, linked: 0 }, labour: { create: 0, link: 0, linked: 0 }, cost_code: { create: 0, link: 0, linked: 0 } };
  let skipped = 0, unknownCosts = 0, kept = 0;
  const groups = new Map<string, string[]>();
  for (const a of plan) {
    if (a.op === "skip" || a.kind === "other") {
      skipped++;
      continue;
    }
    byKind[a.kind][a.op]++;
    kept += a.kept?.length ?? 0;
    if (a.op === "create" && (a.kind === "material" || a.kind === "labour")) {
      if (a.fields["unit_cost_cents"] == null) unknownCosts++;
      const s = stem(a.name);
      if (s.length >= 6) groups.set(`${a.kind}|${s}`, [...(groups.get(`${a.kind}|${s}`) ?? []), a.name]);
    }
  }
  return { byKind, skipped, unknownCosts, kept, duplicates: [...groups.values()].filter((g) => g.length > 1), writes: plan.filter((a) => a.op === "create" || a.op === "link").length };
}
