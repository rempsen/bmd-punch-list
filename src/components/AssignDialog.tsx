import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { personName, useProjectPeople } from "@/lib/assign";
import { useDeficiencies, useInvalidateDeficiencies } from "@/lib/data";
import { roleLabel } from "@/lib/roles";

export function AssignDialog({
  open,
  onOpenChange,
  ids,
  initialPerson,
  initialTrade,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: string[];
  initialPerson?: string | null;
  initialTrade?: string | null;
  onDone?: () => void;
}) {
  const { projectId } = useAuth();
  const { data: people = [] } = useProjectPeople(projectId);
  const { data: items = [] } = useDeficiencies(projectId ?? undefined);
  const invalidate = useInvalidateDeficiencies();
  const [person, setPerson] = useState("none");
  const [trade, setTrade] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPerson(initialPerson ?? "none");
      setTrade(initialTrade ?? "");
    }
  }, [open, initialPerson, initialTrade]);

  const trades = [...new Set([...items.map((d) => d.assigned_trade), ...people.map((p) => p.company)].filter((t): t is string => !!t?.trim()))].sort();

  const pickPerson = (v: string) => {
    setPerson(v);
    const company = people.find((p) => p.id === v)?.company;
    if (v !== "none" && company) setTrade(company);
  };

  const save = async (clear = false) => {
    setBusy(true);
    const patch = clear
      ? { assigned_to: null, assigned_trade: null }
      : { assigned_to: person === "none" ? null : person, assigned_trade: trade.trim() || null };
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
    else toast.success(clear ? "Assignment cleared" : ids.length > 1 ? `${ids.length} items assigned` : "Item assigned");
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ids.length > 1 ? `Assign ${ids.length} items` : "Assign item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Person</Label>
            <Select value={person} onValueChange={pickPerson}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No person</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {personName(p)}
                    <span className="text-muted-foreground">
                      {" "}· {roleLabel(p.role)}
                      {p.company ? ` · ${p.company}` : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assign-trade">Trade / company</Label>
            <Input
              id="assign-trade"
              list="assign-trades"
              className="h-11"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              placeholder="e.g. ABC Tile Ltd."
            />
            <datalist id="assign-trades">
              {trades.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">Filled from the person's company. You can change it.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
            Unassign
          </Button>
          <Button disabled={busy || (person === "none" && !trade.trim())} onClick={() => void save()}>
            {busy ? "Saving…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
