import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function mayManage(sb: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> }) {
  const { data } = await sb.rpc("has_capability", { _capability: "manage_integrations" });
  if (data !== true) throw new Error("You don't have permission to send to QuickBooks.");
}

/** What would be sent to QuickBooks right now, in words. Reads only. */
export const syncSendPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await mayManage(context.supabase as never);
    const { qboEnv, qboConnection } = await import("@/lib/qbo/qbo.server");
    const { previewSends } = await import("./send.server");
    type Line = { outboxId: string; kind: string; label: string; target: "Item" | "Vendor"; op: "update" | "create" | "deactivate"; summary: string[] };
    const held: { outboxId: string; label: string; reason: string }[] = [];
    const sends: Line[] = [];
    if (!qboEnv() || !(await qboConnection())) return { ok: false as const, message: "Connect QuickBooks under Integrations first.", sends, held };
    const p = await previewSends();
    for (const s of p.sends) sends.push({ outboxId: s.outboxId, kind: s.kind, label: s.label, target: s.target, op: s.op, summary: s.summary });
    held.push(...p.held);
    return { ok: true as const, message: "", sends, held };
  });

/** Sends the ticked changes now. */
export const syncSendNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[] }) => {
    if (!d || !Array.isArray(d.ids) || d.ids.some((x) => typeof x !== "string" || !/^[0-9a-f-]{36}$/i.test(x))) throw new Error("Invalid request");
    return { ids: d.ids.slice(0, 50) };
  })
  .handler(async ({ data, context }) => {
    await mayManage(context.supabase as never);
    if (data.ids.length === 0) return { sent: 0, failed: 0, held: 0 };
    const { runSends } = await import("./send.server");
    return runSends(data.ids, context.userId);
  });

/** The on-switch for the five-minute schedule. Pass `enabled` to change it; omit to read it. */
export const syncSendSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled?: boolean } | undefined) => ({ enabled: typeof d?.enabled === "boolean" ? d.enabled : undefined }))
  .handler(async ({ data, context }) => {
    await mayManage(context.supabase as never);
    const { sendSetting, setSendSetting } = await import("./send.server");
    if (data.enabled !== undefined) await setSendSetting(data.enabled, context.userId);
    return sendSetting();
  });
