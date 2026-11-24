import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addStandardTool, removeStandardTool, useStandardTools } from "@/lib/dailylog/data";
import { errText } from "@/lib/platform/db";

/** Company settings: the standard tool list that can be copied onto any job with one press. */
export function StandardToolsPanel() {
  const qc = useQueryClient();
  const { data: tools = [], isLoading, error } = useStandardTools();
  const [name, setName] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["standard-tools"] });
  const add = async () => {
    if (!name.trim()) return;
    try {
      await addStandardTool(name, tools);
      setName("");
      refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (id: string) => {
    try {
      await removeStandardTool(id);
      refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <section className="mt-4 max-w-xl rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase text-muted-foreground">Standard tool list</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">The tools every job usually needs. On a job, "Copy the standard list" adds these to that job's tool list.</p>
      <div className="flex gap-2">
        <Input className="h-11 flex-1" placeholder="Add a tool or item" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} aria-label="Add a standard tool" />
        <Button className="h-11" disabled={!name.trim()} onClick={() => void add()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-destructive">Could not load the list: {errText(error)}</p>
      ) : tools.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing on the list yet. Add the tools your crews take to most jobs.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {tools.map((t) => (
            <li key={t.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
              {t.name}
              <Button variant="ghost" className="h-11 w-11 p-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${t.name}`} onClick={() => void remove(t.id)}>
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
