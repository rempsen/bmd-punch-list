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
