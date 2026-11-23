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

// ── Choosing what to bring in ───────────────────────────────────────────────────────────────────────────────────
/** One row of the dry run: ticked or not, and why it starts that way. */
export type ImportPick = { on: boolean; why: string | null };
export const actionKey = (a: { kind: string; external_id: string }) => `${a.kind}|${a.external_id}`;

const TAX_LINE = /^(sales\s+)?(tax|gst|pst|hst|rst)(\s+.*)?$/i;
const BILLING_LINE = /\s-\s*supply$/i;                          // "Tile - Supply": an invoice line, not a product
const CHARGE_LINE = /\b(change order|extra to contract|sales|pay|freight|surcharge|holdback|credit|installation|deposit|discount)\b/i;   // charges, not things to install
const CHARGE_CATEGORY = new Set(["fees", "services", "samples"]);
const JOB_LINE = /\b(suite|unit|lot|phase)\s*#?\s*\d/i;          // "… Gimli A Suite 2 Window Coverings": one job's line

/**
 * Where each row of the dry run starts. Linking to what BMD already has is always ticked: it adds nothing.
 * New records start ticked only when they look like catalogue material: a supplier BMD has bought materials from,
 * or one a product names as its vendor; a product that is not a tax, billing, charge or one-job line. Everything stays
 * held, so anything left unticked can be brought in later.
 */
export function suggestPicks(plan: Action[], staged: StagedRow[]): Map<string, ImportPick> {
  const byKey = new Map(staged.map((r) => [`${r.kind}|${r.external_id}`, r]));
  const named = new Set(staged.filter((r) => r.kind === "material" || r.kind === "labour").map((r) => text(r.data["vendor_id"])).filter((v): v is string => !!v));
  const picks = new Map<string, ImportPick>();
  for (const a of plan) {
    if (a.op !== "create" && a.op !== "link") continue;
    const k = actionKey(a);
    if (a.op === "link" || a.kind === "cost_code" || a.kind === "other") {
      picks.set(k, { on: true, why: null });
      continue;
    }
    const d = byKey.get(k)?.data ?? {};
    if (d["active"] === false) {
      picks.set(k, { on: false, why: "inactive in QuickBooks" });
      continue;
    }
    if (a.kind === "supplier") {
      const p = d["purchases"] as { material_lines?: number; other_lines?: number } | undefined;
      if (named.has(a.external_id)) picks.set(k, { on: true, why: "a product names it as its vendor" });
      else if (!p) picks.set(k, { on: false, why: "no purchase history read yet" });
      else if ((p.material_lines ?? 0) > 0) picks.set(k, { on: true, why: `${p.material_lines} material purchase line${p.material_lines === 1 ? "" : "s"}` });
      else picks.set(k, { on: false, why: (p.other_lines ?? 0) > 0 ? "bought from, but never materials" : "never bought from in 3 years" });
    } else if (TAX_LINE.test(a.name.trim())) picks.set(k, { on: false, why: "a tax line" });
    else if (BILLING_LINE.test(a.name)) picks.set(k, { on: false, why: "looks like a billing line" });
    else if (CHARGE_LINE.test(a.name) || CHARGE_CATEGORY.has(key(d["category"]))) picks.set(k, { on: false, why: "looks like a charge, not a product" });
    else if (JOB_LINE.test(a.name)) picks.set(k, { on: false, why: "looks like one job's line" });
    else picks.set(k, { on: true, why: null });
  }
  return picks;
}

/**
 * The steps to send for what is ticked. A ticked product's supplier comes along even if it was unticked,
 * so the product arrives with its supplier. Returns the steps and the suppliers added that way.
 */
export function chosenActions(plan: Action[], on: (key: string) => boolean): { actions: Action[]; addedSuppliers: string[] } {
  const chosen = plan.filter((a) => (a.op === "create" || a.op === "link") && on(actionKey(a)));
  const need = new Set(chosen.map((a) => text(a.fields["supplier_external_id"])).filter((v): v is string => !!v));
  const have = new Set(chosen.filter((a) => a.kind === "supplier").map((a) => a.external_id));
  const extra = plan.filter((a) => a.kind === "supplier" && a.op === "create" && need.has(a.external_id) && !have.has(a.external_id));
  return { actions: [...extra, ...chosen], addedSuppliers: extra.map((a) => a.name) };
}
