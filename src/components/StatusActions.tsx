import { toast } from "sonner";
import { ALLOWED_TRANSITIONS, STATUS_LABEL, type Status } from "@/lib/bmd";
import { useAuth } from "@/lib/auth";
import { useUpdateDeficiency } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function allowedNextStatuses(
  current: Status,
  opts: { isAdmin: boolean; isClient: boolean; isField: boolean },
): Status[] {
  return (ALLOWED_TRANSITIONS[current] ?? []).filter((next) => {
    if (next === "verified") return opts.isAdmin || opts.isClient;
    if (next === "accepted_as_is") return opts.isAdmin || opts.isClient;
    if (opts.isClient && !opts.isAdmin) return next === "fix_required";
    return true;
  });
}

export function StatusActions({
  id,
  status,
  size = "default",
}: {
  id: string;
  status: Status;
  size?: "sm" | "default";
}) {
  const { isAdmin, isClient, isField } = useAuth();
  const update = useUpdateDeficiency();
  const options = allowedNextStatuses(status, { isAdmin, isClient, isField });

  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((next) => (
        <Button
          key={next}
          size={size}
          variant={next === "fix_required" ? "destructive" : "secondary"}
          className={size === "default" ? "h-11" : undefined}
          onClick={() =>
            update.mutate(
              { id, patch: { status: next } },
              {
                onSuccess: () => toast.success(`Moved to ${STATUS_LABEL[next]}`),
                onError: (e) => toast.error(e.message),
              },
            )
          }
        >
          {STATUS_LABEL[next]}
        </Button>
      ))}
    </div>
  );
}
