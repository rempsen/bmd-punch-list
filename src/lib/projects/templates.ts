// Job templates: a named starting point for the new-job form. A template never carries estimates, prices or documents.
import { isContactKind, type ContactKind } from "./contacts";
import type { ProjectKind, ProjectStage } from "./stages";

export type TemplateInput = {
  name: string;
  kind: ProjectKind;
  default_stage: ProjectStage;
  job_type: string | null;
  scopes: string[];
  other_scope: string | null;
  contact_roles: ContactKind[];
  visit_tasks: string[];
  notes: string | null;
};
export type JobTemplate = TemplateInput & { id: string };

export const blankTemplate = (): TemplateInput => ({
  name: "", kind: "client", default_stage: "opportunity", job_type: null, scopes: [], other_scope: null, contact_roles: [], visit_tasks: [], notes: null,
});

/** Where a new job may start. An internal job is open work from the first day. */
export const templateStages = (kind: ProjectKind): ProjectStage[] =>
  kind === "internal" ? ["in_progress"] : ["opportunity", "estimating", "quote_out", "won", "in_progress"];

const MAX_TASKS = 50;
const MAX_TASK_LENGTH = 200;
const tidyTasks = (list: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.replace(/^\s*[-•*]\s*/, "").trim().slice(0, MAX_TASK_LENGTH);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === MAX_TASKS) break;
  }
  return out;
};
/** Tasks are typed one per line. */
export const parseTasks = (text: string): string[] => tidyTasks(text.split(/\r?\n/));

export function cleanTemplate(t: TemplateInput): { ok: true; value: TemplateInput } | { ok: false; error: string } {
  const name = t.name.trim();
  if (!name) return { ok: false, error: "Give the template a name" };
  const kind: ProjectKind = t.kind === "internal" ? "internal" : "client";
  const stages = templateStages(kind);
  const scopes = [...new Set(t.scopes)];
  return {
    ok: true,
    value: {
      name,
      kind,
      default_stage: stages.includes(t.default_stage) ? t.default_stage : stages[0]!,
      job_type: t.job_type?.trim() || null,
      scopes,
      other_scope: scopes.includes("other") ? t.other_scope?.trim() || null : null,
      contact_roles: [...new Set(t.contact_roles.filter(isContactKind))],
      visit_tasks: tidyTasks(t.visit_tasks),
      notes: t.notes?.trim() || null,
    },
  };
}

export type FormContact = { kind: ContactKind; name: string; phone: string; email: string };
/** The parts of the new-job form a template can fill. */
export type JobForm = {
  kind: ProjectKind;
  stage: ProjectStage;
  job_type: string;
  scopes: string[];
  other_scope: string;
  notes: string;
  contacts: FormContact[];
  tasks: string[];
};

/** Fills the form from a template. Notes and contacts the person already typed are kept. */
export function applyTemplate<F extends JobForm>(form: F, t: TemplateInput): F {
  const have = new Set(form.contacts.map((c) => c.kind));
  return {
    ...form,
    kind: t.kind,
    stage: t.default_stage,
    job_type: t.job_type ?? "",
    scopes: [...t.scopes],
    other_scope: t.other_scope ?? "",
    notes: form.notes.trim() ? form.notes : (t.notes ?? ""),
    contacts: [...form.contacts, ...t.contact_roles.filter((k) => !have.has(k)).map((kind) => ({ kind, name: "", phone: "", email: "" }))],
    tasks: [...t.visit_tasks],
  };
}

/** "Save this job as a template": the reusable parts of a job, without its people, client or money. */
export function templateFromJob(
  job: { name: string; kind: ProjectKind; stage: ProjectStage; job_type: string | null; notes: string | null; standard_tasks: string[] },
  contacts: { kind: string }[],
  scopes: { scope: string; other_text: string | null }[],
): TemplateInput {
  const r = cleanTemplate({
    name: job.name,
    kind: job.kind,
    default_stage: job.kind === "internal" ? "in_progress" : "opportunity",
    job_type: job.job_type,
    scopes: scopes.map((s) => s.scope),
    other_scope: scopes.find((s) => s.scope === "other")?.other_text ?? null,
    contact_roles: contacts.map((c) => c.kind).filter((k): k is ContactKind => k === "pm" || k === "super"),
    visit_tasks: job.standard_tasks,
    notes: job.notes,
  });
  return r.ok ? r.value : { ...blankTemplate(), name: job.name };
}
