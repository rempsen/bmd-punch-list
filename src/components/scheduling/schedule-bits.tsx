/** Small marks shared by the Scheduling screens: crew confirmation, "Day 2 of 3", Tentative. */
import { Check, X } from "lucide-react";
import { confirmationOf, type Confirmation } from "@/lib/scheduling/assignments";
import { runLabel } from "@/lib/scheduling/runs";

const PILL: Record<Confirmation, string> = {
  confirmed: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
  declined: "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100",
  waiting: "border-border bg-muted text-foreground",
  not_sent: "border-dashed border-border text-muted-foreground",
};

/** Confirmed / Can't make it / Waiting / Not sent, as a pill. */
export function ConfirmationPill({ v }: { v: { confirmation?: string | null } }) {
  const c = confirmationOf(v);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${PILL[c.state]}`}>
      {c.state === "confirmed" && <Check className="h-3 w-3" aria-hidden />}
      {c.state === "declined" && <X className="h-3 w-3" aria-hidden />}
      {c.label}
    </span>
  );
}

/** The small mark on a chip: a tick for confirmed, a cross for can't make it, nothing otherwise. */
export function ConfirmationMark({ v }: { v: { confirmation?: string | null } }) {
  const c = confirmationOf(v);
  if (c.state === "confirmed")
    return (
      <span title="Crew confirmed" aria-label="Crew confirmed" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Check className="h-3 w-3" aria-hidden />
      </span>
    );
  if (c.state === "declined")
    return (
      <span title="Crew can't make it" aria-label="Crew can't make it" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-black">
        <X className="h-3 w-3" aria-hidden />
      </span>
    );
  return null;
}

/** "Day 2 of 3" and "Tentative", for a chip or a list row. Nothing for an ordinary firm visit. */
export function VisitTags({ v, className = "" }: { v: { run_day?: number | null; run_total?: number | null; tentative?: boolean | null }; className?: string }) {
  const run = runLabel(v);
  if (!run && !v.tentative) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {run && <span className="whitespace-nowrap rounded bg-foreground/10 px-1 text-[10px] font-semibold">{run}</span>}
      {v.tentative && <span className="whitespace-nowrap rounded border border-dashed border-current px-1 text-[10px] font-semibold">Tentative</span>}
    </span>
  );
}
