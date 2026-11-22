import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errText } from "@/lib/platform/db";
import { moveProjectStage, type PipelineProject } from "@/lib/projects/data";
import { LOST_REASONS, STAGES, validateMove, type ProjectStage } from "@/lib/projects/stages";
import { cn } from "@/lib/utils";

/** Move a project to another stage. `to` preselects the target (used after a drag on the board). */
export function MoveStageDialog({
  project,
  to,
  onClose,
  onMoved,
}: {
  project: PipelineProject;
  to?: ProjectStage;
  onClose: () => void;
  onMoved: (stage: ProjectStage) => void;
}) {
  const [stage, setStage] = useState<ProjectStage>(to ?? project.stage);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = validateMove(stage, reason);
  const unchanged = stage === project.stage;

  const save = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await moveProjectStage(project.id, stage, stage === "lost" ? reason : null, note.trim() || null);
      toast.success(`Moved to ${STAGES.find((s) => s.value === stage)?.label}`);
      onMoved(stage);
    } catch (e) {
      toast.error(`Could not move: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move project</DialogTitle>
          <DialogDescription>
            {project.project_number ? `${project.project_number} · ` : ""}
            {project.name}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Stage</Label>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <Chip key={s.value} on={stage === s.value} onClick={() => setStage(s.value)}>
                  {s.label}
                  {s.value === project.stage ? " (now)" : ""}
                </Chip>
              ))}
            </div>
          </div>
          {stage === "lost" && (
            <div className="grid gap-1.5">
              <Label>Why was it lost?</Label>
              <div className="flex flex-wrap gap-2">
                {LOST_REASONS.map((r) => (
                  <Chip key={r.value} on={reason === r.value} onClick={() => setReason(r.value)}>
                    {r.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="move-note">Note (optional)</Label>
            <Textarea id="move-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || unchanged || !!problem}>
            {busy ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
