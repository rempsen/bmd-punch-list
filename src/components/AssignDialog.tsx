import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useProjectPeople } from "@/lib/assign";
import { assigneePatch, assigneeValue, ResponsibleFields } from "@/components/ResponsibleFields";
import { normResp, type Responsible } from "@/lib/responsible";
import { useInvalidateDeficiencies } from "@/lib/data";

export function AssignDialog({
  open,
  onOpenChange,
  ids,
  initialPerson,
  initialTrade,
  initialResponsible,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: string[];
  initialPerson?: string | null;
  initialTrade?: string | null;
  initialResponsible?: string | null;
  onDone?: () => void;
}) {
  const { projectId } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const invalidate = useInvalidateDeficiencies();
  const [responsible, setResponsible] = useState<Responsible>("unassigned");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setResponsible(normResp(initialResponsible));
      setAssignee(assigneeValue({ assigned_to: initialPerson ?? null, assigned_trade: initialTrade ?? null }));
    }
  }, [open, initialPerson, initialTrade, initialResponsible]);

  const save = async (clear = false) => {
    setBusy(true);
    const patch = clear
      ? { assigned_to: null, assigned_trade: null, responsible_party: "unassigned" }
      : { ...assigneePatch(assignee, people), responsible_party: normResp(responsible) };
    let failed = 0;
    let msg = "";
    for (const id of ids) {
      const { error } = await supabase.from("deficiencies").update(patch as never).eq("id", id);
      if (error) {
        failed += 1;
        msg = error.message;
      }
    }
    setBusy(false);
    invalidate();
    if (failed) toast.error(`${failed} item(s) could not be assigned: ${msg}`);
    else toast.success(clear ? "Assignment cleared" : ids.length > 1 ? `${ids.length} items updated` : "Item updated");
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ids.length > 1 ? `Assign ${ids.length} items` : "Responsible party & assignee"}</DialogTitle>
        </DialogHeader>
        <ResponsibleFields
          large
          projectId={projectId}
          responsible={responsible}
          onResponsible={setResponsible}
          assignee={assignee}
          onAssignee={setAssignee}
        />
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
            Unassign
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
