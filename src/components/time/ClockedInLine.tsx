import { Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useClockedIn } from "@/lib/time/data";
import { clockedInLine } from "@/lib/time/logic";

/** "2 clocked in: Ana, Ben" on a job, for the office. Shows nothing when nobody is clocked in. */
export function ClockedInLine({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const { data } = useClockedIn(projectId, canAny("manage_projects"));
  const line = clockedInLine(data ?? []);
  if (!line) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Clock className="h-4 w-4 shrink-0" aria-hidden /> {line}
    </p>
  );
}
