import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Field, ScopePicker } from "@/components/job/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errText } from "@/lib/platform/db";
import { contactKindLabel, type ContactKind } from "@/lib/projects/contacts";
import { deleteJobTemplate, saveJobTemplate, useJobTemplates } from "@/lib/projects/data";
import { JOB_TYPES, stageLabel, type ProjectKind, type ProjectStage } from "@/lib/projects/stages";
import { blankTemplate, cleanTemplate, parseTasks, templateStages, type JobTemplate, type TemplateInput } from "@/lib/projects/templates";

const ROLES: ContactKind[] = ["pm", "super"];
const selectCls = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

/** Company settings → Job templates: named starting points for the new-job form. */
export function JobTemplatesPanel() {
  const { data: templates = [], isLoading, error } = useJobTemplates();
  const qc = useQueryClient();
  const reload = () => void qc.invalidateQueries({ queryKey: ["job-templates"] });
  const [editing, setEditing] = useState<{ id: string | null; value: TemplateInput; tasksText: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (t: JobTemplate | null) => {
    const { id, ...value } = t ?? { id: null, ...blankTemplate() };
    setEditing({ id, value, tasksText: value.visit_tasks.join("\n") });
  };
  const set = (p: Partial<TemplateInput>) => setEditing((e) => (e ? { ...e, value: { ...e.value, ...p } } : e));

  const save = async () => {
    if (!editing) return;
    const r = cleanTemplate({ ...editing.value, visit_tasks: parseTasks(editing.tasksText) });
    if (!r.ok) return void toast.error(r.error);
    setBusy(true);
    try {
      await saveJobTemplate(editing.id, r.value);
      toast.success(editing.id ? "Template saved" : `${r.value.name} added`);
      setEditing(null);
      reload();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (t: JobTemplate) => {
    if (!confirm(`Delete the template “${t.name}”? Jobs already made from it are not changed.`)) return;
    try {
      await deleteJobTemplate(t.id);
      reload();
    } catch (e) {
      toast.error(`Could not delete: ${errText(e)}`);
    }
  };

  const v = editing?.value;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold">Job templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A template is a starting point for a new job: the kind of job, where it starts, job type, scope, which site contacts to ask for, the standard
            visit tasks and notes. It never carries estimates, prices or documents.
          </p>
        </div>
        <Button className="h-11" onClick={() => open(null)}>
          <Plus className="mr-2 h-4 w-4" /> Add template
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">Could not load templates: {errText(error)}</p>}
      {isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && !error && templates.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No templates yet. Add one for a kind of job you set up often, such as “Hotel room refresh” or “Shop time”.
        </p>
      )}
      <ul className="mt-4 divide-y divide-border">
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-full sm:basis-0">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {[
                  t.kind === "internal" ? "Internal job" : `Client job, starts in ${stageLabel(t.default_stage)}`,
                  t.job_type,
                  t.contact_roles.length ? `asks for ${t.contact_roles.map((k) => contactKindLabel(k).toLowerCase()).join(" and ")}` : null,
                  t.visit_tasks.length ? `${t.visit_tasks.length} visit ${t.visit_tasks.length === 1 ? "task" : "tasks"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button asChild variant="outline" className="h-11">
              <Link to="/projects/new" search={{ template: t.id }}>
                New job from this
              </Link>
            </Button>
            <Button variant="ghost" className="h-11" aria-label={`Edit ${t.name}`} onClick={() => open(t)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
            <Button variant="ghost" className="h-11 text-destructive" aria-label={`Delete ${t.name}`} onClick={() => void remove(t)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>

      {editing && v && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing.id ? "Edit template" : "Add template"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Field label="Template name" required>
                <Input className="h-11" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Hotel room refresh" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kind of job">
                  <select
                    aria-label="Kind of job"
                    className={selectCls}
                    value={v.kind}
                    onChange={(e) => {
                      const kind = e.target.value as ProjectKind;
                      set({ kind, default_stage: templateStages(kind)[0]! });
                    }}
                  >
                    <option value="client">Client job</option>
                    <option value="internal">Internal job (BMD's own time)</option>
                  </select>
                </Field>
                <Field label="Starts in">
                  <select aria-label="Starts in" className={selectCls} value={v.default_stage} disabled={v.kind === "internal"} onChange={(e) => set({ default_stage: e.target.value as ProjectStage })}>
                    {templateStages(v.kind).map((s) => (
                      <option key={s} value={s}>
                        {stageLabel(s)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Job type">
                  <select aria-label="Job type" className={selectCls} value={v.job_type ?? ""} onChange={(e) => set({ job_type: e.target.value || null })}>
                    <option value="">Not set</option>
                    {JOB_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Site contacts to ask for</legend>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((k) => (
                    <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={v.contact_roles.includes(k)}
                        onChange={(e) => set({ contact_roles: e.target.checked ? [...v.contact_roles, k] : v.contact_roles.filter((x) => x !== k) })}
                      />
                      {contactKindLabel(k)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {v.kind === "client" && (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">Approximate scope</legend>
                  <ScopePicker value={v.scopes} other={v.other_scope ?? ""} onChange={(scopes) => set({ scopes })} onOther={(other_scope) => set({ other_scope })} />
                </fieldset>
              )}
              <Field label="Standard visit tasks (one per line)">
                <Textarea rows={4} value={editing.tasksText} onChange={(e) => setEditing({ ...editing, tasksText: e.target.value })} placeholder={"Check moisture readings\nPhotos before starting"} />
              </Field>
              <Field label="Default notes">
                <Textarea rows={3} value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" className="h-11" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button className="h-11" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
