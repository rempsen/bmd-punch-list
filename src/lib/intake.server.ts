// Server-only: reads Dan's Microsoft 365 mailbox for "+ingest@" emails and turns them into deficiencies.
import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = "https://connector-gateway.lovable.dev/microsoft_outlook";
const PLACEHOLDER = "From email – location to confirm";
const ASSESS = ["acceptable", "client_review", "must_fix"] as const;

type Admin = SupabaseClient;

function graphHeaders() {
  const k = process.env["LOVABLE_API_KEY"];
  const c = process.env["MICROSOFT_OUTLOOK_API_KEY"];
  if (!k || !c) throw new Error("Mailbox connection is not configured.");
  return { Authorization: `Bearer ${k}`, "X-Connection-Api-Key": c, Prefer: 'outlook.body-content-type="text"' };
}

async function graph<T>(path: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, { headers: graphHeaders() });
  if (!res.ok) throw new Error(`Mailbox request failed [${res.status}]: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

type GMsg = {
  id: string;
  subject: string | null;
  receivedDateTime: string;
  hasAttachments: boolean;
  from?: { emailAddress: { name: string; address: string } };
  toRecipients?: { emailAddress: { address: string } }[];
  ccRecipients?: { emailAddress: { address: string } }[];
  body?: { content: string };
};

export type Parsed = {
  job: string | null;
  floor: string | null;
  location: string | null;
  area: string | null;
  material: string | null;
  issue_type: string | null;
  assessment: string | null;
  description: string | null;
  due_date: string | null;
  urgency: string | null;
  confidence: { job: number; location: number; material: number; issue_type: number };
};

async function context(admin: Admin) {
  const { data: projects } = await admin.from("projects").select("id,name,address,client_name").is("archived_at", null);
  const jobs = [];
  for (const p of projects ?? []) {
    const { data: floors } = await admin.from("floors").select("id,label,sort_order,locations(id,name)").eq("project_id", p.id).order("sort_order");
    const { data: picks } = await admin.from("pick_lists").select("kind,value").eq("project_id", p.id);
    jobs.push({ ...p, floors: floors ?? [], picks: picks ?? [] });
  }
  return jobs;
}

type Jobs = Awaited<ReturnType<typeof context>>;

export async function parseEmail(text: string, jobs: Jobs, rules: string, examples: { email_text: string; corrected: unknown }[]): Promise<Parsed> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured.");
  const jobText = jobs
    .map((j) => {
      const pick = (k: string) => j.picks.filter((p) => p.kind === k).map((p) => p.value).join(", ");
      const floors = j.floors
        .map((f) => `${f.label}: ${(f.locations as { name: string }[]).filter((l) => l.name !== PLACEHOLDER).map((l) => l.name).join(", ")}`)
        .join("\n  ");
      return `JOB "${j.name}" (${j.address ?? ""}; client ${j.client_name ?? ""})\n  Areas: ${pick("area")}\n  Materials: ${pick("material")}\n  Issues: ${pick("issue_type")}\n  ${floors}`;
    })
    .join("\n\n");
  const ex = examples
    .slice(0, 8)
    .map((e, i) => `Example ${i + 1}\nEMAIL:\n${e.email_text.slice(0, 1200)}\nCORRECT ANSWER: ${JSON.stringify(e.corrected)}`)
    .join("\n\n");

  const prompt = `You turn emails about flooring/tile/window-covering problems into one deficiency record for BMD Materials.
Choose values ONLY from the lists below (copy spelling exactly). Use null when the email doesn't say or you can't tell.
floor = floor label, location = room number or common-area name on that floor. assessment: acceptable | client_review | must_fix (client complaints default to must_fix).
Work out, from the forwarded email and any note typed above it: WHERE the problem is (floor, room or common area, area/scope of work), WHAT it is (material, issue type), and whether it is acceptable, needs the client to review it, or obviously must be fixed.
area = the scope/area of work from the Areas list. material = type of material. issue_type = the kind of defect.
description: 1-3 plain sentences describing the problem in BMD's words (what, where, how bad). If the email gives a deadline or time pressure, add it as the last sentence.
due_date: if the client says it must be done before a date or event ("before the inspection on Oct 3", "by Friday", "before guests check in next week"), give that date as YYYY-MM-DD (today is ${new Date().toISOString().slice(0, 10)}); otherwise null.
urgency: the time-sensitive wording copied short (e.g. "before Oct 3 inspection"), or null.
Confidence 0-1 per field.

${rules ? `HOUSE RULES:\n${rules}\n\n` : ""}${jobText}

${ex ? `PAST CORRECTIONS (follow these patterns):\n${ex}\n\n` : ""}EMAIL:
${text.slice(0, 6000)}`;

  const { streamText, Output } = await import("ai");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { z } = await import("zod");
  const { createLovableAiGatewayRunIdFetch } = await import("./ai-gateway.server");
  const lovable = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: createLovableAiGatewayRunIdFetch().fetch,
  });
  const s = z.string().nullable();
  const result = streamText({
    model: lovable.responses("openai/gpt-6-astra"),
    prompt,
    output: Output.object({
      schema: z.object({
        job: s, floor: s, location: s, area: s, material: s, issue_type: s, assessment: s, description: s, due_date: s, urgency: s,
        confidence: z.object({ job: z.number(), location: z.number(), material: z.number(), issue_type: z.number() }),
      }),
    }),
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", store: false, include: ["reasoning.encrypted_content"] } },
  });
  return (await result.output) as Parsed;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Map AI text answers to real IDs; unknowns fall back to the default job + placeholder location. */
export async function resolve(admin: Admin, p: Parsed, jobs: Jobs, defaultProject: string | null, forcedProject: string | null = null) {
  const missing: string[] = [];
  let job = (forcedProject ? jobs.find((j) => j.id === forcedProject) : undefined) ?? jobs.find((j) => norm(j.name) === norm(p.job)) ?? jobs.find((j) => p.job && norm(j.name).includes(norm(p.job)));
  if (!job) {
    missing.push("job");
    job = jobs.find((j) => j.id === defaultProject) ?? jobs[0];
  }
  if (!job) throw new Error("No job available for unmatched emails.");
  const floor = job.floors.find((f) => norm(f.label) === norm(p.floor));
  const locs = (floor ? [floor] : job.floors).flatMap((f) => f.locations as { id: string; name: string }[]);
  let loc = locs.find((l) => norm(l.name) === norm(p.location) && l.name !== PLACEHOLDER);
  if (!loc || missing.includes("job")) {
    if (!missing.includes("job")) missing.push("location");
    else missing.push("location");
    loc = undefined;
  }
  const pickOr = (kind: string, v: string | null, field: string) => {
    const hit = job!.picks.find((x) => x.kind === kind && norm(x.value) === norm(v));
    if (!hit) missing.push(field);
    return hit?.value ?? (v?.trim() || "To confirm");
  };
  const area = pickOr("area", p.area, "area");
  const material = pickOr("material", p.material, "material");
  const issue = pickOr("issue_type", p.issue_type, "issue_type");
  const assessment = (ASSESS as readonly string[]).includes(p.assessment ?? "") ? p.assessment! : "must_fix";

  let locationId = loc?.id;
  if (!locationId) {
    const first = job.floors[0];
    if (!first) throw new Error(`Job "${job.name}" has no floors.`);
    const existing = job.floors.flatMap((f) => f.locations as { id: string; name: string }[]).find((l) => l.name === PLACEHOLDER);
    if (existing) locationId = existing.id;
    else {
      const { data, error } = await admin
        .from("locations")
        .insert({ floor_id: first.id, type: "common_area", name: PLACEHOLDER, sort_order: 9999 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      locationId = data.id;
    }
  }
  return { projectId: job.id, locationId, area, material, issue, assessment, missing };
}

async function attachPhotos(admin: Admin, msgId: string, defId: string, userId: string | null) {
  const { value } = await graph<{ value: { id: string; name: string; contentType: string; size: number; contentBytes?: string; isInline: boolean }[] }>(
    `/me/messages/${encodeURIComponent(msgId)}/attachments`,
  );
  for (const a of value ?? []) {
    if (!a.contentType?.startsWith("image/") || !a.contentBytes || a.size > 8_000_000) continue;
    const bytes = Uint8Array.from(atob(a.contentBytes), (c) => c.charCodeAt(0));
    const ext = a.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const path = `${defId}/email-${crypto.randomUUID()}.${ext}`;
    const up = await admin.storage.from("deficiency-photos").upload(path, bytes, { contentType: a.contentType });
    if (up.error) continue;
    await admin.from("deficiency_photos").insert({ deficiency_id: defId, storage_path: path, kind: "before", caption: a.name, uploaded_by: userId });
  }
}

export function emailText(r: { from_name?: string | null; from_email?: string | null; subject?: string | null; body_text?: string | null }) {
  return `From: ${r.from_name ?? ""} <${r.from_email ?? ""}>\nSubject: ${r.subject ?? ""}\n\n${r.body_text ?? ""}`;
}

async function loadTraining(admin: Admin, fromEmail?: string | null) {
  const { data: s } = await admin.from("intake_settings").select("*").eq("id", 1).maybeSingle();
  const { data: ex } = await admin.from("intake_examples").select("email_text,corrected").eq("active", true).order("created_at", { ascending: false }).limit(40);
  // Corrections to this same sender's past emails come first, so the AI learns each forwarder's shorthand and intent.
  const me = (fromEmail ?? "").toLowerCase();
  const rows = ex ?? [];
  const mine = me ? rows.filter((e) => e.email_text.toLowerCase().includes(`<${me}>`)) : [];
  const rest = rows.filter((e) => !mine.includes(e));
  return { settings: s, examples: [...mine.slice(0, 6), ...rest].slice(0, 8) };
}

export async function ingestOne(admin: Admin, row: { id: string; message_id: string; from_name: string | null; from_email: string | null; subject: string | null; body_text: string | null }, hasAttachments: boolean, tag: string | null = null) {
  const { settings, examples } = await loadTraining(admin, row.from_email);
  const jobs = await context(admin);
  try {
    const parsed = await parseEmail(emailText(row), jobs, settings?.rules ?? "", examples);
    // The +tag in the address (e.g. dan+centric@) names the job; "ingest" means "let the AI decide".
    const t = norm(tag);
    const tagged = t && t !== "ingest" ? jobs.find((j) => norm(j.name).includes(t))?.id ?? null : null;
    const r = await resolve(admin, parsed, jobs, settings?.default_project_id ?? null, tagged);
    const userId = settings?.created_by_user ?? null;
    const { data: def, error } = await admin
      .from("deficiencies")
      .insert({
        project_id: r.projectId, location_id: r.locationId, area: r.area, material: r.material, issue_type: r.issue,
        assessment: r.assessment as "must_fix", status: "open", responsible_party: "unassigned",
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.due_date ?? "") ? parsed.due_date : null,
        description: [parsed.description, parsed.urgency ? `Time-sensitive: ${parsed.urgency}` : null, `(From email: ${row.subject ?? ""} — ${row.from_email ?? ""})`].filter(Boolean).join("\n"),
        created_by: userId, needs_review: r.missing.length > 0, source: "email", email_pending: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (hasAttachments) await attachPhotos(admin, row.message_id, def.id, userId).catch(() => {});
    await admin.from("deficiency_events").insert({ deficiency_id: def.id, user_id: userId, event_type: "comment", note: `Created from email from ${row.from_email ?? "unknown"}` }).then(() => {}, () => {});
    await admin.from("email_intake").update({
      project_id: r.projectId, deficiency_id: def.id, ai_json: parsed, confidence: { ...parsed.confidence, missing: r.missing },
      status: r.missing.length ? "needs_review" : "parsed", error: null,
    }).eq("id", row.id);
  } catch (e) {
    await admin.from("email_intake").update({ status: "error", error: (e as Error).message }).eq("id", row.id);
  }
}

/** Poll the mailbox for new plus-addressed (e.g. "+centric@") emails since the saved cursor. */
export async function pollMailbox(admin: Admin) {
  const { settings } = await loadTraining(admin);
  const since = settings?.cursor_at ?? new Date(Date.now() - 86400000).toISOString();
  const q = new URLSearchParams({
    $filter: `receivedDateTime gt ${new Date(since).toISOString()}`,
    $orderby: "receivedDateTime asc",
    $top: "50",
    $select: "id,subject,receivedDateTime,hasAttachments,from,toRecipients,ccRecipients,body",
  });
  const { value } = await graph<{ value: GMsg[] }>(`/me/mailFolders/inbox/messages?${q}`);
  let created = 0;
  let cursor = since;
  for (const m of value ?? []) {
    cursor = m.receivedDateTime;
    const rcpt = [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map((r) => r.emailAddress.address.toLowerCase());
    // Any plus-address on a bmdmaterials.com mailbox: dan+centric@, brian+ingest@, etc.
    const hit = rcpt.map((a) => /^[^+@]+\+([^@]+)@bmdmaterials\.com$/.exec(a)).find(Boolean);
    if (!hit) continue;
    const { data: row, error } = await admin
      .from("email_intake")
      .insert({
        message_id: m.id, subject: m.subject, from_name: m.from?.emailAddress.name ?? null, from_email: m.from?.emailAddress.address ?? null,
        body_text: (m.body?.content ?? "").slice(0, 20000), received_at: m.receivedDateTime,
      })
      .select("id,message_id,from_name,from_email,subject,body_text")
      .single();
    if (error) continue; // duplicate
    await ingestOne(admin, row, m.hasAttachments, hit[1]);
    created++;
  }
  await admin.from("intake_settings").update({ cursor_at: cursor, updated_at: new Date().toISOString() }).eq("id", 1);
  return { checked: value?.length ?? 0, created };
}
