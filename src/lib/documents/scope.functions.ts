import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cap = async (sb: any, c: string) => (await sb.rpc("has_capability", { _capability: c })).data === true;

/** "Scan existing documents" in Company settings → Scope keywords. Re-scans every indexed plan and spec. */
export const scanExistingDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await cap(context.supabase, "manage_settings"))) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanAllDocuments } = await import("./scope.server");
    return scanAllDocuments(supabaseAdmin);
  });

/** The one-time backfill: runs once for the first BMD staff member to open Documents or Overview after deploy. */
export const ensureScopeBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await cap(context.supabase, "view_pipeline"))) return { ran: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    // Claim the flag first so two people opening the app at once do not both run it.
    const { data: claimed, error } = await admin.from("scope_scan_state").update({ backfilled_at: new Date().toISOString() }).eq("id", true).is("backfilled_at", null).select("id");
    if (error) throw new Error(error.message);
    if (!claimed?.length) return { ran: false as const };
    const { scanAllDocuments } = await import("./scope.server");
    return { ran: true as const, ...(await scanAllDocuments(admin)) };
  });
