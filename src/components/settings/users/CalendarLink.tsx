import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { calendarKey, revokeCalendarLink, useCalendar } from "@/lib/calendar/data";

/** Whether this person has a private calendar link turned on, and a way to turn it off. Shows the date only: never the link. */
export function CalendarLink({ userId, name, disabled }: { userId: string; name: string; disabled: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useCalendar(userId);
  const [busy, setBusy] = useState(false);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  // Before the calendar tables exist, or if they cannot be read, say nothing misleading.
  if (error) return <p className="text-sm text-muted-foreground">Calendar link status is not available.</p>;
  if (!data?.link_created_at) return <p className="text-sm text-muted-foreground">No calendar link turned on.</p>;

  const revoke = async () => {
    if (!window.confirm(`Turn off ${name}'s calendar link? Calendars that use it stop updating straight away. They can turn on a new one themselves.`)) return;
    setBusy(true);
    try {
      await revokeCalendarLink(userId);
      await qc.invalidateQueries({ queryKey: calendarKey(userId) });
      toast.success(`${name}'s calendar link is off`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not turn the link off");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        <span className="font-medium">Calendar link on</span>
        <span className="block text-xs text-muted-foreground">Since {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(data.link_created_at))}. It shows their visits in their own calendar app.</span>
      </p>
      <Button variant="outline" className="h-11" disabled={disabled || busy} onClick={() => void revoke()}>
        Turn off link
      </Button>
    </div>
  );
}
