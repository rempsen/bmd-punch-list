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
import { checkFile, formatBytes, guessSection } from "@/lib/documents/logic";
import { uploadDocument } from "@/lib/documents/upload";
import { scopeSummary } from "@/lib/documents/scope-keywords";
import { db, errText } from "@/lib/platform/db";
import { createPipelineProject, useBmdStaff, useRefreshPipeline } from "@/lib/projects/data";
import { JOB_TYPES } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

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
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const addFiles = (list: FileList) => {
    const ok: File[] = [];
    for (const file of Array.from(list)) {
      const problem = checkFile(file);
      if (problem) toast.error(problem);
      else ok.push(file);
    }
    setFiles((cur) => [...cur, ...ok]);
  };
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
      let failed = 0;
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
        try {
          await uploadDocument({ projectId: id, section: guessSection(file.name, file.type), file, onProgress: () => {} }).done;
        } catch {
          failed += 1;
        }
      }
      if (files.length - failed > 0) {
        // Text is read in the background after each upload; give it a moment, then say what scope was found so far.
        setProgress("Scanning for BMD scope…");
        await new Promise((r) => setTimeout(r, 4000));
        const { data: found } = await db.from("document_scope_hits").select("keyword_id,scope_keywords:keyword_id(term)").eq("project_id", id);
        const terms = ((found ?? []) as unknown as { scope_keywords: { term: string } | null }[]).map((h) => h.scope_keywords?.term ?? "").filter(Boolean);
        toast.message(terms.length ? scopeSummary(terms) : "Scanning for BMD scope… hits will show in the Documents tab.");
      }
      if (failed) toast.error(`${failed} ${failed === 1 ? "file" : "files"} did not upload. Add them again from the Documents tab.`);
      toast.success(`${f.name.trim()} created in Opportunity`);
      void navigate({ to: "/projects/$id", params: { id }, search: files.length ? { tab: "documents" } : {} });
    } catch (e) {
      toast.error(`Could not create the project: ${errText(e)}`);
    } finally {
      setBusy(false);
      setProgress(null);
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

        <Section title="Plans and specs">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center text-sm transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <span className="font-medium">Drop files here or tap to choose</span>
            <span className="text-xs text-muted-foreground">Optional. They upload when the project is created; more can be added later.</span>
            <input
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border text-sm">
              {files.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  <Button variant="ghost" size="sm" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Notes">
          <Textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything the estimator should know" />
        </Section>

        <div className="sticky bottom-20 flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 shadow-sm md:bottom-4">
          <Button variant="outline" className="h-12" asChild>
            <Link to="/projects">Cancel</Link>
          </Button>
          <Button className="h-12 px-6" disabled={busy} onClick={() => void save()}>
            {busy ? (progress ?? "Creating…") : "Create project"}
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
