import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import type { ContactKind } from "./contacts";
import type { OpenJob } from "./joblist";
import type { JobRole, LostReason, ProjectKind, ProjectStage } from "./stages";
import type { JobTemplate, TemplateInput } from "./templates";

export type PipelineProject = {
  id: string;
  name: string;
  project_number: string | null;
  client_id: string | null;
  client_name: string | null;
  address: string | null;
  stage: ProjectStage;
  stage_entered_at: string;
  bid_due_date: string | null;
  estimated_value_cents: number | null;
  lost_reason: LostReason | null;
  lost_note: string | null;
  job_type: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  members: { user_id: string; job_roles: JobRole[] }[];
  floorCount: number;
  onedrive_folder_id: string | null;
  onedrive_parent_path: string | null;
  /** A client job, or an internal one for BMD's own time. */
  kind: ProjectKind;
  /** The tasks every visit to this job normally includes. */
  standard_tasks: string[];
};

export type Staff = { id: string; full_name: string | null; email: string | null };

const BASE_COLS =
  "id,name,project_number,client_id,client_name,address,stage,stage_entered_at,bid_due_date,estimated_value_cents,lost_reason,lost_note,job_type,notes,archived_at,created_at,onedrive_folder_id,onedrive_parent_path,project_members(user_id,job_roles),floors(count)";
const COLS = `${BASE_COLS},kind,standard_tasks`;
/** Until migration 0082 is applied the two new columns do not exist; the lists then load as before, every job a client job. */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703";

type Raw = Omit<PipelineProject, "members" | "floorCount" | "kind" | "standard_tasks"> & {
  kind?: ProjectKind | null;
  standard_tasks?: string[] | null;
  project_members: PipelineProject["members"] | null;
  floors: { count: number }[] | null;
};

const shape = (r: Raw): PipelineProject => {
  const { project_members, floors, ...rest } = r;
  return { ...rest, kind: rest.kind ?? "client", standard_tasks: rest.standard_tasks ?? [], members: project_members ?? [], floorCount: floors?.[0]?.count ?? 0 };
};

export function usePipelineProjects() {
  return useQuery({
    queryKey: ["pipeline-projects"],
    queryFn: async () => {
      const load = (cols: string) => db.from("projects").select(cols).is("archived_at", null).order("created_at", { ascending: false });
      let { data, error } = await load(COLS);
      if (missingColumn(error)) ({ data, error } = await load(BASE_COLS));
      if (error) throw error;
      return ((data ?? []) as unknown as Raw[]).map(shape);
    },
  });
}

export function usePipelineProject(id: string | null) {
  return useQuery({
    queryKey: ["pipeline-project", id],
    enabled: !!id,
    queryFn: async () => {
      const load = (cols: string) => db.from("projects").select(cols).eq("id", id!).maybeSingle();
      let { data, error } = await load(COLS);
      if (missingColumn(error)) ({ data, error } = await load(BASE_COLS));
      if (error) throw error;
      return data ? shape(data as unknown as Raw) : null;
    },
  });
}

export function useBmdStaff(enabled = true) {
  return useQuery({
    queryKey: ["bmd-staff"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("bmd_staff");
      if (error) throw error;
      return (data ?? []) as Staff[];
    },
  });
}

export function useRefreshPipeline() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["pipeline-projects"] });
    void qc.invalidateQueries({ queryKey: ["pipeline-project"] });
  };
}

export type NewProjectInput = {
  name: string;
  client_id: string;
  street: string;
  city: string;
  province: string;
  postal_code: string;
  bid_due_date: string;
  job_type: string;
  notes: string;
  estimator_id: string;
  project_lead_id: string;
  scopes: { scope: string; other_text: string | null }[];
};

export async function createPipelineProject(p: NewProjectInput): Promise<string> {
  const address = [p.street, p.city, p.province, p.postal_code].map((s) => s.trim()).filter(Boolean).join(", ");
  const { data, error } = await db.rpc("create_pipeline_project", { _p: { ...p, address } });
  if (error) throw new Error(error.message);
  return data as string;
}

export type NewJobInput = NewProjectInput & {
  kind: ProjectKind;
  stage: ProjectStage;
  standard_tasks: string[];
  contacts: { kind: ContactKind; name: string; phone: string; email: string }[];
};

/** New job from the form: client or internal, with its starting stage, standard visit tasks and site contacts. */
export async function createJob(p: NewJobInput): Promise<string> {
  const address = [p.street, p.city, p.province, p.postal_code].map((s) => s.trim()).filter(Boolean).join(", ");
  const { data, error } = await db.rpc("create_project_from_form", { _p: { ...p, address } });
  if (error) throw new Error(error.message);
  return data as string;
}

/** The ids of jobs linked to QuickBooks. Empty when nothing is linked, or when the lookup is not there yet. */
export function useQboLinkedJobs(enabled = true) {
  return useQuery({
    queryKey: ["qbo-linked-jobs"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("project_qbo_links");
      if (error) return new Set<string>();
      return new Set(((data ?? []) as { project_id: string }[]).map((r) => r.project_id));
    },
  });
}

/** The sidebar's open-jobs list: one small query, kept for five minutes, asked for only when the list is opened. */
export function useOpenJobs(enabled: boolean) {
  return useQuery({
    queryKey: ["open-jobs"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const load = (cols: string) => db.from("projects").select(cols).is("archived_at", null).in("stage", ["won", "in_progress"]).order("name");
      let { data, error } = await load("id,name,project_number,stage,kind");
      if (missingColumn(error)) ({ data, error } = await load("id,name,project_number,stage"));
      if (error) throw error;
      return ((data ?? []) as unknown as (Omit<OpenJob, "kind"> & { kind?: ProjectKind })[]).map((r) => ({ ...r, kind: r.kind ?? "client" })) as OpenJob[];
    },
  });
}

export async function saveStandardTasks(id: string, tasks: string[]) {
  const { error } = await db.from("projects").update({ standard_tasks: tasks }).eq("id", id);
  if (error) throw new Error(error.message);
}

export type SiteContact = { id: string; kind: string; name: string | null; company: string | null; title: string | null; email: string | null; phone_mobile: string | null; phone_office: string | null; is_primary: boolean; sort_order: number };

export function useSiteContacts(projectId: string) {
  return useQuery({
    queryKey: ["contacts", projectId],
    queryFn: async () => {
      const { data, error } = await db.from("project_contacts").select("*").eq("project_id", projectId).order("sort_order");
      if (error) throw new Error(error.message);
      return (data ?? []) as SiteContact[];
    },
  });
}

export async function saveSiteContact(projectId: string, id: string | null, c: { kind: ContactKind; name: string; phone: string; email: string }, sortOrder: number) {
  const row = { kind: c.kind, name: c.name.trim() || null, email: c.email.trim() || null, phone_mobile: c.phone.trim() || null };
  const { error } = id
    ? await db.from("project_contacts").update(row).eq("id", id)
    : await db.from("project_contacts").insert({ ...row, project_id: projectId, is_primary: false, sort_order: sortOrder });
  if (error) throw new Error(error.message);
}

export async function removeSiteContact(id: string) {
  const { error } = await db.from("project_contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

const TEMPLATE_COLS = "id,name,kind,default_stage,job_type,scopes,other_scope,contact_roles,visit_tasks,notes";

export function useJobTemplates(enabled = true) {
  return useQuery({
    queryKey: ["job-templates"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("job_templates").select(TEMPLATE_COLS).order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as JobTemplate[];
    },
  });
}

export async function saveJobTemplate(id: string | null, t: TemplateInput) {
  const { error } = id
    ? await db.from("job_templates").update({ ...t, updated_at: new Date().toISOString() }).eq("id", id)
    : await db.from("job_templates").insert(t);
  if (error) throw new Error(error.code === "23505" ? "A template with that name already exists" : error.message);
}

export async function deleteJobTemplate(id: string) {
  const { error } = await db.from("job_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function moveProjectStage(project: string, to: ProjectStage, reason: string | null, note: string | null) {
  const { error } = await db.rpc("move_project_stage", { _project: project, _to_stage: to, _reason: reason, _note: note });
  if (error) throw new Error(error.message);
}

export async function setProjectJobRole(project: string, jobRole: JobRole, user: string | null) {
  const { error } = await db.rpc("set_project_job_role", { _project: project, _job_role: jobRole, _user: user });
  if (error) throw new Error(error.message);
}

export const staffName = (staff: Staff[], id: string | undefined) => {
  const s = staff.find((x) => x.id === id);
  return s ? s.full_name || s.email || "Unknown" : null;
};

export const holderOf = (p: PipelineProject, role: JobRole) => p.members.find((m) => m.job_roles.includes(role))?.user_id;

export type StageEvent = {
  id: string;
  from_stage: ProjectStage | null;
  to_stage: ProjectStage;
  changed_by: string | null;
  changed_at: string;
  note: string | null;
};

export function useStageEvents(projectId: string | null) {
  return useQuery({
    queryKey: ["pipeline-project", projectId, "events"],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db
        .from("project_stage_events")
        .select("id,from_stage,to_stage,changed_by,changed_at,note")
        .eq("project_id", projectId!)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StageEvent[];
    },
  });
}

export type ProjectDetailsInput = {
  name: string;
  bid_due_date: string | null;
  job_type: string | null;
  estimated_value_cents: number | null;
  notes: string | null;
};

export async function saveProjectDetails(id: string, input: ProjectDetailsInput) {
  if (!input.name.trim()) throw new Error("Project name is required");
  const { error } = await db.from("projects").update({ ...input, name: input.name.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export const money = (cents: number | null) =>
  cents == null ? "—" : (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

export const shortDate = (d: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—";

export const initials = (name: string | null) =>
  (name ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
