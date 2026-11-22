import { stageLabel, type ProjectStage } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

const TONE: Record<ProjectStage, string> = {
  opportunity: "bg-slate-100 text-slate-800",
  estimating: "bg-blue-100 text-blue-900",
  quote_out: "bg-amber-100 text-amber-900",
  won: "bg-emerald-100 text-emerald-900",
  in_progress: "bg-teal-100 text-teal-900",
  closed: "bg-zinc-200 text-zinc-800",
  lost: "bg-rose-100 text-rose-900",
};

export function StageBadge({ stage, className }: { stage: ProjectStage; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONE[stage], className)}>
      {stageLabel(stage)}
    </span>
  );
}
