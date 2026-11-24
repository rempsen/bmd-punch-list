import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { shiftWeek, thisMonday } from "@/lib/scheduling/logic";
import { DEFAULT_TIME_SETTINGS, weekBounds, type ClockJob, type Location, type PersonRate, type TimeEntry, type TimeSettings } from "./logic";

const COLS =
  "id,user_id,project_id,clock_in_at,clock_out_at,rounded_minutes,in_lat,in_lng,in_accuracy_m,out_lat,out_lng,out_accuracy_m,note_in,note_out,source,original,adjusted_at,adjusted_by,adjust_reason,approved_at,approved_by,qbo_time_activity_id,qbo_sent_at,qbo_error,qbo_attempts";
export type EntryWithJob = TimeEntry & { project: { id: string; name: string; project_number: string | null } | null };
export type TimePerson = { id: string; full_name: string | null; email: string | null; clocks: boolean };

/** Whether the time clock is for this person: they go to site, or they are the office. False until the database says yes. */
export function useMayClock(enabled = true) {
  return useQuery({
    queryKey: ["time", "access"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await db.rpc("time_clock_access");
      return !error && data === true;
    },
  });
}

export function useTimeSettings() {
  return useQuery({
    queryKey: ["time", "settings"],
    staleTime: 60_000,
    queryFn: async (): Promise<TimeSettings> => {
      const { data, error } = await db.from("time_settings").select("rounding_minutes,overtime_daily_minutes,overtime_weekly_minutes").eq("id", 1).maybeSingle();
      if (error) throw error;
      return { ...DEFAULT_TIME_SETTINGS, ...((data as Partial<TimeSettings> | null) ?? {}) };
    },
  });
}
export async function saveTimeSettings(s: TimeSettings) {
  const { error } = await db.from("time_settings").update({ ...s, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}

/** The signed-in person's entries for this week and last week, newest first, plus anything still open. */
export function useMyTime(userId: string | undefined) {
  return useQuery({
    queryKey: ["time", "mine", userId],
    enabled: !!userId,
    queryFn: async (): Promise<EntryWithJob[]> => {
      const from = weekBounds(shiftWeek(thisMonday(), -1)).from;
      const { data, error } = await db.from("time_entries").select(`${COLS},project:projects(id,name,project_number)`).eq("user_id", userId!).or(`clock_in_at.gte.${from},clock_out_at.is.null`).order("clock_in_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as EntryWithJob[];
    },
  });
}

/** Jobs the person can see, for choosing where to clock in. Reads every column so a job `kind` is picked up once it exists. */
export function useClockJobs(enabled = true) {
  return useQuery({
    queryKey: ["time", "jobs"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ClockJob[]> => {
      const { data, error } = await db.from("projects").select("*").is("archived_at", null).order("name").limit(1000);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((p) => ({ id: String(p["id"]), name: String(p["name"] ?? ""), project_number: (p["project_number"] as string | null) ?? null, stage: (p["stage"] as string | null) ?? null, archived_at: (p["archived_at"] as string | null) ?? null, kind: typeof p["kind"] === "string" ? (p["kind"] as string) : null }));
    },
  });
}

/** Everyone's entries for one Monday-to-Sunday week (Winnipeg). */
export function useWeekEntries(monday: string, enabled = true) {
  return useQuery({
    queryKey: ["time", "week", monday],
    enabled,
    queryFn: async (): Promise<EntryWithJob[]> => {
      const b = weekBounds(monday);
      const { data, error } = await db.from("time_entries").select(`${COLS},project:projects(id,name,project_number)`).gte("clock_in_at", b.from).lt("clock_in_at", b.to).order("clock_in_at").limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as EntryWithJob[];
    },
  });
}

export function useTimePeople(enabled = true) {
  return useQuery({
    queryKey: ["time", "people"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<TimePerson[]> => {
      const { data, error } = await db.rpc("time_people");
      if (error) throw error;
      return (data ?? []) as TimePerson[];
    },
  });
}

/** Hourly cost and billable rate per person. Only people who see pricing get any rows back. */
export function useRates(enabled: boolean) {
  return useQuery({
    queryKey: ["time", "rates"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, PersonRate>> => {
      const { data, error } = await db.from("person_rates").select("user_id,hourly_cost_cents,billable_rate_cents");
      if (error) throw error;
      return new Map(((data ?? []) as (PersonRate & { user_id: string })[]).map((r) => [r.user_id, r]));
    },
  });
}

/** Names of the people clocked in on a job right now (office only). Empty until the time clock tables exist. */
export function useClockedIn(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["time", "clocked-in", projectId],
    enabled: enabled && !!projectId,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db.rpc("time_clocked_in", { _project: projectId });
      if (error) return [];
      return ((data ?? []) as { full_name: string | null }[]).map((r) => r.full_name ?? "Someone");
    },
  });
}

export function useRefreshTime() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["time"] });
}

/**
 * One location reading, asked for at the moment of clocking in or out and never again in between.
 * Null when the person refuses, the phone cannot tell, or it takes longer than 12 seconds: the entry is saved anyway.
 */
export function readLocation(): Promise<Location | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    const timer = setTimeout(() => resolve(null), 12_000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

/** A load failure in plain words. Before the time clock's tables exist the database's own message is jargon. */
export function timeLoadError(e: unknown): string {
  const m = e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
  return /schema cache|does not exist/i.test(m) ? "The time clock has not been switched on in the database yet." : m;
}
