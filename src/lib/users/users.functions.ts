import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/lib/roles";
import { accessSummary, validateInvite, type InviteInput } from "./logic";

// Account changes for the Users screen. The database decides who may do what (admin_* functions);
// these add what only the server can do: send the invite email, and block or delete the sign-in.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (d: unknown, key: string): string => {
  const v = (d as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string" || !UUID.test(v)) throw new Error("Invalid request");
  return v;
};
/** A ban long enough to mean "until someone reactivates them". */
const BANNED = "876000h";

type Sb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Emails (or re-emails) a pending invite and records the result on it. The caller's permission is checked first. */
async function emailInvite(sb: Sb, userId: string, inviteId: string) {
  const [{ supabaseAdmin }, { sendEmail, accessInviteEmail }, { getRequest }, { roleLabel }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/invite-email.server"),
    import("@tanstack/react-start/server"),
    import("@/lib/roles"),
  ]);
  const { data: allowed } = await sb.rpc("has_capability", { _capability: "manage_users" });
  if (!allowed) throw new Error("You don't have permission to manage users");
  const { data: inv, error } = await supabaseAdmin.from("user_invites").select("*").eq("id", inviteId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw new Error("Invite not found");
  if (inv.status === "accepted") throw new Error("This person has already accepted the invitation");
  if (inv.status === "cancelled") throw new Error("This invitation was cancelled");
  const level = (inv.level ?? inv.role) as AppRole;
  if (level === "super_admin") {
    const { data: isSuper } = await sb.rpc("is_super_admin", { _user_id: userId });
    if (!isSuper) throw new Error("Only a super admin can invite a super admin");
  }

  const picks = (inv.level ? (inv.jobs as { project_id: string; role: AppRole | null }[]) : inv.project_id ? [{ project_id: inv.project_id, role: null }] : []) ?? [];
  const ids = picks.map((j) => j.project_id);
  const [{ data: projects }, { data: me }] = await Promise.all([
    ids.length ? supabaseAdmin.from("projects").select("id,name").in("id", ids) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabaseAdmin.from("profiles").select("full_name,email").eq("id", userId).maybeSingle(),
  ]);
  const name = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const accessLine = inv.level
    ? accessSummary(level, inv.all_jobs, picks.map((j) => ({ name: name.get(j.project_id) ?? "a job", role: j.role })))
    : `${roleLabel(level)} on ${name.get(inv.project_id ?? "") ?? "a BMD job"}`;
  const msg = accessInviteEmail({
    requestUrl: getRequest().url,
    email: inv.email,
    token: inv.invite_token,
    inviterName: me?.full_name || me?.email || "BMD Materials",
    inviteeName: inv.full_name,
    accessLine,
  });
  const res = await sendEmail({ to: inv.email, replyTo: me?.email ?? null, ...msg });
  const now = new Date();
  await supabaseAdmin
    .from("user_invites")
    .update(res.ok ? { sent_at: now.toISOString(), last_error: null, status: "pending", expires_at: new Date(now.getTime() + 14 * 864e5).toISOString() } : { last_error: res.error })
    .eq("id", inv.id);
  return res;
}

/** Invites someone new with a level and job access; optionally emails them straight away. */
export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: InviteInput & { send: boolean }) => {
    const v = validateInvite(d);
    if (!v.ok) throw new Error(v.why);
    return { ...v.value, send: d.send !== false };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const { data: inviteId, error } = await sb.rpc("admin_invite", {
      _email: data.email,
      _full_name: data.fullName,
      _company: data.company ?? "",
      _level: data.level,
      _all_jobs: data.allJobs,
      _jobs: data.jobs.map((j) => ({ project_id: j.projectId, role: j.role })),
    });
    if (error) throw new Error(error.message);
    const email = data.send ? await emailInvite(sb, context.userId, inviteId as string) : null;
    return { inviteId: inviteId as string, email };
  });

export const resendUserInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inviteId: string }) => ({ inviteId: id(d, "inviteId") }))
  .handler(async ({ data, context }) => emailInvite(context.supabase as unknown as Sb, context.userId, data.inviteId));

/** Blocks sign-in at once. The database refuses them everywhere; the ban stops new sessions and token refresh. */
export const deactivateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => ({ userId: id(d, "userId") }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const { error } = await sb.rpc("admin_set_status", { _user: data.userId, _status: "deactivated" });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: BANNED });
    if (banError) {
      await sb.rpc("admin_set_status", { _user: data.userId, _status: "active" });
      throw new Error(`Could not block sign-in, so nothing was changed: ${banError.message}`);
    }
    return { ok: true as const };
  });

export const reactivateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => ({ userId: id(d, "userId") }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const { error } = await sb.rpc("admin_set_status", { _user: data.userId, _status: "active" });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "none" });
    if (banError) {
      await sb.rpc("admin_set_status", { _user: data.userId, _status: "deactivated" });
      throw new Error(`Could not restore sign-in, so they stay deactivated: ${banError.message}`);
    }
    return { ok: true as const };
  });

/** Second step after deactivation, only for someone whose name is on nothing. The admin types their name to confirm. */
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; confirmName: string }) => {
    if (typeof d?.confirmName !== "string") throw new Error("Type their name to confirm");
    return { userId: id(d, "userId"), confirmName: d.confirmName };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin.from("profiles").select("full_name,email").eq("id", data.userId).maybeSingle();
    if (!p) throw new Error("User not found");
    const expected = (p.full_name || p.email || "").trim().toLowerCase();
    if (data.confirmName.trim().toLowerCase() !== expected) throw new Error(`Type "${p.full_name || p.email}" exactly to confirm`);
    const { error } = await sb.rpc("admin_delete_user_data", { _user: data.userId });
    if (error) throw new Error(error.message);
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (authError) {
      return { ok: false as const, error: `Their access and profile were removed, but the sign-in record could not be deleted (it stays blocked): ${authError.message}` };
    }
    return { ok: true as const };
  });
