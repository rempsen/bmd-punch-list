// Server-only CompanyCam client + sync engine. Never import from browser code.
import type { SupabaseClient } from "@supabase/supabase-js";

const API = "https://api.companycam.com/v2";
type Admin = SupabaseClient;

export class NotConnected extends Error {
  constructor() {
    super("CompanyCam is not connected yet (no API token saved).");
  }
}

export function hasToken() {
  return !!process.env["COMPANYCAM_API_TOKEN"];
}

export async function cc<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = process.env["COMPANYCAM_API_TOKEN"];
  if (!token) throw new NotConnected();
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : null,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `CompanyCam ${init.method ?? "GET"} ${path.split("?")[0]} failed [${res.status}]: ${text.slice(0, 300)}`,
    );
  return (text ? JSON.parse(text) : null) as T;
}

export type CcProject = {
  id: string | number;
  name: string;
  project_url?: string;
  photo_count?: number;
  updated_at?: number;
  address?: { street_address_1?: string; city?: string; state?: string; postal_code?: string };
};
export type CcPhoto = {
  id: string | number;
  project_id?: string | number;
  description?: unknown;
  captured_at?: number;
  creator_name?: string;
  photo_url?: string;
  uris?: { type: string; uri?: string; url?: string }[];
  tags?: { display_value?: string; value?: string }[];
};

export const ccAddress = (p: CcProject) =>
  [
    p.address?.street_address_1,
    p.address?.city,
    [p.address?.state, p.address?.postal_code].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

export async function log(
  admin: Admin,
  row: {
    project_id?: string | null;
    direction: "out" | "in";
    entity: string;
    local_id?: string | null;
    remote_id?: string | null;
    status: "ok" | "error" | "skipped";
    error?: string | null;
    payload?: unknown;
  },
) {
  await admin.from("companycam_sync_log").insert({ ...row, payload: row.payload ?? null } as never);
}

// ---------- matching ----------
const words = (s: string | null | undefined) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
function overlap(a: string | null | undefined, b: string | null | undefined) {
  const A = words(a),
    B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
export function score(
  job: {
    name: string;
    address?: string | null;
    street?: string | null;
    client_name?: string | null;
  },
  p: { name: string; address: string },
) {
  const nameS = overlap(job.name, p.name);
  const street = job.street || job.address?.split(",")[0] || "";
  const addrS = Math.max(overlap(street, p.address), overlap(street, p.name));
  const clientS = job.client_name
    ? Math.max(overlap(job.client_name, p.name), overlap(job.client_name, p.address))
    : 0;
  return Math.round((nameS * 0.5 + addrS * 0.35 + clientS * 0.15) * 100);
}

// ---------- tags / users ----------
let tagCache: Map<string, string> | null = null;
async function tagIds(names: string[]) {
  if (!tagCache) {
    tagCache = new Map();
    const tags = await cc<{ id: string | number; display_value: string }[]>("/tags?per_page=500");
    for (const t of tags ?? []) tagCache.set(t.display_value.toLowerCase(), String(t.id));
  }
  const out: string[] = [];
  for (const n of names) {
    let id = tagCache.get(n.toLowerCase());
    if (!id) {
      const t = await cc<{ id: string | number }>("/tags", {
        method: "POST",
        body: { tag: { display_value: n } },
      });
      id = String(t.id);
      tagCache.set(n.toLowerCase(), id);
    }
    out.push(id);
  }
  return out;
}

export async function refreshUsers(admin: Admin) {
  const users = await cc<{ id: string | number; email_address?: string }[]>("/users?per_page=500");
  let matched = 0;
  for (const u of users ?? []) {
    if (!u.email_address) continue;
    const { data } = await admin
      .from("profiles")
      .update({ companycam_user_id: String(u.id) })
      .ilike("email", u.email_address)
      .select("id");
    matched += data?.length ?? 0;
  }
  return { companycamUsers: users?.length ?? 0, matched };
}

// ---------- deficiency text ----------
const ASSESS: Record<string, string> = {
  must_fix: "Must fix",
  client_review: "Client review",
  acceptable: "Acceptable",
};
const STATUS: Record<string, string> = {
  open: "Open",
  awaiting_client: "Awaiting client",
  accepted_as_is: "Accepted as-is",
  fix_required: "Fix required",
  in_progress: "In progress",
  fixed: "Fixed",
  verified: "Verified",
};
export const dNo = (n: number) => `D-${String(n).padStart(4, "0")}`;

type DefRow = {
  id: string;
  item_number: number;
  area: string;
  material: string;
  issue_type: string;
  description: string | null;
  assessment: string;
  status: string;
  assigned_to: string | null;
  companycam_task_id: string | null;
  locations: { name: string; type: string; floors: { label: string; number: number } } | null;
};
const DEF_SELECT =
  "id,item_number,area,material,issue_type,description,assessment,status,assigned_to,companycam_task_id,locations(name,type,floors(label,number))";

function defLine(d: DefRow) {
  const loc = d.locations;
  const place = loc ? (loc.type === "room" ? `Room ${loc.name}` : loc.name) : "";
  return [
    dNo(d.item_number),
    loc?.floors.label,
    place,
    d.material,
    d.issue_type,
    ASSESS[d.assessment],
    d.description?.split("\n")[0],
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------- project sync ----------
type Opts = Record<
  | "photos_out"
  | "tasks_out"
  | "comments_out"
  | "documents_out"
  | "photos_in"
  | "comments_in"
  | "tasks_in",
  boolean
>;

export async function syncProject(admin: Admin, projectId: string) {
  const { data: proj } = await admin
    .from("projects")
    .select(
      "id,name,companycam_project_id,companycam_sync_enabled,companycam_last_sync_at,companycam_options",
    )
    .eq("id", projectId)
    .single();
  if (!proj?.companycam_project_id)
    throw new Error("This job isn't linked to a CompanyCam project yet.");
  if (!proj.companycam_sync_enabled) throw new Error("Sync is switched off for this job.");
  const ccId = proj.companycam_project_id;
  const opts = (proj.companycam_options ?? {}) as Opts;
  const since = proj.companycam_last_sync_at
    ? new Date(proj.companycam_last_sync_at)
    : new Date(Date.now() - 30 * 86400000);
  const started = new Date().toISOString();
  const counts = { photosIn: 0, photosOut: 0, tasks: 0, comments: 0, errors: 0 };
  const fail = async (entity: string, e: unknown, local?: string, remote?: string) => {
    counts.errors++;
    await log(admin, {
      project_id: projectId,
      direction: entity.endsWith("_in") ? "in" : "out",
      entity,
      local_id: local ?? null,
      remote_id: remote ?? null,
      status: "error",
      error: (e as Error).message,
    });
  };

  const { data: defs } = await admin
    .from("deficiencies")
    .select(DEF_SELECT)
    .eq("project_id", projectId)
    .eq("is_sample", false);
  const byId = new Map(((defs ?? []) as unknown as DefRow[]).map((d) => [d.id, d]));

  // Outbound photos
  if (opts.photos_out !== false && byId.size) {
    const { data: photos } = await admin
      .from("deficiency_photos")
      .select("id,deficiency_id,storage_path,kind,taken_at")
      .in("deficiency_id", [...byId.keys()])
      .is("companycam_photo_id", null)
      .limit(40);
    for (const p of photos ?? []) {
      const d = byId.get(p.deficiency_id)!;
      try {
        const { data: signed } = await admin.storage
          .from("deficiency-photos")
          .createSignedUrl(p.storage_path, 86400);
        if (!signed?.signedUrl) throw new Error("Could not create a photo link");
        const tags = [
          "Deficiency",
          ASSESS[d.assessment] ?? d.assessment,
          d.locations ? `Floor ${d.locations.floors.number}` : null,
          p.kind === "after" ? "After" : null,
        ].filter(Boolean) as string[];
        const photo = await cc<{ id: string | number }>(`/projects/${ccId}/photos`, {
          method: "POST",
          body: {
            photo: {
              uri: signed.signedUrl,
              captured_at: Math.floor(new Date(p.taken_at).getTime() / 1000),
              description: defLine(d),
            },
          },
        });
        await admin
          .from("deficiency_photos")
          .update({ companycam_photo_id: String(photo.id) })
          .eq("id", p.id);
        try {
          await cc(`/photos/${photo.id}/tags`, {
            method: "POST",
            body: { tag_ids: await tagIds(tags) },
          });
        } catch (e) {
          await fail("photo_tags_out", e, p.id, String(photo.id));
        }
        counts.photosOut++;
        await log(admin, {
          project_id: projectId,
          direction: "out",
          entity: "photo",
          local_id: p.id,
          remote_id: String(photo.id),
          status: "ok",
        });
      } catch (e) {
        await fail("photo_out", e, p.id);
      }
    }
  }

  // Outbound tasks
  // Off unless a job turns it on: CompanyCam’s public API has no project-task endpoint (every POST returned 404).
  if (opts.tasks_out === true) {
    const { data: people } = await admin
      .from("profiles")
      .select("id,companycam_user_id")
      .not("companycam_user_id", "is", null);
    const ccUser = new Map((people ?? []).map((p) => [p.id, p.companycam_user_id]));
    for (const d of byId.values()) {
      const needs = d.assessment === "must_fix" || d.status === "fix_required";
      const done = d.status === "verified" || d.status === "accepted_as_is";
      try {
        if (needs && !d.companycam_task_id && !done) {
          const loc = d.locations?.name ?? "";
          const t = await cc<{ id: string | number }>(`/projects/${ccId}/tasks`, {
            method: "POST",
            body: {
              task: {
                title: `${dNo(d.item_number)} – ${loc} – ${d.material} ${d.issue_type.toLowerCase()}`,
                assignee_id: d.assigned_to ? (ccUser.get(d.assigned_to) ?? undefined) : undefined,
              },
            },
          });
          await admin
            .from("deficiencies")
            .update({ companycam_task_id: String(t.id) })
            .eq("id", d.id);
          counts.tasks++;
          await log(admin, {
            project_id: projectId,
            direction: "out",
            entity: "task",
            local_id: d.id,
            remote_id: String(t.id),
            status: "ok",
          });
        } else if (done && d.companycam_task_id) {
          await cc(`/tasks/${d.companycam_task_id}`, {
            method: "PUT",
            body: { task: { completed: true } },
          });
          await log(admin, {
            project_id: projectId,
            direction: "out",
            entity: "task_complete",
            local_id: d.id,
            remote_id: d.companycam_task_id,
            status: "ok",
          });
        }
      } catch (e) {
        await fail("task_out", e, d.id, d.companycam_task_id ?? undefined);
      }
    }
  }

  // Outbound comments on status changes / client decisions since last sync
  if (opts.comments_out !== false && byId.size) {
    const { data: evs } = await admin
      .from("deficiency_events")
      .select("id,deficiency_id,event_type,to_value,note,user_id,created_at")
      .in("deficiency_id", [...byId.keys()])
      .in("event_type", ["status_change", "client_decision"])
      .gt("created_at", since.toISOString())
      .order("created_at");
    const uids = [...new Set((evs ?? []).map((e) => e.user_id).filter(Boolean))] as string[];
    const { data: names } = uids.length
      ? await admin.from("profiles").select("id,full_name,email").in("id", uids)
      : { data: [] };
    const who = new Map((names ?? []).map((n) => [n.id, n.full_name || n.email]));
    for (const e of evs ?? []) {
      const d = byId.get(e.deficiency_id)!;
      const by = e.user_id ? ` by ${who.get(e.user_id) ?? "BMD"}` : "";
      const content =
        e.event_type === "client_decision"
          ? `${dNo(d.item_number)} client decision: ${STATUS[e.to_value ?? ""] ?? e.to_value}${by}${e.note ? ` — ${e.note}` : ""}`
          : `${dNo(d.item_number)} marked ${STATUS[e.to_value ?? ""] ?? e.to_value}${by}${e.to_value === "fixed" ? " — after photo attached" : ""}`;
      try {
        await cc(`/projects/${ccId}/comments`, { method: "POST", body: { comment: { content } } });
        counts.comments++;
      } catch (err) {
        await fail("comment_out", err, e.id);
      }
    }
  }

  // Inbound photos
  if (opts.photos_in !== false) {
    try {
      const start = Math.floor(since.getTime() / 1000);
      for (let page = 1; page <= 10; page++) {
        const photos = await cc<CcPhoto[]>(
          `/projects/${ccId}/photos?per_page=50&page=${page}&start_date=${start}`,
        );
        for (const p of photos ?? [])
          if (await inboxPhoto(admin, projectId, ccId, p)) counts.photosIn++;
        if (!photos || photos.length < 50) break;
      }
    } catch (e) {
      await fail("photos_in", e);
    }
  }

  // Notepad summary
  if (opts.documents_out !== false)
    try {
      const open = [...byId.values()].filter(
        (d) => !["verified", "accepted_as_is"].includes(d.status),
      );
      const mf = open.filter((d) => d.assessment === "must_fix").length;
      const cr = open.filter((d) => d.assessment === "client_review").length;
      await cc(`/projects/${ccId}/notepad`, {
        method: "PUT",
        body: {
          notepad: `BMD Projects — ${open.length} open (${mf} must fix, ${cr} client review), last sync ${new Date().toLocaleString("en-CA", { timeZone: "America/Winnipeg" })}`,
        },
      });
    } catch (e) {
      await fail("notepad_out", e);
    }

  await admin.from("projects").update({ companycam_last_sync_at: started }).eq("id", projectId);
  await log(admin, {
    project_id: projectId,
    direction: "in",
    entity: "sync",
    status: counts.errors ? "error" : "ok",
    error: counts.errors ? `${counts.errors} step(s) failed — see rows below` : null,
    payload: counts,
  });
  return counts;
}

/** Add a CompanyCam photo to the inbox unless the app uploaded it or it's already there. */
export function ccText(d: unknown): string | null {
  if (!d) return null;
  if (typeof d === "string") return d;
  const o = d as { plain_text_content?: string; html_content?: string };
  return o.plain_text_content ?? o.html_content ?? null;
}

export async function inboxPhoto(admin: Admin, projectId: string, ccProjectId: string, p: CcPhoto) {
  const id = String(p.id);
  const { data: mine } = await admin
    .from("deficiency_photos")
    .select("id")
    .eq("companycam_photo_id", id)
    .maybeSingle();
  if (mine) return false;
  const uri = (t: string) =>
    p.uris?.find((u) => u.type === t)?.uri ?? p.uris?.find((u) => u.type === t)?.url;
  const { error } = await admin.from("companycam_inbox").insert({
    project_id: projectId,
    cc_photo_id: id,
    cc_project_id: ccProjectId,
    thumb_url: uri("thumbnail") ?? uri("web") ?? null,
    photo_url: uri("original") ?? uri("large") ?? uri("web") ?? null,
    web_url: p.photo_url ?? null,
    description: ccText(p.description),
    tags: (p.tags ?? []).map((t) => t.display_value ?? t.value ?? "").filter(Boolean),
    taken_at: p.captured_at ? new Date(p.captured_at * 1000).toISOString() : null,
    creator_name: p.creator_name ?? null,
  });
  return !error;
}

/** Record unlinked CompanyCam projects as suggestions. */
export async function suggestNewProjects(admin: Admin) {
  const list = await cc<CcProject[]>("/projects?per_page=100");
  const { data: linked } = await admin
    .from("projects")
    .select("companycam_project_id")
    .not("companycam_project_id", "is", null);
  const taken = new Set((linked ?? []).map((l) => l.companycam_project_id));
  const cutoff = Date.now() / 1000 - 90 * 86400;
  let n = 0;
  for (const p of list ?? []) {
    if (taken.has(String(p.id)) || (p.updated_at && p.updated_at < cutoff)) continue;
    const { error } = await admin.from("companycam_suggestions").insert({
      kind: "new_project",
      cc_project_id: String(p.id),
      name: p.name,
      address: ccAddress(p),
      payload: p as never,
    });
    if (!error) n++;
  }
  return n;
}

// ---------- webhooks ----------
export async function verifySignature(body: string, sig: string | null, secret: string) {
  if (!sig) return false;
  const { createHmac, timingSafeEqual } = await import("crypto");
  const candidates = [
    createHmac("sha1", secret).update(body).digest("base64"),
    createHmac("sha256", secret).update(body).digest("base64"),
    createHmac("sha256", secret).update(body).digest("hex"),
  ];
  return candidates.some(
    (c) => c.length === sig.length && timingSafeEqual(Buffer.from(c), Buffer.from(sig)),
  );
}

export async function webhookSecret(admin: Admin) {
  if (process.env["COMPANYCAM_WEBHOOK_SECRET"]) return process.env["COMPANYCAM_WEBHOOK_SECRET"];
  const { data } = await admin
    .from("companycam_webhook")
    .select("secret")
    .eq("id", 1)
    .maybeSingle();
  return data?.secret ?? null;
}

type Hook = { type?: string; event_type?: string; payload?: Record<string, unknown> };

export async function handleWebhook(admin: Admin, evt: Hook) {
  const type = evt.type ?? evt.event_type ?? "";
  const pl = (evt.payload ?? {}) as Record<string, Record<string, unknown>>;
  const findJob = async (ccProjectId: unknown) => {
    const { data } = await admin
      .from("projects")
      .select("id,companycam_options,companycam_sync_enabled")
      .eq("companycam_project_id", String(ccProjectId ?? ""))
      .maybeSingle();
    return data?.companycam_sync_enabled ? data : null;
  };

  if (type.startsWith("photo.")) {
    const photo = (pl["photo"] ?? pl) as unknown as CcPhoto;
    const job = await findJob(photo.project_id);
    if (job && (job.companycam_options as Opts).photos_in !== false)
      await inboxPhoto(admin, job.id, String(photo.project_id), photo);
    return;
  }
  if (type === "project.created") {
    const p = (pl["project"] ?? pl) as unknown as CcProject;
    await admin.from("companycam_suggestions").insert({
      kind: "new_project",
      cc_project_id: String(p.id),
      name: p.name,
      address: ccAddress(p),
      payload: p as never,
    });
    return;
  }
  if (type === "project.updated") {
    const p = (pl["project"] ?? pl) as unknown as CcProject;
    const { data: job } = await admin
      .from("projects")
      .select("id,name,address")
      .eq("companycam_project_id", String(p.id))
      .maybeSingle();
    if (job && (job.name !== p.name || (ccAddress(p) && job.address !== ccAddress(p))))
      await admin.from("companycam_suggestions").upsert(
        {
          kind: "project_update",
          cc_project_id: String(p.id),
          project_id: job.id,
          name: p.name,
          address: ccAddress(p),
          payload: p as never,
          status: "open",
        },
        { onConflict: "kind,cc_project_id" },
      );
    return;
  }
  if (type === "comment.created") {
    const c = (pl["comment"] ?? pl) as {
      commentable_type?: string;
      commentable_id?: string | number;
      content?: string;
      creator_name?: string;
    };
    if (c.commentable_type?.toLowerCase() !== "photo") return;
    const { data: ph } = await admin
      .from("deficiency_photos")
      .select("deficiency_id")
      .eq("companycam_photo_id", String(c.commentable_id))
      .maybeSingle();
    if (!ph) return;
    await admin.from("deficiency_events").insert({
      deficiency_id: ph.deficiency_id,
      event_type: "comment",
      note: `CompanyCam comment from ${c.creator_name ?? "someone"}: ${c.content ?? ""}`,
    });
    return;
  }
  if (type.startsWith("task.")) {
    const t = (pl["task"] ?? pl) as {
      id?: string | number;
      completed?: boolean;
      completed_at?: unknown;
      status?: string;
    };
    if (!(t.completed || t.completed_at || t.status === "completed")) return;
    const { data: d } = await admin
      .from("deficiencies")
      .select("id,project_id,status,projects(companycam_options)")
      .eq("companycam_task_id", String(t.id))
      .maybeSingle();
    if (!d || ["fixed", "verified", "accepted_as_is"].includes(d.status)) return;
    const o = ((d as unknown as { projects: { companycam_options: Opts } }).projects
      ?.companycam_options ?? {}) as Opts;
    if (o.tasks_in === false) return;
    const { error } = await admin.from("deficiencies").update({ status: "fixed" }).eq("id", d.id);
    await admin.from("deficiency_events").insert({
      deficiency_id: d.id,
      event_type: "comment",
      note: error
        ? `CompanyCam task completed, but the item could not be marked Fixed: ${error.message}`
        : "Task completed in CompanyCam — marked Fixed, pending BMD verification",
    });
    await log(admin, {
      project_id: d.project_id,
      direction: "in",
      entity: "task_complete",
      local_id: d.id,
      remote_id: String(t.id),
      status: error ? "error" : "ok",
      error: error?.message ?? null,
    });
  }
}

/**
 * What BMD asks CompanyCam to send: the events handleWebhook acts on. Every name must be one of CompanyCam's documented
 * scopes (docs.companycam.com → Webhooks); one it doesn't know makes CompanyCam refuse the whole registration (422).
 */
export const WEBHOOK_SCOPES = [
  "photo.created",
  "photo.updated",
  "project.created",
  "project.updated",
  "comment.created",
];

/** CompanyCam's documented webhook scopes, for checking WEBHOOK_SCOPES. */
export const COMPANYCAM_SCOPES = new Set([
  "*",
  "project.*",
  "project.created",
  "project.updated",
  "project.label_added",
  "project.contact_created",
  "project.contact_updated",
  "project.merged",
  "project.archived",
  "project.deleted",
  "photo.*",
  "photo.created",
  "photo.updated",
  "photo.tag_added",
  "photo.description_updated",
  "comment.*",
  "comment.created",
  "document.*",
  "document.created",
  "document.updated",
  "video.*",
  "video.created",
  "video.updated",
  "todo_list.*",
  "todo_list.created",
  "todo_list.completed",
  "todo_list.deleted",
  "task.*",
  "task.completed",
]);

/**
 * The key CompanyCam signs every delivery with (X-CompanyCam-Signature: base64 HMAC-SHA1 of the body). CompanyCam only
 * signs when it is given one at registration, so BMD makes a fresh random one each time it registers.
 */
export function newWebhookToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
