import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

const WEBHOOK_URL = "https://bmd-punch-list.lovable.app/api/public/companycam/webhook";
const uuid = /^[0-9a-f-]{36}$/;
type Sb = { rpc: (fn: string, args: object) => PromiseLike<{ data: unknown }> };

async function need(sb: unknown, cap: string, project?: string) {
  const { data } = await (sb as Sb).rpc("has_capability", project ? { _capability: cap, _project: project } : { _capability: cap });
  if (!data) throw new Error("You don't have permission to do that on this job.");
}
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as never as SupabaseClient;
}
const pid = (d: { projectId: string }) => {
  if (!d || !uuid.test(d.projectId)) throw new Error("Pick a job first.");
  return d;
};

export const ccStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pid)
  .handler(async ({ context, data }) => {
    const { hasToken, cc } = await import("./companycam.server");
    const a = await admin();
    const { data: proj } = await a.from("projects").select("companycam_project_id,companycam_project_url,companycam_sync_enabled,companycam_last_sync_at,companycam_options").eq("id", data.projectId).single();
    const { data: wh } = await a.from("companycam_webhook").select("webhook_id,url,created_at").eq("id", 1).maybeSingle();
    const { data: isMgr } = await (context.supabase as unknown as Sb).rpc("has_capability", { _capability: "manage_settings", _project: data.projectId });
    const base = { project: proj, webhook: isMgr ? wh : null, isManager: !!isMgr };
    if (!hasToken()) return { ...base, connected: false as const, company: null, ccProject: null, error: null };
    try {
      const company = await cc<{ name: string }>("/company");
      let ccProject: { name: string; photo_count?: number; project_url?: string } | null = null;
      if (proj?.companycam_project_id) ccProject = await cc<{ name: string; photo_count?: number; project_url?: string }>(`/projects/${proj.companycam_project_id}`).catch(() => null);
      return { ...base, connected: true as const, company: company?.name ?? "CompanyCam", ccProject, error: null };
    } catch (e) {
      return { ...base, connected: false as const, company: null, ccProject: null, error: (e as Error).message };
    }
  });

export const ccSearchProjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; query?: string | undefined }) => ({ ...pid(d), query: (d.query ?? "").slice(0, 120) }))
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings", data.projectId);
    const { cc, score, ccAddress } = await import("./companycam.server");
    const a = await admin();
    const { data: job } = await a.from("projects").select("name,address,street,client_name").eq("id", data.projectId).single();
    if (!job) throw new Error("Job not found");
    const queries = data.query ? [data.query] : [job.name, job.street || job.address?.split(",")[0], job.client_name].filter(Boolean) as string[];
    const seen = new Map<string, { id: string; name: string; address: string; url: string | null; score: number }>();
    for (const q of queries) {
      const list = await cc<{ id: string | number; name: string; project_url?: string }[]>(`/projects?per_page=25&query=${encodeURIComponent(q)}`);
      for (const p of list ?? []) {
        const addr = ccAddress(p as never);
        seen.set(String(p.id), { id: String(p.id), name: p.name, address: addr, url: p.project_url ?? `https://app.companycam.com/projects/${p.id}`, score: score(job, { name: p.name, address: addr }) });
      }
    }
    return [...seen.values()].sort((x, y) => y.score - x.score).slice(0, 15);
  });

export const ccLinkProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; ccProjectId: string | null; url?: string | null | undefined }) => {
    pid(d);
    if (d.ccProjectId !== null && !/^\d{1,20}$/.test(d.ccProjectId)) throw new Error("Invalid CompanyCam project");
    return d;
  })
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings", data.projectId);
    const a = await admin();
    if (data.ccProjectId) {
      const { data: other } = await a.from("projects").select("name").eq("companycam_project_id", data.ccProjectId).neq("id", data.projectId).maybeSingle();
      if (other) throw new Error(`That CompanyCam project is already linked to "${other.name}".`);
    }
    const { error } = await a.from("projects").update({
      companycam_project_id: data.ccProjectId, companycam_project_url: data.ccProjectId ? data.url ?? `https://app.companycam.com/projects/${data.ccProjectId}` : null,
      companycam_sync_enabled: !!data.ccProjectId, companycam_last_sync_at: null,
    }).eq("id", data.projectId);
    if (error) throw new Error(error.message);
    if (data.ccProjectId) await a.from("companycam_suggestions").update({ status: "done" }).eq("cc_project_id", data.ccProjectId).eq("kind", "new_project");
    return { ok: true };
  });

export const ccCreateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pid)
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings", data.projectId);
    const { cc } = await import("./companycam.server");
    const a = await admin();
    const { data: job } = await a.from("projects").select("name,address,street,city,province,postal_code").eq("id", data.projectId).single();
    if (!job) throw new Error("Job not found");
    const p = await cc<{ id: string | number; project_url?: string }>("/projects", {
      method: "POST",
      body: { project: { name: job.name, address: { street_address_1: job.street || job.address || "", city: job.city ?? "", state: job.province ?? "", postal_code: job.postal_code ?? "", country: "CA" } } },
    });
    await a.from("projects").update({ companycam_project_id: String(p.id), companycam_project_url: p.project_url ?? `https://app.companycam.com/projects/${p.id}`, companycam_sync_enabled: true }).eq("id", data.projectId);
    return { id: String(p.id) };
  });

export const ccSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(pid)
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings", data.projectId);
    const { syncProject, suggestNewProjects, log } = await import("./companycam.server");
    const a = await admin();
    try {
      const counts = await syncProject(a, data.projectId);
      const suggestions = await suggestNewProjects(a).catch(() => 0);
      return { ...counts, suggestions };
    } catch (e) {
      await log(a, { project_id: data.projectId, direction: "in", entity: "sync", status: "error", error: (e as Error).message });
      throw e;
    }
  });

export const ccSaveOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; enabled: boolean; options: Record<string, boolean> }) => {
    pid(d);
    const keys = ["photos_out", "tasks_out", "comments_out", "documents_out", "photos_in", "comments_in", "tasks_in"];
    return { ...d, options: Object.fromEntries(keys.map((k) => [k, d.options?.[k] !== false])) };
  })
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings", data.projectId);
    const a = await admin();
    const { error } = await a.from("projects").update({ companycam_sync_enabled: !!data.enabled, companycam_options: data.options }).eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const ccRefreshUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await need(context.supabase, "manage_settings");
    const { refreshUsers } = await import("./companycam.server");
    return refreshUsers(await admin());
  });

export const ccWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { action: "register" | "remove" }) => {
    if (d?.action !== "register" && d?.action !== "remove") throw new Error("Invalid action");
    return d;
  })
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings");
    const { cc, WEBHOOK_SCOPES } = await import("./companycam.server");
    const a = await admin();
    const { data: cur } = await a.from("companycam_webhook").select("webhook_id").eq("id", 1).maybeSingle();
    if (data.action === "remove") {
      if (cur?.webhook_id) await cc(`/webhooks/${cur.webhook_id}`, { method: "DELETE" });
      await a.from("companycam_webhook").delete().eq("id", 1);
      return { ok: true };
    }
    if (cur?.webhook_id) await cc(`/webhooks/${cur.webhook_id}`, { method: "DELETE" }).catch(() => null);
    const wh = await cc<{ id: string | number; token?: string; secret?: string }>("/webhooks", { method: "POST", body: { url: WEBHOOK_URL, scopes: WEBHOOK_SCOPES, enabled: true } });
    await a.from("companycam_webhook").upsert({ id: 1, webhook_id: String(wh.id), secret: wh.token ?? wh.secret ?? null, url: WEBHOOK_URL, created_at: new Date().toISOString() });
    return { ok: true, id: String(wh.id) };
  });

export const ccSuggestionAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; action: "dismiss" | "link" | "create" | "apply"; projectId?: string }) => {
    if (!uuid.test(d?.id ?? "")) throw new Error("Invalid suggestion");
    if (d.action === "link" && !uuid.test(d.projectId ?? "")) throw new Error("Pick a job to link.");
    return d;
  })
  .handler(async ({ context, data }) => {
    await need(context.supabase, "manage_settings");
    const a = await admin();
    const { data: s } = await a.from("companycam_suggestions").select("*").eq("id", data.id).single();
    if (!s) throw new Error("Suggestion not found");
    if (data.action === "dismiss") {
      await a.from("companycam_suggestions").update({ status: "dismissed" }).eq("id", data.id);
      return {};
    }
    if (data.action === "link") {
      await need(context.supabase, "manage_settings", data.projectId);
      const { error } = await a.from("projects").update({ companycam_project_id: s.cc_project_id, companycam_project_url: `https://app.companycam.com/projects/${s.cc_project_id}`, companycam_sync_enabled: true }).eq("id", data.projectId!);
      if (error) throw new Error(error.message);
      await a.from("companycam_suggestions").update({ status: "done" }).eq("id", data.id);
      return {};
    }
    if (data.action === "apply" && s.project_id) {
      await need(context.supabase, "manage_settings", s.project_id);
      await a.from("projects").update({ name: s.name ?? undefined, ...(s.address ? { address: s.address } : {}) }).eq("id", s.project_id);
      await a.from("companycam_suggestions").update({ status: "done" }).eq("id", data.id);
      return {};
    }
    // create: pre-filled New job wizard draft
    const addr = ((s.payload ?? {}) as { address?: { street_address_1?: string; city?: string; state?: string; postal_code?: string } }).address ?? {};
    const { emptyWizard } = await import("./job-wizard");
    const d = { ...emptyWizard(), name: s.name ?? "", street: addr.street_address_1 ?? "", city: addr.city ?? "", province: addr.state ?? "", postal_code: addr.postal_code ?? "", notes: `CompanyCam project ${s.cc_project_id}` };
    const { data: draft, error } = await context.supabase.from("job_drafts").insert({ user_id: context.userId, name: d.name, step: 0, data: d as never }).select("id").single();
    if (error) throw new Error(error.message);
    await a.from("companycam_suggestions").update({ status: "done" }).eq("id", data.id);
    return { draftId: draft.id };
  });

async function copyInboxPhoto(a: SupabaseClient, row: { photo_url: string | null; thumb_url: string | null; cc_photo_id: string; description: string | null }, defId: string, kind: "before" | "after", userId: string) {
  const url = row.photo_url ?? row.thumb_url;
  if (!url) throw new Error("This CompanyCam photo has no downloadable image.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the photo from CompanyCam [${res.status}]`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 15_000_000) throw new Error("Photo is too large to copy.");
  const path = `${defId}/cc-${row.cc_photo_id}.${type.includes("png") ? "png" : "jpg"}`;
  const up = await a.storage.from("deficiency-photos").upload(path, bytes, { contentType: type, upsert: true });
  if (up.error) throw new Error(up.error.message);
  const { error } = await a.from("deficiency_photos").insert({ deficiency_id: defId, storage_path: path, kind, caption: row.description, uploaded_by: userId, companycam_photo_id: row.cc_photo_id });
  if (error) throw new Error(error.message);
}

export const ccInboxAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string; action: "ignore" | "restore" | "attach" | "create"; deficiencyId?: string; kind?: "before" | "after";
      item?: { locationId: string; area: string; material: string; issue_type: string; assessment: "acceptable" | "client_review" | "must_fix"; description: string };
    }) => {
      if (!uuid.test(d?.id ?? "")) throw new Error("Invalid photo");
      if (d.action === "attach" && !uuid.test(d.deficiencyId ?? "")) throw new Error("Pick an item to attach to.");
      if (d.action === "create") {
        const i = d.item;
        if (!i || !uuid.test(i.locationId)) throw new Error("Pick a location.");
        if (!i.area?.trim() || !i.material?.trim() || !i.issue_type?.trim()) throw new Error("Pick area, material and issue.");
        if (!["acceptable", "client_review", "must_fix"].includes(i.assessment)) throw new Error("Pick an assessment.");
      }
      return { ...d, kind: d.kind === "after" ? ("after" as const) : ("before" as const) };
    },
  )
  .handler(async ({ context, data }) => {
    const a = await admin();
    const { data: row } = await a.from("companycam_inbox").select("*").eq("id", data.id).single();
    if (!row) throw new Error("Photo not found");
    await need(context.supabase, "capture_items", row.project_id);
    if (data.action === "ignore" || data.action === "restore") {
      await a.from("companycam_inbox").update({ status: data.action === "ignore" ? "ignored" : "new" }).eq("id", data.id);
      return {};
    }
    let defId = data.deficiencyId;
    if (data.action === "create") {
      const i = data.item!;
      const { data: created, error } = await context.supabase
        .from("deficiencies")
        .insert({ project_id: row.project_id, location_id: i.locationId, area: i.area, material: i.material, issue_type: i.issue_type, assessment: i.assessment, description: i.description?.slice(0, 4000) || null, status: "open", responsible_party: "unassigned", created_by: context.userId, source: "companycam" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      defId = created.id;
    } else {
      const { data: d } = await a.from("deficiencies").select("project_id").eq("id", defId!).single();
      if (d?.project_id !== row.project_id) throw new Error("That item is on a different job.");
    }
    await copyInboxPhoto(a, row, defId!, data.kind, context.userId);
    await a.from("deficiency_events").insert({ deficiency_id: defId, user_id: context.userId, event_type: "comment", note: `Photo added from CompanyCam${row.creator_name ? ` (taken by ${row.creator_name})` : ""}` });
    await a.from("companycam_inbox").update({ status: "attached", deficiency_id: defId }).eq("id", data.id);
    return { deficiencyId: defId };
  });

export const ccSendDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; name: string; base64: string }) => {
    pid(d);
    if (!d.base64 || d.base64.length > 30_000_000) throw new Error("The PDF is empty or too large.");
    return { ...d, name: (d.name || "Deficiency report.pdf").slice(0, 150) };
  })
  .handler(async ({ context, data }) => {
    await need(context.supabase, "export_pdf", data.projectId);
    const { cc, log } = await import("./companycam.server");
    const a = await admin();
    const { data: proj } = await a.from("projects").select("companycam_project_id,companycam_options").eq("id", data.projectId).single();
    if (!proj?.companycam_project_id) throw new Error("This job isn't linked to CompanyCam yet.");
    if ((proj.companycam_options as { documents_out?: boolean })?.documents_out === false) throw new Error("Sending documents to CompanyCam is switched off in CompanyCam settings.");
    try {
      const doc = await cc<{ id: string | number }>(`/projects/${proj.companycam_project_id}/documents`, { method: "POST", body: { document: { name: data.name, attachment: data.base64 } } });
      await log(a, { project_id: data.projectId, direction: "out", entity: "document", remote_id: String(doc?.id ?? ""), status: "ok", payload: { name: data.name } });
      return { ok: true };
    } catch (e) {
      await log(a, { project_id: data.projectId, direction: "out", entity: "document", status: "error", error: (e as Error).message, payload: { name: data.name } });
      throw e;
    }
  });

type CcPhotoRaw = { id: string; creator_name?: string; captured_at?: number; description?: unknown; uris?: { type: string; uri: string }[] };
export const ccProjectPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; page?: number | undefined }) => ({ ...pid(d), page: Math.max(1, Math.min(500, Math.floor(d.page ?? 1))) }))
  .handler(async ({ context, data }) => {
    const { data: member } = await (context.supabase as unknown as Sb).rpc("is_project_member", { _project: data.projectId });
    const { data: sup } = member ? { data: true } : await (context.supabase as unknown as Sb).rpc("is_super_admin", { _user_id: context.userId });
    if (!member && !sup) throw new Error("You don't have access to this job.");
    const { hasToken, cc, ccText } = await import("./companycam.server");
    const a = await admin();
    const { data: proj } = await a.from("projects").select("companycam_project_id,companycam_project_url").eq("id", data.projectId).single();
    if (!hasToken()) return { state: "not_connected" as const, photos: [], hasMore: false, url: null };
    if (!proj?.companycam_project_id) return { state: "not_linked" as const, photos: [], hasMore: false, url: null };
    const per = 48;
    const raw = await cc<CcPhotoRaw[]>(`/projects/${proj.companycam_project_id}/photos?per_page=${per}&page=${data.page}`);
    const photos = (raw ?? []).map((p) => {
      const u = (t: string) => p.uris?.find((x) => x.type === t)?.uri ?? null;
      return {
        id: String(p.id),
        thumb: u("thumbnail") ?? u("web"),
        web: u("web") ?? u("original"),
        original: u("original") ?? u("web"),
        creator: p.creator_name ?? null,
        takenAt: p.captured_at ? new Date(p.captured_at * 1000).toISOString() : null,
        description: ccText(p.description),
      };
    });
    return { state: "ok" as const, photos, hasMore: photos.length === per, url: proj.companycam_project_url as string | null };
  });
