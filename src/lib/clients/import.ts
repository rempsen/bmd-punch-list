// Turns a QuickBooks customer export (rows from CSV / Excel) into BMD clients.
// QuickBooks lists jobs as "Client:Job" (or "Client:Sub:Job"); those are grouped
// under the parent and never imported as clients themselves.

export type ParsedClient = {
  name: string;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  contactName: string | null;
};
export type ParsedJob = { parent: string; path: string[]; name: string };
export type ExistingClient = { id: string; name: string; qbo_customer_id: string | null };

const NAME_COLS = ["customer full name", "customer", "display name", "customer name", "name", "company", "company name"];
const EMAIL_COLS = ["email", "main email", "e-mail"];
const PHONE_COLS = ["phone numbers", "phone", "main phone", "mobile"];
const ADDRESS_COLS = ["billing address", "bill to", "address", "street address"];
const CONTACT_COLS = ["full name", "contact", "primary contact", "contact name"];

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const clean = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : s == null ? "" : String(s).trim());

function pick(row: Record<string, unknown>, cols: string[]): string | null {
  for (const want of cols) {
    for (const [k, v] of Object.entries(row)) {
      if (key(k) === want) {
        const val = clean(v);
        if (val) return val;
      }
    }
  }
  return null;
}

function findNameColumn(rows: Record<string, unknown>[]): string | null {
  const headers = new Set(rows.flatMap((r) => Object.keys(r).map(key)));
  return NAME_COLS.find((c) => headers.has(c)) ?? null;
}

export function parseQboCustomers(rows: Record<string, unknown>[]): { parents: ParsedClient[]; jobs: ParsedJob[] } {
  const nameCol = rows.length ? findNameColumn(rows) : null;
  if (rows.length && !nameCol) {
    throw new Error("Could not find a customer name column (expected one of: Customer, Customer full name, Display name, Name).");
  }
  const parents = new Map<string, ParsedClient>();
  const jobs: ParsedJob[] = [];
  const ensure = (name: string): ParsedClient => {
    const k = key(name);
    let p = parents.get(k);
    if (!p) {
      p = { name, email: null, phone: null, billingAddress: null, contactName: null };
      parents.set(k, p);
    }
    return p;
  };

  for (const row of rows) {
    const full = pick(row, [nameCol!]);
    if (!full || /^total\b/i.test(full)) continue;
    const parts = full.split(":").map((s) => clean(s)).filter(Boolean);
    if (parts.length === 0) continue;
    const parent = ensure(parts[0]!);
    if (parts.length > 1) {
      jobs.push({ parent: parent.name, path: parts.slice(1), name: parts[parts.length - 1]! });
      continue;
    }
    parent.email ??= pick(row, EMAIL_COLS);
    parent.phone ??= pick(row, PHONE_COLS);
    parent.billingAddress ??= pick(row, ADDRESS_COLS);
    parent.contactName ??= pick(row, CONTACT_COLS);
  }
  return { parents: [...parents.values()], jobs };
}

/** Works out what an import would add. Never proposes deletions. */
export function planClientImport(parsed: ParsedClient[], existing: ExistingClient[]): { inserts: ParsedClient[]; unchanged: number } {
  const have = new Set(existing.map((c) => key(c.name)));
  const inserts = parsed.filter((p) => !have.has(key(p.name)));
  return { inserts, unchanged: parsed.length - inserts.length };
}
