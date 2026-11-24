import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/job/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, errText } from "@/lib/platform/db";
import { CONTACT_KINDS, contactKindLabel, isContactKind, orderContacts, telHref, type ContactKind } from "@/lib/projects/contacts";
import { removeSiteContact, saveJobTemplate, saveSiteContact, saveStandardTasks, useSiteContacts, type PipelineProject, type SiteContact } from "@/lib/projects/data";
import { parseTasks, templateFromJob } from "@/lib/projects/templates";

const panel = "rounded-lg border border-border bg-card p-4 md:p-5";
type Draft = { id: string | null; kind: ContactKind; name: string; phone: string; email: string };

/** On the job's Overview: who to call about the job. The project manager and superintendent are listed first. */
export function SiteContactsPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data: contacts = [], isLoading, error } = useSiteContacts(projectId);
  const qc = useQueryClient();
  const reload = () => void qc.invalidateQueries({ queryKey: ["contacts"] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const list = orderContacts(contacts);
  const has = (k: ContactKind) => contacts.some((c) => c.kind === k);

  const edit = (c: SiteContact) =>
    setDraft({ id: c.id, kind: isContactKind(c.kind) ? c.kind : "other", name: c.name ?? "", phone: c.phone_mobile ?? c.phone_office ?? "", email: c.email ?? "" });
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() && !draft.phone.trim() && !draft.email.trim()) return void toast.error("Enter a name, phone or email");
    setBusy(true);
    try {
      await saveSiteContact(projectId, draft.id, draft, Math.max(0, ...contacts.map((c) => c.sort_order)) + 1);
      setDraft(null);
      reload();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: SiteContact) => {
    if (!confirm(`Remove ${c.name || "this contact"} from the job?`)) return;
    try {
      await removeSiteContact(c.id);
      reload();
    } catch (e) {
      toast.error(`Could not remove: ${errText(e)}`);
    }
  };

  return (
    <section className={panel}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Site contacts</h2>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {!has("pm") && (
              <Button variant="outline" size="sm" className="h-11" onClick={() => setDraft({ id: null, kind: "pm", name: "", phone: "", email: "" })}>
                <Plus className="mr-1 h-4 w-4" /> Project manager
              </Button>
            )}
            {!has("super") && (
              <Button variant="outline" size="sm" className="h-11" onClick={() => setDraft({ id: null, kind: "super", name: "", phone: "", email: "" })}>
                <Plus className="mr-1 h-4 w-4" /> Site superintendent
              </Button>
            )}
            {has("pm") && has("super") && (
              <Button variant="outline" size="sm" className="h-11" onClick={() => setDraft({ id: null, kind: "other", name: "", phone: "", email: "" })}>
                <Plus className="mr-1 h-4 w-4" /> Add contact
              </Button>
            )}
          </div>
        )}
      </div>
      {error ? (
        <p className="text-sm text-destructive">Could not load contacts: {errText(error)}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No contacts yet.{canEdit ? " Add the customer's project manager and the site superintendent so the crew knows who to call." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((c) => {
            const phone = c.phone_mobile ?? c.phone_office;
            const tel = telHref(phone);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{contactKindLabel(c.kind)}</p>
                  <p className="font-medium">{c.name || "No name yet"}</p>
                  {(c.title || c.company) && <p className="text-xs text-muted-foreground">{[c.title, c.company].filter(Boolean).join(" · ")}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {phone &&
                    (tel ? (
                      <a href={tel} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
                        <Phone className="h-4 w-4" /> {phone}
                      </a>
                    ) : (
                      <span className="text-sm">{phone}</span>
                    ))}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted">
                      <Mail className="h-4 w-4" /> <span className="max-w-[14rem] truncate">{c.email}</span>
                    </a>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="ghost" size="sm" className="h-11" aria-label={`Edit ${c.name || contactKindLabel(c.kind)}`} onClick={() => edit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-11" aria-label={`Remove ${c.name || contactKindLabel(c.kind)}`} onClick={() => void remove(c)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <Dialog open onOpenChange={(o) => !o && setDraft(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{draft.id ? "Edit contact" : "Add contact"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Field label="Role">
                <select aria-label="Role" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ContactKind })}>
                  {CONTACT_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <Input className="h-11" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Phone">
                <Input className="h-11" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input className="h-11" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" className="h-11" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button className="h-11" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/** On the job's Overview: the tasks every visit should include, and "Save this job as a template". */
export function StandardTasksPanel({ project, canEdit, onChanged }: { project: PipelineProject; canEdit: boolean; onChanged: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: contacts = [] } = useSiteContacts(project.id);
  const { data: scopes = [] } = useQuery({
    queryKey: ["scopes", project.id, "for-template"],
    enabled: canEdit,
    queryFn: async () => {
      const { data } = await db.from("project_scopes").select("scope,other_text").eq("project_id", project.id);
      return (data ?? []) as { scope: string; other_text: string | null }[];
    },
  });

  const save = async () => {
    setBusy(true);
    try {
      await saveStandardTasks(project.id, parseTasks(text ?? ""));
      setText(null);
      onChanged();
    } catch (e) {
      toast.error(`Could not save: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const saveAsTemplate = async () => {
    const name = window.prompt("Name for the template", project.name)?.trim();
    if (!name) return;
    try {
      await saveJobTemplate(null, { ...templateFromJob(project, contacts, scopes), name });
      toast.success(`Template “${name}” saved. Find it in Settings → Job templates.`);
    } catch (e) {
      toast.error(`Could not save the template: ${errText(e)}`);
    }
  };

  return (
    <section className={panel}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Standard visit tasks</h2>
        {canEdit && text === null && (
          <Button variant="outline" size="sm" onClick={() => setText(project.standard_tasks.join("\n"))}>
            Edit
          </Button>
        )}
      </div>
      {text !== null ? (
        <>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="One task per line" aria-label="Standard visit tasks" />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setText(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      ) : project.standard_tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet. List the tasks every visit to this job should include.</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {project.standard_tasks.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {canEdit && (
        <Button variant="ghost" size="sm" className="mt-3 h-11 px-2 text-primary" onClick={() => void saveAsTemplate()}>
          Save this job as a template
        </Button>
      )}
    </section>
  );
}
