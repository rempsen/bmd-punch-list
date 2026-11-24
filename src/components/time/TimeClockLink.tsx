import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMayClock } from "@/lib/time/data";

/** Whether the time clock is offered to the signed-in person: the office, or anyone who goes to site. */
export function useShowTimeClock(): boolean {
  const { canAny, user } = useAuth();
  const office = canAny("manage_projects");
  const access = useMayClock(!!user && !office);
  return office || access.data === true;
}

/** One-tap way to the time clock from the phone's top bar. Renders nothing for people who do not clock in. */
export function TimeClockLink({ className }: { className?: string }) {
  if (!useShowTimeClock()) return null;
  return (
    <Link to="/time" className={className} aria-label="Time clock">
      <Clock className="h-5 w-5" />
    </Link>
  );
}
