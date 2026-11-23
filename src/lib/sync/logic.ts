/**
 * The rule for a value arriving from another system (Dan, 22 Nov 2026): BMD Projects is the source of truth.
 * Changes made elsewhere come in, but when BMD and the other system disagree, BMD's value stays and is sent back.
 * `lastSynced` is the value both sides agreed on at the last sync; undefined means the record has never been synced.
 */
export function decideInbound<T>(v: { bmd: T | null; lastSynced: T | null | undefined; incoming: T | null }): "apply" | "same" | "bmd_wins" {
  if (v.incoming === v.bmd) return "same";
  if (v.incoming == null) return "bmd_wins";   // an empty value from outside never erases what BMD holds
  if (v.lastSynced === undefined) return v.bmd == null ? "apply" : "bmd_wins";   // first load: BMD receives what it does not have
  return v.bmd === v.lastSynced ? "apply" : "bmd_wins";
}

const LABELS: Record<string, string> = { unit_cost_cents: "Cost", name: "Name", sku: "SKU", active: "Active", supplier_id: "Supplier", uom: "Unit", cost_uom: "Unit", contact_name: "Contact", email: "Email", phone: "Phone", account_number: "Account number", cost_code: "Cost code" };
const show = (field: string, v: unknown) => (v == null || v === "" ? "unknown" : field.endsWith("_cents") ? `$${(Number(v) / 100).toFixed(2)}` : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

/** One line describing a queued change, for the Sync screen. */
export function changeSummary(changes: Record<string, { from: unknown; to: unknown }>): string {
  const parts = Object.entries(changes)
    .filter(([, c]) => (c.from ?? null) !== (c.to ?? null))
    .map(([f, c]) => (c.from == null ? `${LABELS[f] ?? f}: ${show(f, c.to)}` : `${LABELS[f] ?? f}: ${show(f, c.from)} → ${show(f, c.to)}`));
  return parts.length ? parts.join(" · ") : "No field changes";
}
