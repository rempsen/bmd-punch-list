import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/platform/db";
import { compressImage, PHOTO_BUCKET } from "@/lib/photos";
import { requestMovePatch, shapeMaterialList, toolsToCopy, winnipegDate, type MaterialRaw, type RequestStatus } from "./logic";

export type LogPhoto = { id: string; storage_path: string };
export type DailyLog = {
  id: string;
  project_id: string;
  log_date: string;
  author_id: string;
  author_name: string;
  what_happened: string;
  next_steps: string;
  shared_with_client: boolean;
  weather_status: "pending" | "ok" | "unavailable";
  weather_conditions: string | null;
  temp_now_c: number | null;
  temp_high_c: number | null;
  temp_low_c: number | null;
  weather_place: string | null;
  created_at: string;
  photos: LogPhoto[];
};
export type JobRequest = {
  id: string;
  project_id: string;
  what: string;
  quantity: string | null;
  needed_by: string | null;
  photo_path: string | null;
  status: RequestStatus;
  status_reason: string | null;
  status_by_name: string | null;
  status_at: string | null;
  requested_by: string;
  requested_by_name: string;
  daily_log_id: string | null;
  created_at: string;
};
export type JobTool = { id: string; project_id: string; name: string; checked: boolean; checked_by_name: string | null; sort_order: number };
export type StandardTool = { id: string; name: string; sort_order: number };

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};
const num = (v: unknown) => (v == null ? null : Number(v));

/** Job-site photos sit in the job photo bucket under job-site/<job>/<folder>/. Never in project documents. */
export async function uploadSitePhoto(projectId: string, folder: string, file: File): Promise<string> {
  const blob = await compressImage(file);
  const path = `job-site/${projectId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  return path;
}

// ── Daily logs ──────────────────────────────────────────────────────────────────────────────────────────────
export function useDailyLogs(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["daily-logs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db
        .from("daily_logs")
        .select("id,project_id,log_date,author_id,author_name,what_happened,next_steps,shared_with_client,weather_status,weather_conditions,temp_now_c,temp_high_c,temp_low_c,weather_place,created_at,photos:daily_log_photos(id,storage_path,created_at)")
        .eq("project_id", projectId!)
        .order("log_date", { ascending: false })
        .order("created_at", { ascending: false });
      fail(error);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map(
        (r): DailyLog => ({
          ...r,
          temp_now_c: num(r.temp_now_c),
          temp_high_c: num(r.temp_high_c),
          temp_low_c: num(r.temp_low_c),
          photos: [...((r.photos ?? []) as (LogPhoto & { created_at: string })[])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        }),
      );
    },
  });
}

export type SaveLogInput = { projectId: string; existingId: string | null; whatHappened: string; nextSteps: string; shared?: boolean | undefined; files: File[] };
export type SaveLogResult = { id: string; photosFailed: number };

/** Saves today's log (one per job, per day, per person), then its photos. A photo that fails never loses the words. */
export async function saveDailyLog(input: SaveLogInput): Promise<SaveLogResult> {
  const words = { what_happened: input.whatHappened.trim(), next_steps: input.nextSteps.trim(), ...(input.shared === undefined ? {} : { shared_with_client: input.shared }) };
  let id = input.existingId;
  if (id) {
    fail((await db.from("daily_logs").update(words).eq("id", id)).error);
  } else {
    const today = winnipegDate();
    const created = await db.from("daily_logs").insert({ project_id: input.projectId, log_date: today, ...words }).select("id").single();
    if (created.error && created.error.code === "23505") {
      // Today's log already exists (saved on another phone, say): change that one.
      const { data: me } = await supabase.auth.getUser();
      const mine = await db.from("daily_logs").select("id").eq("project_id", input.projectId).eq("log_date", today).eq("author_id", me.user?.id ?? "").maybeSingle();
      fail(mine.error);
      if (!mine.data) throw new Error("Today's log already exists but could not be opened.");
      id = (mine.data as { id: string }).id;
      fail((await db.from("daily_logs").update(words).eq("id", id)).error);
    } else {
      fail(created.error);
      id = (created.data as { id: string }).id;
    }
  }
  let photosFailed = 0;
  for (const file of input.files) {
    try {
      const path = await uploadSitePhoto(input.projectId, id!, file);
      fail((await db.from("daily_log_photos").insert({ log_id: id, project_id: input.projectId, storage_path: path })).error);
    } catch {
      photosFailed += 1;
    }
  }
  return { id: id!, photosFailed };
}

export async function setLogShared(id: string, shared: boolean) {
  fail((await db.from("daily_logs").update({ shared_with_client: shared }).eq("id", id)).error);
}
export async function removeLogPhoto(photo: LogPhoto) {
  fail((await db.from("daily_log_photos").delete().eq("id", photo.id)).error);
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
}
export async function deleteDailyLog(log: Pick<DailyLog, "id" | "photos">) {
  fail((await db.from("daily_logs").delete().eq("id", log.id)).error);
  if (log.photos.length) await supabase.storage.from(PHOTO_BUCKET).remove(log.photos.map((p) => p.storage_path));
}

// ── Requests ────────────────────────────────────────────────────────────────────────────────────────────────
export function useJobRequests(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["job-requests", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("job_requests").select("*").eq("project_id", projectId!).order("created_at", { ascending: false });
      fail(error);
      return (data ?? []) as JobRequest[];
    },
  });
}
/** Every request still open, on any job this person can see (the database decides which). */
export function useOpenRequests(enabled = true) {
  return useQuery({
    queryKey: ["job-requests", "open"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("job_requests").select("project_id,status,needed_by").in("status", ["open", "ordered", "on_its_way"]);
      fail(error);
      return (data ?? []) as Pick<JobRequest, "project_id" | "status" | "needed_by">[];
    },
  });
}
export async function addRequest(input: { projectId: string; what: string; quantity?: string; neededBy?: string; file?: File | null; dailyLogId?: string | null }) {
  const what = input.what.trim();
  if (!what) throw new Error("Say what is needed.");
  const photo_path = input.file ? await uploadSitePhoto(input.projectId, "requests", input.file) : null;
  fail(
    (
      await db.from("job_requests").insert({
        project_id: input.projectId,
        what: what.slice(0, 300),
        quantity: input.quantity?.trim() || null,
        needed_by: input.neededBy || null,
        photo_path,
        daily_log_id: input.dailyLogId ?? null,
      })
    ).error,
  );
}
export async function moveRequest(row: Pick<JobRequest, "id" | "status">, to: RequestStatus, reason?: string) {
  fail((await db.from("job_requests").update(requestMovePatch(row.status, to, { reason: reason ?? null })).eq("id", row.id)).error);
}
export async function deleteRequest(row: Pick<JobRequest, "id" | "photo_path">) {
  fail((await db.from("job_requests").delete().eq("id", row.id)).error);
  if (row.photo_path) await supabase.storage.from(PHOTO_BUCKET).remove([row.photo_path]);
}

// ── Materials for the crew ──────────────────────────────────────────────────────────────────────────────────
export function useMaterialList(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["job-material-list", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const [list, checks] = await Promise.all([
        db.rpc("job_material_list", { _project: projectId }),
        db.from("job_material_checks").select("item_key,loaded").eq("project_id", projectId!),
      ]);
      fail(list.error);
      fail(checks.error);
      return shapeMaterialList((list.data ?? []) as MaterialRaw[], (checks.data ?? []) as { item_key: string; loaded: boolean }[]);
    },
  });
}
export async function setMaterialLoaded(projectId: string, key: string, loaded: boolean, byName: string | null) {
  if (loaded) fail((await db.from("job_material_checks").upsert({ project_id: projectId, item_key: key, loaded: true, checked_by_name: byName, checked_at: new Date().toISOString() })).error);
  else fail((await db.from("job_material_checks").delete().eq("project_id", projectId).eq("item_key", key)).error);
}

// ── Tools ───────────────────────────────────────────────────────────────────────────────────────────────────
export function useJobTools(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["job-tools", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("job_tools").select("id,project_id,name,checked,checked_by_name,sort_order").eq("project_id", projectId!).order("sort_order").order("created_at");
      fail(error);
      return (data ?? []) as JobTool[];
    },
  });
}
export function useStandardTools(enabled = true) {
  return useQuery({
    queryKey: ["standard-tools"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("standard_tools").select("id,name,sort_order").order("sort_order").order("created_at");
      fail(error);
      return (data ?? []) as StandardTool[];
    },
  });
}
export async function addTool(projectId: string, name: string, existing: JobTool[]) {
  const [row] = toolsToCopy([{ name, sort_order: 0 }], existing);
  if (!row) throw new Error(name.trim() ? "That is already on the list." : "Type the tool or item.");
  fail((await db.from("job_tools").insert({ project_id: projectId, ...row })).error);
}
export async function toggleTool(id: string, checked: boolean, byName: string | null) {
  fail((await db.from("job_tools").update({ checked, checked_by_name: checked ? byName : null, checked_at: checked ? new Date().toISOString() : null }).eq("id", id)).error);
}
export async function removeTool(id: string) {
  fail((await db.from("job_tools").delete().eq("id", id)).error);
}
/** Copies the company's standard tools onto the job, skipping any it already has. Returns how many were added. */
export async function copyStandardTools(projectId: string, existing: JobTool[]): Promise<number> {
  const { data, error } = await db.from("standard_tools").select("name,sort_order").order("sort_order").order("created_at");
  fail(error);
  const rows = toolsToCopy((data ?? []) as { name: string; sort_order: number }[], existing);
  if (rows.length) fail((await db.from("job_tools").insert(rows.map((r) => ({ project_id: projectId, ...r })))).error);
  return rows.length;
}
export async function addStandardTool(name: string, existing: StandardTool[]) {
  const [row] = toolsToCopy([{ name, sort_order: 0 }], existing);
  if (!row) throw new Error(name.trim() ? "That is already on the list." : "Type the tool or item.");
  fail((await db.from("standard_tools").insert(row)).error);
}
export async function removeStandardTool(id: string) {
  fail((await db.from("standard_tools").delete().eq("id", id)).error);
}

// ── Counts for the job Overview ─────────────────────────────────────────────────────────────────────────────
export type SiteCounts = { logs_this_week_job: number; logs_this_week_all: number; open_requests: number };
export function useJobSiteCounts(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["job-site-counts", projectId],
    enabled: !!projectId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.rpc("job_site_counts", { _project: projectId });
      fail(error);
      return ((data ?? [])[0] ?? null) as SiteCounts | null;
    },
  });
}

export function useRefreshSite(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return () => {
    for (const k of ["daily-logs", "job-requests", "job-material-list", "job-tools", "job-site-counts"]) void qc.invalidateQueries({ queryKey: [k, projectId] });
  };
}
