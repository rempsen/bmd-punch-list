import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roles";
import type { AdminUser } from "@/lib/users/logic";

export type JobOption = { id: string; name: string; archived_at: string | null };
export type UserJob = { project_id: string; name: string; archived_at: string | null; role: AppRole; source: "level" | "job" | "all_jobs" };

/** Everyone with an account, plus invites to people who have not signed up yet. */
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users", "company"],
    queryFn: async () => {
      await supabase.rpc("expire_old_invites");
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AdminUser[];
    },
  });
}

/** Jobs this admin can see, open first. */
export function useJobOptions() {
  return useQuery({
    queryKey: ["admin-job-options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id,name,archived_at").order("archived_at", { nullsFirst: true }).order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as JobOption[];
    },
  });
}

export function useUserJobs(userId: string | null) {
  return useQuery({
    queryKey: ["admin-user-jobs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_user_jobs", { _user: userId! });
      if (error) throw new Error(error.message);
      return (data ?? []) as UserJob[];
    },
  });
}

export type LogRow = { at: string; actor_name: string; action: string; detail: Record<string, unknown> };
export function useUserLog(userId: string | null) {
  return useQuery({
    queryKey: ["admin-user-log", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_user_log", { _user: userId! });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LogRow[];
    },
  });
}

export function useRefreshUsers() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["admin-users", "admin-user-jobs", "admin-user-log", "invites", "profiles"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
