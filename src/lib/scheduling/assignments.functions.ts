/**
 * Assignment emails and the crew's one-tap answer. Sending is always a person's press: the email leaves from the signed-in
 * person's own Microsoft 365 mailbox (the same path quotes use). The answer page is public, opened by the link's secret.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CrewGroup, LinkState, Skipped } from "./assignments";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PROJECT = "project:projects(name,project_number,address,street,city,province,postal_code)";

type Row = {
  id: string;
  project_id: string;
  starts_at: string;
  status: string;
  scope: string | null;
  assigned_user_id: string | null;
  assigned_name: string | null;
  technician_supplier_id: string | null;
  arriveping_assigned_to: string | null;
  tentative?: boolean | null;
  confirmation?: string | null;
  report_to?: string | null;
  report_to_other?: string | null;
  report_time?: string | null;
  run_day?: number | null;
  run_total?: number | null;
  project: { name: string; project_number: string | null; address: string | null; street: string | null; city: string | null; province: string | null; postal_code: string | null } | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The scheduling tables and columns are newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

const jobName = (r: Row) => [r.project?.project_number, r.project?.name].filter(Boolean).join(" ") || "Job";
const jobAddress = (r: Row) => {
  const p = r.project;
  if (!p) return null;
  return (p.address ?? "").trim() || [p.street, p.city, p.province, p.postal_code].map((x) => (x ?? "").trim()).filter(Boolean).join(", ") || null;
};

/** The day's visits by crew, each crew's email (staff: login email; subcontractor: the vendor record's), and the copy-to list. */
async function loadDay(day: string) {
  const { groupByCrew, crewRef } = await import("./assignments");
  const db = await admin();
  const from = new Date(`${day}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${day}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);
  const { data, error } = await db.from("install_visits").select(`*,${PROJECT}`).gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).neq("status", "cancelled").order("starts_at");
  if (error) throw new Error(`Could not load the day's visits: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const refs = rows.map(crewRef).filter((r) => r != null);
  const userIds = [...new Set(refs.flatMap((r) => (r.kind === "user" ? [r.id] : [])))];
  const supIds = [...new Set(refs.flatMap((r) => (r.kind === "sup" ? [r.id] : [])))];
  const [people, vendors, settings] = await Promise.all([
    userIds.length ? db.from("profiles").select("id,full_name,email").in("id", userIds) : { data: [] },
    supIds.length ? db.from("suppliers").select("id,name,email").in("id", supIds) : { data: [] },
    db.from("schedule_settings").select("assignment_cc").eq("id", 1).maybeSingle(),
  ]);
  const names = new Map<string, string>();
  const emails = new Map<string, string | null>();
  for (const p of (people.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    names.set(`user:${p.id}`, (p.full_name ?? "").trim() || p.email || "Staff");
    emails.set(`user:${p.id}`, p.email);
  }
  for (const s of (vendors.data ?? []) as { id: string; name: string; email: string | null }[]) {
    names.set(`sup:${s.id}`, s.name.trim());
    emails.set(`sup:${s.id}`, s.email);
  }
  const { cleanEmail } = await import("./assignments");
  const cc = ((settings.data?.assignment_cc ?? []) as string[]).map((e) => cleanEmail(e)).filter((e): e is string => !!e);
  return { groups: groupByCrew(rows, day, names), emails, cc };
}

export type PreviewVisit = { id: string; job: string; address: string | null; scope: string | null; reportTo: string; reportAt: string; runLabel: string | null; confirmation: string };
export type AssignmentPreview = {
  day: string;
  /** The mailbox the emails will leave from, or null when the person has not connected Outlook. */
  mailbox: string | null;
  cc: string[];
  send: { key: string; name: string; email: string; alreadySent: boolean; visits: PreviewVisit[] }[];
  skipped: Skipped[];
  unassigned: number;
};

async function previewVisit(r: Row): Promise<PreviewVisit> {
  const { reportAt, reportPlace } = await import("./assignments");
  const { runLabel } = await import("./runs");
  return { id: r.id, job: jobName(r), address: jobAddress(r), scope: r.scope, reportTo: reportPlace(r), reportAt: reportAt(r), runLabel: runLabel(r), confirmation: r.confirmation ?? "not_sent" };
}

async function canSchedule(sb: unknown): Promise<boolean> {
  const { data } = await (sb as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> }).rpc("has_capability", { _capability: "manage_projects" });
  return data === true;
}

const dayInput = (d: { day: string }) => {
  if (!d || typeof d.day !== "string" || !DAY.test(d.day) || Number.isNaN(Date.parse(`${d.day}T12:00:00Z`))) throw new Error("Choose a day.");
  return { day: d.day };
};

/** Exactly who would get what for a day, and who would be skipped. Sends nothing. */
export const previewAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(dayInput)
  .handler(async ({ data, context }): Promise<AssignmentPreview> => {
    if (!(await canSchedule(context.supabase))) throw new Error("You don't have permission to send assignments.");
    const { planRecipients } = await import("./assignments");
    const { connectionFor, msEnv } = await import("@/lib/ms/graph.server");
    const { groups, emails, cc } = await loadDay(data.day);
    const plan = planRecipients(groups.crews as CrewGroup<Row>[], emails);
    const mine = msEnv() ? await connectionFor(context.userId) : null;
    return {
      day: data.day,
      mailbox: mine?.account_email ?? null,
      cc,
      send: await Promise.all(
        plan.send.map(async (s) => ({ key: s.key, name: s.name, email: s.email, alreadySent: s.visits.every((v) => (v.confirmation ?? "not_sent") !== "not_sent"), visits: await Promise.all(s.visits.map(previewVisit)) })),
      ),
      skipped: plan.skipped,
      unassigned: groups.unassigned.length,
    };
  });

export type SendAssignmentsResult = {
  sent: { key: string; name: string; email: string; visits: number }[];
  failed: { key: string; name: string; error: string }[];
  skipped: Skipped[];
  /** The mailbox needs connecting again; nothing more was tried after this. */
  reconnect: boolean;
};

/** Sends one email per chosen crew from the signed-in person's mailbox, each with a fresh Confirm / Can't make it link, and records every send on the visits' activity. */
export const sendAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { day: string; crewKeys: string[] }) => {
    const { day } = dayInput(d);
    if (!Array.isArray(d.crewKeys) || d.crewKeys.length === 0 || d.crewKeys.length > 200 || d.crewKeys.some((k) => typeof k !== "string" || k.length > 100)) throw new Error("Choose who to send to.");
    return { day, crewKeys: d.crewKeys };
  })
  .handler(async ({ data, context }): Promise<SendAssignmentsResult> => {
    if (!(await canSchedule(context.supabase))) throw new Error("You don't have permission to send assignments.");
    const { planRecipients, assignmentEmail, linkExpiry } = await import("./assignments");
    const { connectionFor, sendMailAs } = await import("@/lib/ms/graph.server");
    const { hashToken, newToken } = await import("@/lib/quotes/public");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { appOrigin } = await import("@/lib/app-url");
    const mine = await connectionFor(context.userId);
    if (!mine) throw new Error("Connect your Outlook mailbox first: Company settings → Integrations.");
    const db = await admin();
    const { groups, emails, cc } = await loadDay(data.day);
    const plan = planRecipients(groups.crews as CrewGroup<Row>[], emails, data.crewKeys);
    const [{ data: me }, { data: company }] = await Promise.all([
      db.from("profiles").select("full_name,email").eq("id", context.userId).maybeSingle(),
      db.from("quote_settings").select("company_name").eq("id", 1).maybeSingle(),
    ]);
    const senderName = (me?.full_name ?? "").trim() || me?.email || mine.account_email;
    const origin = appOrigin(getRequest().url);
    const out: SendAssignmentsResult = { sent: [], failed: [], skipped: plan.skipped, reconnect: false };
    for (const r of plan.send) {
      const token = newToken();
      const { data: link, error } = await db
        .from("crew_assignment_links")
        .insert({ token_hash: await hashToken(token), day: data.day, crew_key: r.key, crew_name: r.name, email: r.email, cc, visit_ids: r.visits.map((v) => v.id), sent_by: context.userId, sent_by_name: senderName, expires_at: linkExpiry(data.day) })
        .select("id")
        .single();
      if (error || !link) {
        out.failed.push({ key: r.key, name: r.name, error: `Could not prepare the link: ${error?.message ?? "no row returned"}` });
        continue;
      }
      const base = `${origin}/confirm/${token}`;
      const mail = assignmentEmail({ crewName: r.name, day: data.day, visits: await Promise.all(r.visits.map(previewVisit)), confirmUrl: `${base}?a=yes`, declineUrl: `${base}?a=no`, senderName, company: (company?.company_name ?? "").trim() });
      // Never copy the crew on their own message twice.
      const res = await sendMailAs(context.userId, { to: [r.email], cc: cc.filter((c) => c !== r.email), subject: mail.subject, html: mail.html });
      if (!res.ok) {
        // Nothing went out, so the link must not exist and the visits stay as they were.
        await db.from("crew_assignment_links").delete().eq("id", link.id);
        out.failed.push({ key: r.key, name: r.name, error: res.message });
        if (res.reason === "reconnect") {
          out.reconnect = true;
          break;
        }
        continue;
      }
      const { error: markError } = await db.rpc("activate_assignment_link", { _link: link.id });
      if (markError) out.failed.push({ key: r.key, name: r.name, error: `The email was sent, but it could not be recorded here: ${markError.message}` });
      else out.sent.push({ key: r.key, name: r.name, email: r.email, visits: r.visits.length });
    }
    return out;
  });

// ── The crew's page (no sign-in) ─────────────────────────────────────────────────────────────────────────────
/** What the crew's page shows: the job name, address, date, and where and when to report. Never prices or client contact details. */
export type AssignmentView = {
  state: LinkState;
  crewName: string;
  day: string;
  company: string;
  declineReason: string | null;
  visits: { job: string; address: string | null; reportTo: string; reportAt: string }[];
};

const tokenInput = <T extends { token: string }>(d: T): T => {
  if (!d || typeof d.token !== "string" || !TOKEN.test(d.token)) throw new Error("Invalid link");
  return d;
};

/** An unknown link and one whose email never left look the same: nothing. */
async function openLink(token: string): Promise<AssignmentView | null> {
  const { hashToken } = await import("@/lib/quotes/public");
  const { linkState, reportAt, reportPlace } = await import("./assignments");
  const db = await admin();
  const { data: link } = await db.from("crew_assignment_links").select("id,day,crew_name,expires_at,response,decline_reason").eq("token_hash", await hashToken(token)).not("sent_at", "is", null).maybeSingle();
  if (!link) return null;
  const { data: rows } = await db.from("install_visits").select(`*,${PROJECT}`).eq("assignment_link_id", link.id).neq("status", "cancelled").order("starts_at");
  const visits = (rows ?? []) as Row[];
  const state = linkState(link, visits.length);
  const { data: company } = await db.from("quote_settings").select("company_name").eq("id", 1).maybeSingle();
  return {
    state,
    crewName: link.crew_name,
    day: link.day,
    company: (company?.company_name ?? "").trim(),
    declineReason: state === "declined" ? link.decline_reason : null,
    // An expired or replaced link shows no job details.
    visits: state === "expired" || state === "replaced" ? [] : visits.map((r) => ({ job: jobName(r), address: jobAddress(r), reportTo: reportPlace(r), reportAt: reportAt(r) })),
  };
}

export const getAssignment = createServerFn({ method: "GET" })
  .inputValidator(tokenInput<{ token: string }>)
  .handler(async ({ data }): Promise<AssignmentView | null> => openLink(data.token));

/** The crew's tap. Returns the page as it now stands. */
export const respondAssignment = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; answer: "confirmed" | "declined"; reason?: string }) => {
    tokenInput(d);
    if (d.answer !== "confirmed" && d.answer !== "declined") throw new Error("Invalid request");
    if (d.reason != null && (typeof d.reason !== "string" || d.reason.length > 300)) throw new Error("Keep the reason short.");
    return d;
  })
  .handler(async ({ data }): Promise<AssignmentView | null> => {
    const { hashToken } = await import("@/lib/quotes/public");
    const db = await admin();
    const { error } = await db.rpc("respond_to_assignment", { _token_hash: await hashToken(data.token), _answer: data.answer, _reason: data.reason ?? null });
    if (error) throw new Error("We couldn't save that. Please try again, or call the office.");
    return openLink(data.token);
  });
