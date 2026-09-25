import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertManager(supabase: { rpc: (fn: string, args: object) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("has_capability", { _cap: "manage_settings" });
  if (!data) throw new Error("Only BMD managers can run email intake.");
}

export const checkMailboxNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pollMailbox } = await import("./intake.server");
    return pollMailbox(supabaseAdmin as never);
  });

export const reparseEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d || !/^[0-9a-f-]{36}$/.test(d.id)) throw new Error("Invalid email");
    return d;
  })
  .handler(async ({ context, data }) => {
    await assertManager(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { parseEmail, emailText } = await import("./intake.server");
    const admin = supabaseAdmin as never as import("@supabase/supabase-js").SupabaseClient;
    const { data: row } = await admin.from("email_intake").select("*").eq("id", data.id).single();
    if (!row) throw new Error("Email not found");
    const { data: s } = await admin.from("intake_settings").select("rules").eq("id", 1).maybeSingle();
    const { data: ex } = await admin.from("intake_examples").select("email_text,corrected").eq("active", true).limit(8);
    const { data: projects } = await admin.from("projects").select("id,name,address,client_name").is("archived_at", null);
    const jobs = [];
    for (const p of projects ?? []) {
      const { data: floors } = await admin.from("floors").select("id,label,sort_order,locations(id,name)").eq("project_id", p.id).order("sort_order");
      const { data: picks } = await admin.from("pick_lists").select("kind,value").eq("project_id", p.id);
      jobs.push({ ...p, floors: floors ?? [], picks: picks ?? [] });
    }
    const parsed = await parseEmail(emailText(row), jobs as never, s?.rules ?? "", ex ?? []);
    await admin.from("email_intake").update({ ai_json: parsed }).eq("id", data.id);
    return parsed;
  });

type Correction = {
  intakeId: string;
  projectId: string;
  locationId: string;
  area: string;
  material: string;
  issue_type: string;
  assessment: "acceptable" | "client_review" | "must_fix";
  description: string;
};

export const saveIntakeCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Correction) => {
    const uuid = /^[0-9a-f-]{36}$/;
    if (!d || !uuid.test(d.intakeId) || !uuid.test(d.projectId) || !uuid.test(d.locationId)) throw new Error("Pick a job and a location.");
    if (!["acceptable", "client_review", "must_fix"].includes(d.assessment)) throw new Error("Pick an assessment.");
    for (const k of ["area", "material", "issue_type"] as const) if (!d[k]?.trim()) throw new Error(`Pick a ${k.replace("_", " ")}.`);
    return { ...d, description: (d.description ?? "").slice(0, 4000) };
  })
  .handler(async ({ context, data }) => {
    const sb = context.supabase;
    const { data: ok } = await sb.rpc("has_capability", { _cap: "manage_settings", _project: data.projectId });
    if (!ok) throw new Error("You can't manage that job.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { emailText } = await import("./intake.server");
    const admin = supabaseAdmin as never as import("@supabase/supabase-js").SupabaseClient;

    const { data: row } = await admin.from("email_intake").select("*").eq("id", data.intakeId).single();
    if (!row?.deficiency_id) throw new Error("This email has no item yet.");
    const { data: loc } = await admin.from("locations").select("id,name,floors!inner(label,project_id)").eq("id", data.locationId).single();
    const floor = (loc as { floors: { label: string; project_id: string } } | null)?.floors;
    if (!loc || floor?.project_id !== data.projectId) throw new Error("That location isn't on the chosen job.");

    const fields = {
      location_id: data.locationId, area: data.area, material: data.material, issue_type: data.issue_type,
      assessment: data.assessment, description: data.description || null, needs_review: false,
    };
    let defId = row.deficiency_id as string;
    const { data: old } = await admin.from("deficiencies").select("*").eq("id", defId).single();
    if (!old) throw new Error("Item not found.");
    if (old.project_id !== data.projectId) {
      const { data: okOld } = await sb.rpc("has_capability", { _cap: "manage_settings", _project: old.project_id });
      if (!okOld) throw new Error("You can't manage the item's current job.");
      const { data: created, error } = await admin
        .from("deficiencies")
        .insert({ ...fields, project_id: data.projectId, status: "open", responsible_party: "unassigned", created_by: old.created_by, source: "email" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const { data: photos } = await admin.from("deficiency_photos").select("*").eq("deficiency_id", defId);
      for (const p of photos ?? []) {
        const np = `${created.id}/${p.storage_path.split("/").slice(1).join("/")}`;
        const cp = await admin.storage.from("deficiency-photos").copy(p.storage_path, np);
        if (!cp.error) await admin.from("deficiency_photos").insert({ deficiency_id: created.id, storage_path: np, kind: p.kind, caption: p.caption, uploaded_by: p.uploaded_by });
      }
      await admin.storage.from("deficiency-photos").remove((photos ?? []).map((p) => p.storage_path));
      await admin.from("deficiencies").delete().eq("id", defId);
      defId = created.id;
    } else {
      const { error } = await admin.from("deficiencies").update(fields).eq("id", defId);
      if (error) throw new Error(error.message);
    }
    await admin.from("deficiency_events").insert({ deficiency_id: defId, user_id: context.userId, event_type: "comment", note: "Email intake fields reviewed and corrected" });

    const { data: proj } = await admin.from("projects").select("name").eq("id", data.projectId).single();
    const corrected = {
      job: proj?.name ?? null, floor: floor?.label ?? null, location: (loc as { name: string }).name,
      area: data.area, material: data.material, issue_type: data.issue_type, assessment: data.assessment, description: data.description,
    };
    const ai = (row.ai_json ?? {}) as Record<string, unknown>;
    const keys = ["job", "floor", "location", "area", "material", "issue_type", "assessment"] as const;
    const right = keys.filter((k) => String(ai[k] ?? "").toLowerCase() === String(corrected[k] ?? "").toLowerCase()).length;
    await admin.from("email_intake").update({
      deficiency_id: defId, project_id: data.projectId, status: "reviewed",
      confidence: { ...((row.confidence as object) ?? {}), missing: [], score: right / keys.length },
    }).eq("id", data.intakeId);
    if (right < keys.length) await admin.from("intake_examples").insert({ email_intake_id: data.intakeId, email_text: emailText(row).slice(0, 3000), corrected, created_by: context.userId });
    return { deficiencyId: defId };
  });
