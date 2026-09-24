import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ROLES, roleLabel, type AppRole } from "@/lib/roles";

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  role: string | null;
  last_sign_in_at: string | null;
};

function useUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_users");
      if (error) throw new Error(error.message);
      return (data ?? []) as UserRow[];
    },
  });
}

function useInvites() {
  return useQuery({
    queryKey: ["invites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_invites")
        .select("*")
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function UsersPanel() {
  const qc = useQueryClient();
  const { isSuperAdmin, user } = useAuth();
  const { data: users = [] } = useUsers();
  const { data: invites = [] } = useInvites();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("bmd_field");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);

  const selectable = ROLES.filter((r) => isSuperAdmin || r.value !== "super_admin");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["invites"] });
    void qc.invalidateQueries({ queryKey: ["profiles"] });
  };

  const inviteText = (to: string) =>
    `You're invited to the BMD Deficiency Tracker. Sign up at ${window.location.origin}/auth using ${to}.`;

  const invite = async () => {
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("user_invites").insert({
      email: clean,
      full_name: name.trim() || null,
      role,
      company: company.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That email already has an open invite" : error.message);
      return;
    }
    void navigator.clipboard?.writeText(inviteText(clean)).catch(() => undefined);
    toast.success("Invite saved — sign-up message copied to clipboard");
    setEmail("");
    setName("");
    setCompany("");
    refresh();
  };

  const changeRole = async (id: string, next: AppRole, comp?: string) => {
    const { error } = await supabase.rpc("set_user_role", {
      _user_id: id,
      _role: next,
      ...(comp !== undefined ? { _company: comp } : {}),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Access updated");
      refresh();
    }
  };

  const removeInvite = async (id: string) => {
    const { error } = await supabase.from("user_invites").delete().eq("id", id);
    if (error) toast.error(error.message);
    else refresh();
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground uppercase">Invite a user</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Save the invite, then send them the copied sign-up message. When they sign up with this
          email they get the role you choose here.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input className="h-11" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input className="h-11" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger className="h-auto min-h-11 py-2 text-left">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectable.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  <span className="block font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-11"
            placeholder={role === "trade" ? "Company / trade (e.g. ABC Tile – grout)" : "Company (optional)"}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <Button className="mt-3 h-11" disabled={saving} onClick={invite}>
          Save invite &amp; copy message
        </Button>

        {invites.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Pending invites</p>
            <ul className="divide-y divide-border">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.full_name ? `${i.full_name} · ` : ""}
                    {i.email} · {roleLabel(i.role)}
                    {i.company ? ` · ${i.company}` : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(inviteText(i.email));
                      toast.success("Message copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Cancel invite" onClick={() => void removeInvite(i.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">People and access</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="py-2 pr-3">Person</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Company</th>
                <th className="py-2">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const current = (u.role === "bmd_admin" ? "super_admin" : u.role) as AppRole | null;
                const locked = !isSuperAdmin && current === "super_admin";
                return (
                  <tr key={u.id} className="border-b border-border">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{u.full_name ?? u.email}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="py-2 pr-3">
                      {locked ? (
                        <span>{roleLabel(current)}</span>
                      ) : (
                        <Select
                          value={current ?? ""}
                          onValueChange={(v) => void changeRole(u.id, v as AppRole)}
                        >
                          <SelectTrigger className="h-10 w-44">
                            <SelectValue placeholder="No access" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectable.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        className="h-10 w-44"
                        defaultValue={u.company ?? ""}
                        disabled={locked}
                        placeholder="—"
                        onBlur={(e) => {
                          if ((e.target.value || "") !== (u.company ?? "") && current)
                            void changeRole(u.id, current, e.target.value);
                        }}
                      />
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "Never"}
                      {u.id === user?.id ? " (you)" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
