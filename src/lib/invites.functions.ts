import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { roleLabel } from "@/lib/roles";

const UUID = /^[0-9a-f-]{36}$/i;

/** Sends (or re-sends) the invitation email for one invite. Caller needs manage_users on the invite's job. */
export const sendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { inviteId: string }) => {
    if (!d || typeof d.inviteId !== "string" || !UUID.test(d.inviteId)) throw new Error("Invalid invite");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { sendEmail, inviteEmail } = await import("@/lib/invite-email.server");
    const sb = context.supabase;
    const { data: inv, error } = await sb.from("user_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv || !inv.project_id) throw new Error("Invite not found");
    const { data: allowed } = await sb.rpc("has_capability", { _capability: "manage_users", _project: inv.project_id });
    if (!allowed) throw new Error("You don't have permission to invite people to this job");
    if (inv.status === "accepted") throw new Error("This person has already accepted the invitation");

    const [{ data: job }, { data: me }] = await Promise.all([
      sb.from("projects").select("name,address").eq("id", inv.project_id).maybeSingle(),
      sb.from("profiles").select("full_name,email").eq("id", context.userId).maybeSingle(),
    ]);
    const msg = inviteEmail({
      email: inv.email,
      token: inv.invite_token,
      inviterName: me?.full_name || me?.email || "BMD Materials",
      jobName: job?.name ?? "BMD job",
      jobAddress: job?.address ?? null,
      roleLabel: roleLabel(inv.role),
      inviteeName: inv.full_name,
    });
    const res = await sendEmail({ to: inv.email, replyTo: me?.email ?? null, ...msg });
    const now = new Date();
    await sb
      .from("user_invites")
      .update(
        res.ok
          ? {
              sent_at: now.toISOString(),
              last_error: null,
              status: "pending",
              expires_at: new Date(now.getTime() + 14 * 864e5).toISOString(),
            }
          : { last_error: res.error },
      )
      .eq("id", inv.id);
    return res;
  });

/** Emails an existing user that they were added to a job. */
export const notifyAddedToJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; userId: string }) => {
    if (!d || !UUID.test(d.projectId ?? "") || !UUID.test(d.userId ?? "")) throw new Error("Invalid input");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { sendEmail, addedEmail } = await import("@/lib/invite-email.server");
    const sb = context.supabase;
    const { data: allowed } = await sb.rpc("has_capability", { _capability: "manage_users", _project: data.projectId });
    if (!allowed) throw new Error("Not allowed");
    const [{ data: job }, { data: me }, { data: them }, { data: member }] = await Promise.all([
      sb.from("projects").select("name,address").eq("id", data.projectId).maybeSingle(),
      sb.from("profiles").select("full_name,email").eq("id", context.userId).maybeSingle(),
      sb.from("profiles").select("full_name,email").eq("id", data.userId).maybeSingle(),
      sb.from("project_members").select("role").eq("project_id", data.projectId).eq("user_id", data.userId).maybeSingle(),
    ]);
    if (!them?.email || !member) throw new Error("That person isn't on this job");
    const msg = addedEmail({
      inviterName: me?.full_name || me?.email || "BMD Materials",
      jobName: job?.name ?? "BMD job",
      jobAddress: job?.address ?? null,
      roleLabel: roleLabel(member.role),
      name: them.full_name,
    });
    return sendEmail({ to: them.email, replyTo: me?.email ?? null, ...msg });
  });
