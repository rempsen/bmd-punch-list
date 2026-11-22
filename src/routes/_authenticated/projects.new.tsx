import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Field, ScopePicker } from "@/components/job/fields";
import { SearchSelect } from "@/components/SearchSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { saveClient, useClients, useRefreshClients } from "@/lib/clients/data";
import { errText } from "@/lib/platform/db";
import { createPipelineProject, useBmdStaff, useRefreshPipeline } from "@/lib/projects/data";
import { JOB_TYPES } from "@/lib/projects/stages";

export const Route = createFileRoute("/_authenticated/projects/new")({
  head: () => ({ meta: [{ title: "New project — BMD Projects" }] }),
  component: NewProjectPage,
});

const blank = {
  name: "",
  client_id: "",
  street: "",
  city: "Winnipeg",
  province: "MB",
  postal_code: "",
  bid_due_date: "",
  job_type: "",
  notes: "",
  estimator_id: "",
  project_lead_id: "",
};

function NewProjectPage() {
  const { canAny, refreshPermissions } = useAuth();
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const { data: staff = [] } = useBmdStaff();
  const refreshClients = useRefreshClients();
  const refreshPipeline = useRefreshPipeline();
  const [f, setF] = useState(blank);
  const [scopes, setScopes] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (p: Partial<typeof blank>) => setF((cur) => ({ ...cur, ...p }));

  if (!canAny("manage_projects"))
    return (
      <div>
        <PageHeader title="New project" />
        <p className="p-6 text-sm text-muted-foreground">You don't have access to create projects.</p>
      </div>
    );

  const addClient = async (name: string) => {
    try {
      const id = await saveClient(null, { name, billing_address: null, phone: null, email: null, notes: null });
      refreshClients();
      set({ client_id: id });
      toast.success(`${name} added to clients`);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const save = async () => {
    setTried(true);
    const problem = !f.client_id ? "Choose a client" : !f.name.trim() ? "Enter a project name" : null;
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const id = await createPipelineProject({
        ...f,
        scopes: scopes.map((s) => ({ scope: s, other_text: s === "other" ? other.trim() || null : null })),
      });
      await refreshPermissions();
      refreshPipeline();
      toast.success(`${f.name.trim()} created in Opportunity`);
      void navigate({ to: "/projects/$id", params: { id } });
    } catch (e) {
      toast.error(`Could not create the project: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const staffOptions = staff.map((s) => ({ value: s.id, label: s.full_name || s.email || "Unknown" }));
  const clientOptions = clients.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div>
      <PageHeader title="New project" subtitle="Starts in Opportunity. Floors and rooms are set up later, when the job is won." />
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <Section title="Project">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Client" required>
                <SearchSelect
                  value={f.client_id || null}
                  onChange={(v) => set({ client_id: v })}
                  options={clientOptions}
                  placeholder="Search clients…"
                  invalid={tried && !f.client_id}
                  onCreate={addClient}
                  createLabel="Add client"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Project name" required>
                <Input
                  className="h-11"
                  value={f.name}
                  aria-invalid={tried && !f.name.trim()}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="e.g. Portage Place Tower – Level 4 fit-up"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Site address">
                <Input className="h-11" value={f.street} onChange={(e) => set({ street: e.target.value })} placeholder="Street address" />
              </Field>
            </div>
            <Field label="City">
              <Input className="h-11" value={f.city} onChange={(e) => set({ city: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Province">
                <Input className="h-11" value={f.province} onChange={(e) => set({ province: e.target.value })} />
              </Field>
              <Field label="Postal code">
                <Input className="h-11" value={f.postal_code} onChange={(e) => set({ postal_code: e.target.value })} />
              </Field>
            </div>
            <Field label="Bid due">
              <Input className="h-11" type="date" value={f.bid_due_date} onChange={(e) => set({ bid_due_date: e.target.value })} />
            </Field>
            <Field label="Job type">
              <select
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={f.job_type}
                onChange={(e) => set({ job_type: e.target.value })}
              >
                <option value="">Not set</option>
                {JOB_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Approximate scope">
          <ScopePicker value={scopes} other={other} onChange={setScopes} onOther={setOther} />
        </Section>

        <Section title="BMD team">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estimator">
              <SearchSelect value={f.estimator_id || null} onChange={(v) => set({ estimator_id: v })} options={staffOptions} placeholder="Unassigned" />
            </Field>
            <Field label="Project lead">
              <SearchSelect value={f.project_lead_id || null} onChange={(v) => set({ project_lead_id: v })} options={staffOptions} placeholder="Unassigned" />
            </Field>
          </div>
        </Section>

        <Section title="Notes">
          <Textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything the estimator should know" />
        </Section>

        <div className="sticky bottom-20 flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 shadow-sm md:bottom-4">
          <Button variant="outline" className="h-12" asChild>
            <Link to="/projects">Cancel</Link>
          </Button>
          <Button className="h-12 px-6" disabled={busy} onClick={() => void save()}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
