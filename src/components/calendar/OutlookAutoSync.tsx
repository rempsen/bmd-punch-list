import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { calendarSyncNow } from "@/lib/calendar/calendar.functions";
import { calendarKey, useCalendar } from "@/lib/calendar/data";
import { dueForSync } from "@/lib/calendar/feed";

/**
 * Shows nothing. When someone who has connected their Outlook calendar opens Scheduling, and their last sync was 15
 * minutes ago or more, it syncs quietly. There is no background schedule; this and the Sync button are the only triggers.
 */
export function OutlookAutoSync() {
  const { user } = useAuth();
  const onScheduling = useRouterState({ select: (s) => s.location.pathname.startsWith("/scheduling") });
  const { data: cal } = useCalendar(onScheduling ? user?.id : null);
  const syncFn = useServerFn(calendarSyncNow);
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!onScheduling || !user?.id || !cal?.outlook_enabled || running.current || !dueForSync(cal.outlook_synced_at)) return;
    running.current = true;
    void syncFn({ data: { force: false } })
      .catch(() => null)
      .then(() => qc.invalidateQueries({ queryKey: calendarKey(user.id) }))
      .finally(() => {
        // Whatever happened, do not try again until the person next opens Scheduling.
        setTimeout(() => (running.current = false), 60_000);
      });
  }, [onScheduling, user?.id, cal?.outlook_enabled, cal?.outlook_synced_at, syncFn, qc]);

  return null;
}
