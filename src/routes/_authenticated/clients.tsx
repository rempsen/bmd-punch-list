import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Building2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  importClients,
  saveClient,
  useClientContacts,
  useClients,
  useRefreshClients,
  type Client,
  type ClientInput,
} from "@/lib/clients/data";
import { parseQboCustomers, planClientImport, type ParsedClient } from "@/lib/clients/import";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — BMD Projects" }] }),
  component: ClientsPage,
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

function ClientsPage() {
  const { can } = useAuth();
  const canSee = can("view_pipeline");
  const canEdit = can("manage_projects");
  const { data: clients = [], isLoading, error } = useClients();
  const refresh = useRefreshClients();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? clients.filter((c) => `${c.name} ${c.email ?? ""} ${c.billing_address ?? ""}`.toLowerCase().includes(s)) : clients;
  }, [clients, q]);

  if (!canSee) {
    return <p className="p-6 text-sm text-muted-foreground">You don't have access to clients.</p>;
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} ${clients.length === 1 ? "client" : "clients"}`}
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Import from QuickBooks
              </Button>
              <Button onClick={() => setEditing("new")}>
                <Plus className="mr-2 h-4 w-4" /> New client
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="h-11 max-w-md" />
        {error && <p className="text-sm text-destructive">Could not load clients: {errText(error)}</p>}
        {!isLoading && !error && clients.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No clients yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Export your customer list from QuickBooks (Sales → Customers → Export to Excel) and import it here, or add a client by hand.
            </p>
          </div>
        )}
        {shown.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {clients.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">No clients match "{q}".</p>}
      </div>

      {editing && (
        <ClientDialog
          client={editing === "new" ? null : editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
      {importOpen && (
        <ImportDialog
          existing={clients}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            refresh();
            setImportOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ClientDialog({
  client,
  canEdit,
  onClose,
  onSaved,
}: {
  client: Client | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ClientInput>({
    name: client?.name ?? "",
    billing_address: client?.billing_address ?? "",
    phone: client?.phone ?? "",
    email: client?.email ?? "",
    notes: client?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const { data: contacts = [] } = useClientContacts(client?.id ?? null);
  const set = (k: keyof ClientInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await saveClient(client?.id ?? null, {
        name: form.name,
        billing_address: form.billing_address?.trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        notes: form.notes?.trim() || null,
      });
      toast.success(client ? "Client saved" : "Client added");
      onSaved();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? client.name : "New client"}</DialogTitle>
          <DialogDescription>Company details used on projects and quotes.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Client name" id="c-name">
            <Input id="c-name" value={form.name} onChange={set("name")} disabled={!canEdit} autoFocus={!client} />
          </Field>
          <Field label="Billing address" id="c-addr">
            <Textarea id="c-addr" value={form.billing_address ?? ""} onChange={set("billing_address")} disabled={!canEdit} rows={2} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" id="c-email">
              <Input id="c-email" type="email" value={form.email ?? ""} onChange={set("email")} disabled={!canEdit} />
            </Field>
            <Field label="Phone" id="c-phone">
              <Input id="c-phone" value={form.phone ?? ""} onChange={set("phone")} disabled={!canEdit} />
            </Field>
          </div>
          <Field label="Notes" id="c-notes">
            <Textarea id="c-notes" value={form.notes ?? ""} onChange={set("notes")} disabled={!canEdit} rows={2} />
          </Field>
          {contacts.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">Contacts</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {contacts.map((p) => (
                  <li key={p.id}>
                    {[p.name, p.title, p.email, p.phone_mobile ?? p.phone_office].filter(Boolean).join(" · ")}
                    {p.is_primary ? " (primary)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button onClick={() => void save()} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ existing, onClose, onDone }: { existing: Client[]; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ parents: ParsedClient[]; jobs: number; fileName: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (file: File) => {
    setProblem(null);
    setParsed(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("The file has no sheets.");
      // QuickBooks exports often start with title rows; find the header row by its customer-name column.
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const headerAt = grid.findIndex((r) =>
        r.some((c) => /^(customer( full name| name)?|display name|name|company( name)?)$/i.test(String(c).trim())),
      );
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", range: Math.max(headerAt, 0) });
      const out = parseQboCustomers(rows);
      if (out.parents.length === 0) throw new Error("No customers were found in that file.");
      setParsed({ parents: out.parents, jobs: out.jobs.length, fileName: file.name });
    } catch (e) {
      setProblem(errText(e));
    }
  };

  const plan = parsed ? planClientImport(parsed.parents, existing) : null;

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const res = await importClients(parsed.parents);
      toast.success(`${res.added} added, ${res.unchanged} already here`);
      onDone();
    } catch (e) {
      toast.error(`Import failed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import clients from QuickBooks</DialogTitle>
          <DialogDescription>
            Choose the customer list exported from QuickBooks (Excel or CSV). Jobs filed under a client are grouped under that client.
            Existing clients are never changed or removed.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = "";
          }}
        />
        <Button variant="outline" className="h-12" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> {parsed ? "Choose a different file" : "Choose file"}
        </Button>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {parsed && plan && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{parsed.fileName}</p>
            <ul className="mt-2 space-y-1">
              <li>{parsed.parents.length} clients found</li>
              <li>{parsed.jobs} jobs grouped under their client (not imported as clients)</li>
              <li className="font-medium">
                {plan.inserts.length} new · {plan.unchanged} already here
              </li>
            </ul>
            {plan.inserts.length > 0 && (
              <p className="mt-2 truncate text-muted-foreground">
                New: {plan.inserts.slice(0, 6).map((c) => c.name).join(", ")}
                {plan.inserts.length > 6 ? ` and ${plan.inserts.length - 6} more` : ""}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={!plan || plan.inserts.length === 0 || busy}>
            {busy ? "Importing…" : plan && plan.inserts.length > 0 ? `Add ${plan.inserts.length} clients` : "Nothing to add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
