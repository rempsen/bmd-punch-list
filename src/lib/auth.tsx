import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Capability } from "@/lib/roles";

export type { AppRole } from "@/lib/roles";

export type Job = {
  id: string;
  name: string;
  client_name: string | null;
  address: string | null;
  archived_at: string | null;
  role: AppRole | null;
  open_count: number;
};

type AuthValue = {
  user: User | null;
  session: Session | null;
  /** Role(s) on the current job (plus super_admin when global). */
  roles: AppRole[];
  /** Role on the current job. */
  role: AppRole | null;
  loading: boolean;
  isSuperAdmin: boolean;
  can: (cap: Capability) => boolean;
  /** Super admin, or manage_settings on at least one job. */
  canCreateJobs: boolean;
  refreshPermissions: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Jobs this user can open. */
  jobs: Job[];
  jobsLoaded: boolean;
  projectId: string | null;
  currentJob: Job | null;
  setProjectId: (id: string | null) => void;
};

const AuthContext = createContext<AuthValue | null>(null);
const LS_KEY = "bmd:project";

const normalise = (r: string): AppRole => (r === "bmd_admin" ? "super_admin" : (r as AppRole));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [perms, setPerms] = useState<{ role: string; capability: string; allowed: boolean }[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setIsSuperAdmin(false);
      setPerms([]);
      setJobs([]);
      setJobsLoaded(false);
      return;
    }
    const [{ data: roles }, { data: p }, { data: j }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("role_permissions").select("role,capability,allowed"),
      supabase.rpc("my_projects"),
    ]);
    setIsSuperAdmin(((roles ?? []) as { role: string }[]).some((r) => normalise(r.role) === "super_admin"));
    setPerms((p ?? []) as never);
    const list = ((j ?? []) as Job[]).map((x) => ({ ...x, role: x.role ? normalise(x.role) : null, open_count: Number(x.open_count) }));
    setJobs(list);
    setJobsLoaded(true);
    setProjectIdState((cur) => {
      const stored = cur ?? (typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null);
      if (stored && list.some((x) => x.id === stored)) return stored;
      const active = list.filter((x) => !x.archived_at);
      return active.length === 1 ? active[0]!.id : null;
    });
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await load(data.session?.user.id);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "SIGNED_OUT") {
        setProjectIdState(null);
        localStorage.removeItem(LS_KEY);
      }
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void load(next?.user.id);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id);
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  }, []);

  const currentJob = jobs.find((j) => j.id === projectId) ?? null;
  const role: AppRole | null = currentJob?.role ?? (isSuperAdmin ? "super_admin" : null);
  const caps = useMemo(
    () => new Set(perms.filter((p) => p.allowed && normalise(p.role) === role).map((p) => p.capability)),
    [perms, role],
  );

  const value: AuthValue = {
    user: session?.user ?? null,
    session,
    roles: role ? [role] : [],
    role,
    loading,
    isSuperAdmin,
    can: (cap) => isSuperAdmin || (!!currentJob && caps.has(cap)),
    canCreateJobs:
      isSuperAdmin ||
      jobs.some((j) => perms.some((p) => p.allowed && p.capability === "manage_settings" && normalise(p.role) === j.role)),
    refreshPermissions: () => load(session?.user.id),
    signOut: async () => {
      await supabase.auth.signOut();
    },
    jobs,
    jobsLoaded,
    projectId: currentJob ? projectId : null,
    currentJob,
    setProjectId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Where a user should land inside the current job. */
export function homeFor(role: AppRole | null): string {
  if (role === "trade") return "/my-work";
  if (role === "client") return "/decisions";
  if (role && ["super_admin", "bmd_admin", "bmd_manager", "bmd_field"].includes(role)) return "/capture";
  return "/floors";
}
