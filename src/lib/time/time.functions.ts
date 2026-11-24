import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Location } from "./logic";

type Sb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown }>; from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> } } } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`Invalid ${what}`);
  return v;
};
const instant = (v: unknown, what: string): string => {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new Error(`Invalid ${what}`);
  return new Date(v).toISOString();
};
const note = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : null);
const location = (v: unknown): Location | null => {
  const l = v as Partial<Location> | null | undefined;
  return l && typeof l.lat === "number" && typeof l.lng === "number" ? { lat: l.lat, lng: l.lng, accuracy: typeof l.accuracy === "number" ? l.accuracy : 0 } : null;
};
async function has(sb: Sb, capability: string): Promise<boolean> {
  return (await sb.rpc("has_capability", { _capability: capability })).data === true;
}
async function office(sb: Sb) {
  if (!(await has(sb, "manage_projects"))) throw new Error("You don't have permission to change timesheets.");
}
/** Sending matches the catalogue sender (manage_integrations) and adds the timesheet permission. */
async function sender(sb: Sb) {
  if (!(await has(sb, "manage_projects")) || !(await has(sb, "manage_integrations"))) throw new Error("You don't have permission to send time to QuickBooks.");
}

/** Clock in on a job. One location reading comes with the request; none is taken afterwards. */
export const timeClockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string; note?: string | null; location?: Location | null }) => ({ projectId: uuid(d?.projectId, "job"), note: note(d?.note), location: location(d?.location) }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as Sb;
    if ((await sb.rpc("time_clock_access")).data !== true) return { ok: false as const, reason: "The time clock is not turned on for you. Ask the office." };
    // The person's own access decides which jobs they may clock in on.
    if (!(await sb.from("projects").select("id").eq("id", data.projectId).maybeSingle()).data) return { ok: false as const, reason: "You can't clock in on that job." };
    const { openEntry, insertEntry } = await import("./time.server");
    const { planClockIn } = await import("./logic");
    const plan = planClockIn({ open: await openEntry(context.userId), userId: context.userId, projectId: data.projectId, now: new Date().toISOString(), note: data.note, location: data.location });
    if (!plan.ok) return { ok: false as const, reason: plan.reason, openId: plan.openId };
    const r = await insertEntry(plan.row);
    if (r.duplicate) return { ok: false as const, reason: "You are still clocked in on another job. Clock out of it first." };
    return { ok: true as const, id: r.entry?.id ?? null };
  });

export const timeClockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { note?: string | null; location?: Location | null }) => ({ note: note(d?.note), location: location(d?.location) }))
  .handler(async ({ data, context }) => {
    const { openEntry, closeEntry, timeSettings } = await import("./time.server");
    const { planClockOut } = await import("./logic");
    const open = await openEntry(context.userId);
    const plan = planClockOut({ open, now: new Date().toISOString(), increment: (await timeSettings()).rounding_minutes, note: data.note, location: data.location });
    if (!plan.ok || !open) return { ok: false as const, reason: plan.ok ? "You are not clocked in." : plan.reason };
    const closed = await closeEntry(open.id, plan.patch);
    if (!closed) return { ok: false as const, reason: "You are not clocked in." };
    return { ok: true as const, roundedMinutes: closed.rounded_minutes };
  });

type ChangeInput = { clockInAt: string; clockOutAt: string | null; projectId: string; reason: string };
const change = (d: ChangeInput) => ({ clockInAt: instant(d?.clockInAt, "clock-in time"), clockOutAt: d?.clockOutAt == null ? null : instant(d.clockOutAt, "clock-out time"), projectId: uuid(d?.projectId, "job"), reason: typeof d?.reason === "string" ? d.reason.slice(0, 500) : "" });

/** The office changes an entry's in, out or job. A reason is required and the original values are kept. */
export const timeAdjust = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ChangeInput & { id: string }) => ({ id: uuid(d?.id, "entry"), change: change(d) }))
  .handler(async ({ data, context }) => {
    await office(context.supabase as unknown as Sb);
    const { entryById, patchUnapproved, timeSettings, projectExists } = await import("./time.server");
    const { planAdjust } = await import("./logic");
    const entry = await entryById(data.id);
    if (!entry) return { ok: false as const, reason: "That entry no longer exists." };
    if (!(await projectExists(data.change.projectId))) return { ok: false as const, reason: "Choose the job." };
    const plan = planAdjust({ entry, change: data.change, by: context.userId, now: new Date().toISOString(), increment: (await timeSettings()).rounding_minutes });
    if (!plan.ok) return { ok: false as const, reason: plan.reason };
    if (!(await patchUnapproved(data.id, plan.patch))) return { ok: false as const, reason: "This entry was approved a moment ago. Remove the approval before changing it." };
    return { ok: true as const };
  });

/** The office adds an entry for someone who did not clock in. */
export const timeAddMissed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: ChangeInput & { userId: string }) => ({ userId: uuid(d?.userId, "person"), change: change(d) }))
  .handler(async ({ data, context }) => {
    await office(context.supabase as unknown as Sb);
    const { insertEntry, timeSettings, profileExists, projectExists } = await import("./time.server");
    const { planMissedEntry } = await import("./logic");
    if (!(await profileExists(data.userId))) return { ok: false as const, reason: "Choose the person." };
    if (!(await projectExists(data.change.projectId))) return { ok: false as const, reason: "Choose the job." };
    const plan = planMissedEntry({ userId: data.userId, change: data.change, by: context.userId, now: new Date().toISOString(), increment: (await timeSettings()).rounding_minutes });
    if (!plan.ok) return { ok: false as const, reason: plan.reason };
    await insertEntry(plan.row);
    return { ok: true as const };
  });

/** Approve entries (which locks them), or remove approval from ones that have not gone to QuickBooks. */
export const timeApprove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; approve: boolean }) => {
    if (!d || !Array.isArray(d.ids) || d.ids.length > 500) throw new Error("Invalid request");
    return { ids: d.ids.map((x) => uuid(x, "entry")), approve: d.approve === true };
  })
  .handler(async ({ data, context }) => {
    await office(context.supabase as unknown as Sb);
    const { entriesByIds, setApproval } = await import("./time.server");
    const { planApprove } = await import("./logic");
    const plan = planApprove({ entries: await entriesByIds(data.ids), approve: data.approve, by: context.userId, now: new Date().toISOString() });
    const changed = await setApproval(plan.ids, plan.patch);
    return { changed, skipped: plan.skipped };
  });

type PreviewLine = { entryId: string; personName: string; projectName: string; day: string; minutes: number; billable: boolean; summary: string[] };

/** What would go to QuickBooks right now: approved entries not yet sent, as time activities. Reads only. */
export const timeQboPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as unknown as Sb;
    await sender(sb);
    const sends: PreviewLine[] = [];
    const held: { entryId: string; label: string; reason: string }[] = [];
    const { qboEnv, qboConnection } = await import("@/lib/qbo/qbo.server");
    if (!qboEnv() || !(await qboConnection())) return { ok: false as const, message: "Connect QuickBooks under Company settings → Integrations first.", sends, held };
    const { previewTimeSends } = await import("./time.server");
    const p = await previewTimeSends();
    // The billable rate is pricing: people without pricing see that it is billable, not at what rate.
    const pricing = await has(sb, "view_pricing");
    for (const s of p.sends) sends.push({ entryId: s.entryId, personName: s.personName, projectName: s.projectName, day: s.day, minutes: s.minutes, billable: s.billable, summary: pricing ? s.summary : s.summary.map((l) => (l.startsWith("Billable at") ? "Billable" : l)) });
    held.push(...p.held);
    return { ok: true as const, message: "", sends, held };
  });

/** Sends the ticked entries to QuickBooks now. Only an explicit press calls this. */
export const timeQboSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[] }) => {
    if (!d || !Array.isArray(d.ids)) throw new Error("Invalid request");
    return { ids: d.ids.slice(0, 200).map((x) => uuid(x, "entry")) };
  })
  .handler(async ({ data, context }) => {
    await sender(context.supabase as unknown as Sb);
    if (data.ids.length === 0) return { sent: 0, failed: 0, skipped: 0, held: 0 };
    const { runTimeSends } = await import("./time.server");
    try {
      return await runTimeSends(data.ids, context.userId);
    } catch (e) {
      return { sent: 0, failed: 0, skipped: 0, held: 0, message: e instanceof Error ? e.message : String(e) };
    }
  });

/** The crews, who each is linked to in QuickBooks, and a suggested match by name for those not linked. Reads only. */
export const timeQboPeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await sender(context.supabase as unknown as Sb);
    type Option = { type: "Employee" | "Vendor"; id: string; name: string };
    type Person = { id: string; name: string; link: Option | null; suggestion: Option | null };
    const people: Person[] = [];
    const options: Option[] = [];
    const { qboEnv, qboConnection } = await import("@/lib/qbo/qbo.server");
    if (!qboEnv() || !(await qboConnection())) return { ok: false as const, message: "Connect QuickBooks under Company settings → Integrations first.", people, options };
    const { crewForLinking, peopleLinks, qboPeopleOptions } = await import("./time.server");
    const { matchPeople } = await import("./qbo");
    try {
      const [crew, links, qb] = await Promise.all([crewForLinking(), peopleLinks(), qboPeopleOptions()]);
      const suggest = matchPeople(crew, qb.employees, qb.vendors);
      const linkOf = new Map(links.map((l) => [l.user_id, l]));
      for (const e of qb.employees) if (e.Id) options.push({ type: "Employee", id: String(e.Id), name: e.DisplayName || [e.GivenName, e.FamilyName].filter(Boolean).join(" ") || `Employee ${e.Id}` });
      for (const v of qb.vendors) if (v.Id) options.push({ type: "Vendor", id: String(v.Id), name: v.DisplayName || `Vendor ${v.Id}` });
      for (const c of crew) {
        const l = linkOf.get(c.id);
        const s = suggest.get(c.id);
        people.push({ id: c.id, name: c.full_name || c.email || "No name", link: l ? { type: l.qbo_type, id: l.qbo_id, name: l.qbo_name ?? l.qbo_id } : null, suggestion: !l && s ? { type: s.qbo_type, id: s.qbo_id, name: s.qbo_name ?? s.qbo_id } : null });
      }
      return { ok: true as const, message: "", people, options };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e), people, options };
    }
  });

/** Links a person to a QuickBooks employee or vendor (or removes the link). A person confirms every link; none is saved from a suggestion alone. */
export const timeQboLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; link: { type: "Employee" | "Vendor"; id: string; name: string } | null }) => {
    const l = d?.link;
    if (l && ((l.type !== "Employee" && l.type !== "Vendor") || typeof l.id !== "string" || !/^[\w-]{1,40}$/.test(l.id))) throw new Error("Invalid request");
    return { userId: uuid(d?.userId, "person"), link: l ? { qbo_type: l.type, qbo_id: l.id, qbo_name: typeof l.name === "string" ? l.name.slice(0, 200) : null } : null };
  })
  .handler(async ({ data, context }) => {
    await sender(context.supabase as unknown as Sb);
    const { savePersonLink } = await import("./time.server");
    try {
      await savePersonLink(data.userId, data.link, context.userId);
      return { ok: true as const, message: "" };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  });
