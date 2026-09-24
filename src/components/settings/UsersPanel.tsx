import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { sendInvite, notifyAddedToJob } from "@/lib/invites.functions";
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
  is_super: boolean | null;
  last_sign_in_at: string | null;
};

function useUsers(projectId: string | null) {
  return useQuery({
    queryKey: ["admin-users", projectId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_users", { _project: projectId as string });
      if (error) throw new Error(error.message);
      return (data ?? []) as UserRow[];
    },
  });
}

function useInvites(projectId: string | null) {
  return useQuery({
    queryKey: ["invites", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      await supabase.rpc("expire_old_invites");
      const { data, error } = await supabase
        .from("user_invites")
        .select("*")
        .eq("project_id", projectId!)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function UsersPanel() {
  const qc = useQueryClient();
  const { isSuperAdmin, user, projectId, currentJob } = useAuth();
  const { data: users = [] } = useUsers(projectId);
  const { data: invites = [] } = useInvites(projectId);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<AppRole>("bmd_field");
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

  const sendInviteFn = useServerFn(sendInvite);
  const notifyFn = useServerFn(notifyAddedToJob);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const deliver = async (inviteId: string, to: string) => {
    setSendingId(inviteId);
    try {
      const res = await sendInviteFn({ data: { inviteId } });
      if (res.ok) toast.success(`Invitation sent to ${to}`);
      else toast.error(`Invitation to ${to} was not sent: ${res.error}`, { duration: 10000 });
    } catch (e) {
      toast.error(`Invitation to ${to} was not sent: ${e instanceof Error ? e.message : String(e)}`, { duration: 10000 });
    } finally {
      setSendingId(null);
      refresh();
    }
  };

  const invite = async () => {
    const clean = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(clean)) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(true);
    const { data: row, error } = await supabase.from("user_invites").insert({
      email: clean,
      full_name: name.trim() || null,
      role,
      company: company.trim() || null,
      project_id: projectId!,
    }).select("id").single();
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That email already has an open invite" : error.message);
      return;
    }
    setEmail("");
    setName("");
    setCompany("");
    refresh();
    await deliver(row.id, clean);
  };

  const changeRole = async (id: string, next: AppRole, comp?: string) => {
    const { error } = await supabase.rpc("set_member_role", {
      _project: projectId!,
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

  const addExisting = async () => {
    const clean = addEmail.trim().toLowerCase();
    if (!clean) return;
    const { data: uid, error } = await supabase.rpc("add_member_by_email", { _project: projectId!, _email: clean, _role: addRole });
    if (error) {
      toast.error(error.message);
      return;
    }
    setAddEmail("");
    refresh();
    try {
      const res = await notifyFn({ data: { projectId: projectId!, userId: uid as string } });
      if (res.ok) toast.success(`Added to this job — email sent to ${clean}`);
      else toast.error(`Added to this job, but the email to ${clean} failed: ${res.error}`, { duration: 10000 });
    } catch (e) {
      toast.error(`Added to this job, but the email failed: ${e instanceof Error ? e.message : String(e)}`, { duration: 10000 });
    }
  };

  const removeMember = async (id: string) => {
    if (!confirm("Remove this person from this job?")) return;
    const { error } = await supabase.rpc("remove_member", { _project: projectId!, _user_id: id });
    if (error) toast.error(error.message);
    else {
      toast.success("Removed from this job");
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
          Invites are for <strong>{currentJob?.name}</strong>. We email them a sign-up link. When they sign up with this email they join this job with the role you choose.
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
          {saving ? "Sending…" : "Send invite"}
        </Button>

        {invites.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Invites not yet accepted</p>
            <ul className="divide-y divide-border">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.full_name ? `${i.full_name} · ` : ""}
                    {i.email} · {roleLabel(i.role)}
                    {i.company ? ` · ${i.company}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i.status === "expired"
                      ? "Expired"
                      : i.sent_at
                        ? `Sent ${new Date(i.sent_at).toLocaleDateString()}`
                        : "Not sent"}
                  </span>
                  {i.last_error && (
                    <span className="w-full text-xs text-destructive">Last send failed: {i.last_error}</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sendingId === i.id}
                    onClick={() => void deliver(i.id, i.email)}
                  >
                    <Send className="h-4 w-4" /> {sendingId === i.id ? "Sending…" : "Resend"}
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
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground uppercase">Add an existing user to this job</h2>
        <p className="mb-3 text-sm text-muted-foreground">For people who already have an account on another job.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <Input className="h-11" type="email" placeholder="Their email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
          <Select value={addRole} onValueChange={(v) => setAddRole(v as AppRole)}>
            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {selectable.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="h-11" onClick={() => void addExisting()}>Add to job</Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">People on this job</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="py-2 pr-3">Person</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Company</th>
                <th className="py-2 pr-3">Last sign-in</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const current = (u.is_super ? "super_admin" : u.role === "bmd_admin" ? "super_admin" : u.role) as AppRole | null;
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
                    <td className="py-2 pr-3 text-muted-foreground">
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "Never"}
                      {u.id === user?.id ? " (you)" : ""}
                    </td>
                    <td className="py-2">
                      {!locked && u.id !== user?.id && (
                        <Button variant="ghost" size="sm" aria-label="Remove from job" onClick={() => void removeMember(u.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
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

/** Super admin only: everyone in the system, and the global super admin flag. */
export function AllUsersPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: users = [] } = useUsers(null);
  const toggle = async (id: string, makeSuper: boolean) => {
    const { error } = await supabase.rpc("set_user_role", { _user_id: id, _role: makeSuper ? "super_admin" : "viewer" });
    if (error) toast.error(error.message);
    else {
      toast.success(makeSuper ? "Now a super admin (all jobs)" : "Super admin removed");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    }
  };
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-semibold text-muted-foreground uppercase">All users</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Everyone with an account. Super admins see every job; everyone else only sees jobs they were added to.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
              <th className="py-2 pr-3">Person</th>
              <th className="py-2 pr-3">Company</th>
              <th className="py-2 pr-3">Last sign-in</th>
              <th className="py-2">Super admin</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border">
                <td className="py-2 pr-3">
                  <p className="font-medium">{u.full_name ?? u.email}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </td>
                <td className="py-2 pr-3">{u.company ?? "—"}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "Never"}
                  {u.id === user?.id ? " (you)" : ""}
                </td>
                <td className="py-2">
                  <Button variant={u.is_super ? "default" : "outline"} size="sm" onClick={() => void toggle(u.id, !u.is_super)}>
                    {u.is_super ? "Yes — remove" : "Make super admin"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
