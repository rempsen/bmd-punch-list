import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Capability } from "@/lib/roles";

export type { AppRole } from "@/lib/roles";

type AuthValue = {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  /** Primary role (first assigned). */
  role: AppRole | null;
  loading: boolean;
  isSuperAdmin: boolean;
  can: (cap: Capability) => boolean;
  refreshPermissions: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

const normalise = (r: string): AppRole => (r === "bmd_admin" ? "super_admin" : (r as AppRole));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [caps, setCaps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setRoles([]);
      setCaps(new Set());
      return;
    }
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const list = ((data ?? []) as { role: string }[]).map((r) => normalise(r.role));
    setRoles(list);
    if (list.length === 0) {
      setCaps(new Set());
      return;
    }
    const { data: perms } = await supabase
      .from("role_permissions")
      .select("capability,allowed,role")
      .in("role", list as never);
    setCaps(new Set((perms ?? []).filter((p) => p.allowed).map((p) => p.capability)));
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
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void load(next?.user.id);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [load]);

  const isSuperAdmin = roles.includes("super_admin");
  const value: AuthValue = {
    user: session?.user ?? null,
    session,
    roles,
    role: roles[0] ?? null,
    loading,
    isSuperAdmin,
    can: (cap) => isSuperAdmin || caps.has(cap),
    refreshPermissions: () => load(session?.user.id),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
