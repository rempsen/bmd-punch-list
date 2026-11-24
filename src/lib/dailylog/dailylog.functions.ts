import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adds the weather to a daily log that was just saved: conditions and temperature for the job's town on the log's day,
 * from Open-Meteo. Called after the save, so it can never hold a save up. Whatever goes wrong, the log is left marked
 * "unavailable"; weather is never made up. Returns what was stored.
 */
export const addLogWeather = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { logId: string }) => {
    if (typeof d?.logId !== "string" || !UUID.test(d.logId)) throw new Error("Invalid log");
    return { logId: d.logId };
  })
  .handler(async ({ data, context }): Promise<{ status: "ok" | "unavailable" | "skipped" }> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = context.supabase as any;
      // Read as the signed-in person: proves they may see this log.
      const { data: log } = await sb.from("daily_logs").select("id,project_id,log_date,author_id,weather_status").eq("id", data.logId).maybeSingle();
      if (!log) return { status: "skipped" };
      if (log.weather_status === "ok") return { status: "ok" };
      if (log.author_id !== context.userId) {
        const { data: office } = await sb.rpc("job_office_can", { _project: log.project_id });
        if (office !== true) return { status: "skipped" };
      }
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = supabaseAdmin as any;
      const [{ data: project }, { data: earlier }] = await Promise.all([
        admin.from("projects").select("city,province,address").eq("id", log.project_id).maybeSingle(),
        admin.from("daily_logs").select("latitude,longitude,weather_place").eq("project_id", log.project_id).not("latitude", "is", null).order("weather_fetched_at", { ascending: false }).limit(1),
      ]);
      const hit = (earlier ?? [])[0] as { latitude: number | string; longitude: number | string; weather_place: string | null } | undefined;
      const cached = hit && Number.isFinite(Number(hit.latitude)) && Number.isFinite(Number(hit.longitude)) ? { latitude: Number(hit.latitude), longitude: Number(hit.longitude), place: hit.weather_place } : null;

      const { weatherForLog } = await import("./weather");
      const { winnipegDate } = await import("./logic");
      // Each call gives up after 8 seconds.
      const timed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) });
      const patch = await weatherForLog(timed, {
        job: { city: project?.city ?? null, province: project?.province ?? null, address: project?.address ?? null },
        date: log.log_date,
        today: winnipegDate(),
        cached,
        now: new Date().toISOString(),
      });
      const { error } = await admin.from("daily_logs").update(patch).eq("id", log.id);
      if (error) {
        console.error("[daily-log] could not store weather", error.message);
        return { status: "unavailable" };
      }
      return { status: patch.weather_status };
    } catch (e) {
      console.error("[daily-log] weather failed", e instanceof Error ? e.message : e);
      return { status: "unavailable" };
    }
  });
