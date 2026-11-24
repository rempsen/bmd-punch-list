import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FeedScope } from "./feed";

/** A person's calendar settings as the browser may read them. The link's token is never stored, so it is not here. */
export type MyCalendar = {
  user_id: string;
  scope: FeedScope;
  project_id: string | null;
  link_created_at: string | null;
  link_last_used_at: string | null;
  outlook_enabled: boolean;
  outlook_synced_at: string | null;
  outlook_error: string | null;
};
const COLS = "user_id,scope,project_id,link_created_at,link_last_used_at,outlook_enabled,outlook_synced_at,outlook_error";
// The calendar tables and functions are newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export const calendarKey = (userId: string | null | undefined) => ["calendar-feed", userId ?? null] as const;

/** One person's calendar settings: your own, or (for someone who manages users) another person's. Null when they have none. */
export function useCalendar(userId: string | null | undefined) {
  return useQuery({
    queryKey: calendarKey(userId),
    enabled: !!userId,
    queryFn: async (): Promise<MyCalendar | null> => {
      const { data, error } = await sb.from("calendar_feeds").select(COLS).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as MyCalendar | null) ?? null;
    },
  });
}

export async function saveCalendarChoice(scope: FeedScope, projectId: string | null): Promise<void> {
  const { error } = await sb.rpc("calendar_feed_save", { _scope: scope, _project: projectId });
  if (error) throw new Error(error.message);
}

/** Turns the link on (or makes a new one) and returns its token, which can only be read this once; or turns it off. */
export async function setCalendarLink(on: boolean): Promise<string | null> {
  const { data, error } = await sb.rpc("calendar_feed_link", { _on: on });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function revokeCalendarLink(userId: string): Promise<void> {
  const { error } = await sb.rpc("calendar_feed_revoke", { _user: userId });
  if (error) throw new Error(error.message);
}
