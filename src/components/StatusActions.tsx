import { toast } from "sonner";
import { ALLOWED_TRANSITIONS, STATUS_LABEL, type Status } from "@/lib/bmd";
import { useAuth } from "@/lib/auth";
import type { Capability } from "@/lib/roles";
import { useUpdateDeficiency } from "@/lib/data";
import { Button } from "@/components/ui/button";

export function allowedNextStatuses(
  current: Status,
  can: (c: Capability) => boolean,
  own = false,
): Status[] {
  const editor = can("edit_any_item") || (own && can("edit_own_item"));
  return (ALLOWED_TRANSITIONS[current] ?? []).filter((next) => {
    if (next === "verified") return can("verify_items");
    if (current === "awaiting_client" && (next === "accepted_as_is" || next === "fix_required"))
      return can("decide_client_items");
    if (next === "accepted_as_is") return editor || can("decide_client_items");
    if (next === "in_progress" || next === "fixed") return editor || can("add_photos");
    if (next === "fix_required")
      return editor || can("verify_items") || can("decide_client_items");
    return editor;
  });
}

export function StatusActions({
  id,
  status,
  size = "default",
  createdBy,
}: {
  id: string;
  status: Status;
  size?: "sm" | "default";
  createdBy?: string | null;
}) {
  const { can, user } = useAuth();
  const update = useUpdateDeficiency();
  const options = allowedNextStatuses(status, can, !!user && createdBy === user.id);

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
