import { assessmentMeta, statusBadgeClass, STATUS_LABEL, type Assessment, type Status } from "@/lib/bmd";
import { cn } from "@/lib/utils";

export function AssessmentBadge({ value, className }: { value: Assessment; className?: string }) {
  const meta = assessmentMeta(value);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function StatusBadge({ value, className }: { value: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        statusBadgeClass(value),
        className,
      )}
    >
      {STATUS_LABEL[value]}
    </span>
  );
}
