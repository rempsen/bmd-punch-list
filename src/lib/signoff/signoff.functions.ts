import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a pending sign-off and emails the client a 14-day link to sign it in the app. Needs manage_projects on the job. */
export const sendSignoffLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; inspectionId: string | null; name: string; email: string }) => {
    if (!d || !UUID.test(d.projectId)) throw new Error("Invalid job");
    if (d.inspectionId != null && !UUID.test(d.inspectionId)) throw new Error("Invalid inspection");
    const name = String(d.name ?? "").trim().slice(0, 200);
    const email = String(d.email ?? "").trim().toLowerCase();
    if (!name) throw new Error("Enter the client's name.");
    if (!EMAIL.test(email)) throw new Error("Enter a valid email address.");
    return { ...d, name, email };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: allowed } = await sb.rpc("has_capability", { _capability: "manage_projects", _project: data.projectId });
    if (!allowed) throw new Error("You don't have permission to record sign-off on this job.");
    const { LINK_DAYS } = await import("./logic");
    const expires = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
    const { data: row, error } = await sb
      .from("signoffs")
      .insert({ project_id: data.projectId, inspection_id: data.inspectionId, signed_by_name: data.name, signed_by_email: data.email, method: "emailed_link", link_expires_at: expires, recorded_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const [{ data: job }, { data: me }] = await Promise.all([
      sb.from("projects").select("name,address").eq("id", data.projectId).maybeSingle(),
      sb.from("profiles").select("full_name,email").eq("id", context.userId).maybeSingle(),
    ]);
    const { getRequest } = await import("@tanstack/react-start/server");
    const { appOrigin } = await import("@/lib/app-url");
    const { layout, sendEmail } = await import("@/lib/invite-email.server");
    const url = appOrigin(getRequest().url);
    const link = `${url}/sign/${row.id}`;
    const jobName = job?.name ?? "your job";
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    const html = layout(
      url,
      `Please sign off ${jobName}`,
      `<p>Hi ${esc(data.name)},</p><p>The installation at <b>${esc(jobName)}</b>${job?.address ? ` (${esc(job.address)})` : ""} has been inspected. Please review the summary and sign off in the BMD app. You'll be asked to sign in with your BMD account.</p><p>This link works for ${LINK_DAYS} days.</p>`,
      { href: link, label: "Review and sign" },
    );
    const text = `Hi ${data.name},\n\nThe installation at ${jobName} has been inspected. Please review and sign off here (sign in with your BMD account): ${link}\n\nThis link works for ${LINK_DAYS} days.\n\nBMD Materials`;
    const res = await sendEmail({ to: data.email, replyTo: me?.email ?? null, subject: `Sign-off for ${jobName}`, html, text });
    if (!res.ok) {
      await sb.from("signoffs").delete().eq("id", row.id);
      throw new Error(res.error);
    }
    return { id: row.id, expires };
  });
