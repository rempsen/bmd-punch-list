import { appOrigin } from "@/lib/app-url";

const FROM = "BMD Materials <noreply@bmdmaterials.com>";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(appUrl: string, title: string, bodyHtml: string, button?: { href: string; label: string }) {
  const LOGO = `${appUrl}/bmd-logo.png`;
  return `<!doctype html><html><body style="margin:0;background:#F9FAFA;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFA;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:24px 28px;border-bottom:3px solid #E8C4B8"><img src="${LOGO}" alt="BMD Materials" width="140" style="display:block"></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
${bodyHtml}
${button ? `<p style="margin:24px 0"><a href="${button.href}" style="display:inline-block;background:#1b2a4a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">${esc(button.label)}</a></p>
<p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${esc(button.href)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb">BMD Materials · BMD Projects</td></tr>
</table></td></tr></table></body></html>`;
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(msg: {
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return { ok: false, error: "Email sending is not configured (missing Resend key)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [msg.to],
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !body.id) {
      const error = `Resend ${res.status}: ${body.message ?? body.name ?? "unknown error"}`;
      console.error("[invite email]", error);
      return { ok: false, error };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    const error = `Could not reach Resend: ${e instanceof Error ? e.message : String(e)}`;
    console.error("[invite email]", error);
    return { ok: false, error };
  }
}

export function inviteEmail(p: {
  email: string;
  token: string;
  inviterName: string;
  jobName: string;
  jobAddress: string | null;
  roleLabel: string;
  inviteeName: string | null;
  /** The address the person sending the invite is on; links in the email go to the same site. */
  requestUrl?: string | null;
}) {
  const APP_URL = appOrigin(p.requestUrl);
  const href = `${APP_URL}/auth?invite=${encodeURIComponent(p.token)}&email=${encodeURIComponent(p.email)}`;
  const where = p.jobAddress ? `${p.jobName} (${p.jobAddress})` : p.jobName;
  const hi = p.inviteeName ? `Hi ${p.inviteeName},` : "Hi,";
  const html = layout(APP_URL, 
    `You're invited to ${p.jobName}`,
    `<p>${esc(hi)}</p>
<p><strong>${esc(p.inviterName)}</strong> has invited you to BMD Projects for <strong>${esc(p.jobName)}</strong>${p.jobAddress ? `, ${esc(p.jobAddress)}` : ""}.</p>
<p>Your access: <strong>${esc(p.roleLabel)}</strong></p>
<p>Create your account with this email address (${esc(p.email)}) to get started. This invitation expires in 14 days.</p>`,
    { href, label: "Create your account" },
  );
  const text = `${hi}

${p.inviterName} has invited you to BMD Projects for ${where}.
Your access: ${p.roleLabel}

Create your account with ${p.email} here:
${href}

This invitation expires in 14 days.
— BMD Materials`;
  return { subject: `You're invited to BMD Projects – ${p.jobName}`, html, text };
}

export function addedEmail(p: {
  inviterName: string;
  jobName: string;
  jobAddress: string | null;
  roleLabel: string;
  name: string | null;
  requestUrl?: string | null;
}) {
  const APP_URL = appOrigin(p.requestUrl);
  const href = `${APP_URL}/jobs`;
  const hi = p.name ? `Hi ${p.name},` : "Hi,";
  const html = layout(APP_URL, 
    `You've been added to ${p.jobName}`,
    `<p>${esc(hi)}</p>
<p><strong>${esc(p.inviterName)}</strong> added you to <strong>${esc(p.jobName)}</strong>${p.jobAddress ? `, ${esc(p.jobAddress)}` : ""} on BMD Projects.</p>
<p>Your access: <strong>${esc(p.roleLabel)}</strong></p>
<p>Sign in with your existing account and choose the job from "Choose a job".</p>`,
    { href, label: "Open the tracker" },
  );
  const text = `${hi}

${p.inviterName} added you to ${p.jobName}${p.jobAddress ? ` (${p.jobAddress})` : ""} on BMD Projects.
Your access: ${p.roleLabel}

Sign in with your existing account: ${href}
— BMD Materials`;
  return { subject: `You've been added to ${p.jobName}`, html, text };
}
