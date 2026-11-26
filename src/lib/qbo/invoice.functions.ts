import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const can = async (sb: any, c: string) => (await sb.rpc("has_capability", { _capability: c })).data === true;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mayBill(sb: any) {
  if (!(await can(sb, "send_quotes")) || !(await can(sb, "view_pricing"))) throw new Error("You don't have permission to send bills to QuickBooks.");
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mayClients(sb: any) {
  if (!(await can(sb, "manage_projects")) && !(await can(sb, "manage_integrations"))) throw new Error("You don't have permission to change QuickBooks customers.");
}
const asBill = (d: { billId: string }) => {
  if (!UUID.test(d?.billId ?? "")) throw new Error("Pick a bill.");
  return { billId: d.billId };
};

/** What the QuickBooks invoice for a bill would hold, and what changes on the customer first. Reads only. */
export const previewQboInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(asBill)
  .handler(async ({ data, context }) => {
    await mayBill(context.supabase);
    const { previewBillInvoice } = await import("./invoice.server");
    try {
      return await previewBillInvoice(data.billId);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });

/** Creates the unsent invoice in QuickBooks. It is never emailed from here. */
export const createQboInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(asBill)
  .handler(async ({ data, context }) => {
    await mayBill(context.supabase);
    const { createBillInvoice } = await import("./invoice.server");
    try {
      return await createBillInvoice(data.billId, context.userId);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });

/** Clients whose QuickBooks customer differs from the client record. Reads only. */
export const qboClientDiffs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await mayClients(context.supabase);
    const { clientCustomerDiffs } = await import("./invoice.server");
    try {
      return { ok: true as const, diffs: await clientCustomerDiffs() };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });

/** Updates the chosen clients' QuickBooks customers from the client records (the client record wins). */
export const qboPushClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientIds: string[] }) => ({ clientIds: (d?.clientIds ?? []).filter((x) => UUID.test(x)).slice(0, 200) }))
  .handler(async ({ data, context }) => {
    await mayClients(context.supabase);
    const { pushClientsToQbo } = await import("./invoice.server");
    return pushClientsToQbo(data.clientIds, context.userId);
  });
