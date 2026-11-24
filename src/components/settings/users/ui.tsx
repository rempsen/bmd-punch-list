import type { UserStatus } from "@/lib/users/logic";
import { cn } from "@/lib/utils";
import { STATUS } from "./format";

export function StatusBadge({ status }: { status: UserStatus }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

