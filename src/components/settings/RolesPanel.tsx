import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { CAPABILITIES, ROLES, type AppRole } from "@/lib/roles";

const key = (r: string, c: string) => `${r}:${c}`;

export function RolesPanel() {
  const qc = useQueryClient();
  const { refreshPermissions } = useAuth();
  const { data, refetch } = useQuery({
    queryKey: ["role_permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_permissions").select("role,capability,allowed");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const [grid, setGrid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const g: Record<string, boolean> = {};
    for (const r of data) g[key(r.role, r.capability)] = r.allowed;
    setGrid(g);
  }, [data]);

  const after = async () => {
    await refetch();
    await refreshPermissions();
    void qc.invalidateQueries();
  };

  const save = async () => {
    setSaving(true);
    const rows = ROLES.flatMap((r) =>
      CAPABILITIES.map((c) => ({
        role: r.value,
        capability: c.value,
        allowed: r.value === "super_admin" ? true : !!grid[key(r.value, c.value)],
      })),
    );
    const { error } = await supabase.from("role_permissions").upsert(rows, { onConflict: "role,capability" });
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Permissions saved");
      await after();
    }
  };

  const reset = async () => {
    if (!confirm("Reset every role to the default permissions?")) return;
    const { error } = await supabase.rpc("reset_role_permissions");
    if (error) toast.error(error.message);
    else {
      toast.success("Permissions reset to defaults");
      await after();
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase">Roles &amp; permissions</h2>
          <p className="text-xs text-muted-foreground">
            Changes apply immediately to the app and the database. Super admin always has everything.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11" onClick={() => void reset()}>
            Reset to defaults
          </Button>
          <Button className="h-11" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase">
              <th className="py-2 pr-3 text-left">Capability</th>
              {ROLES.map((r) => (
                <th key={r.value} className="px-2 py-2 text-center">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((c) => (
              <tr key={c.value} className="border-b border-border">
                <td className="py-2 pr-3">{c.label}</td>
                {ROLES.map((r) => {
                  const locked = r.value === ("super_admin" as AppRole);
                  return (
                    <td key={r.value} className="px-2 py-2 text-center">
                      <Checkbox
                        aria-label={`${r.label}: ${c.label}`}
                        className="h-5 w-5"
                        checked={locked ? true : !!grid[key(r.value, c.value)]}
                        disabled={locked}
                        onCheckedChange={(v) => setGrid((g) => ({ ...g, [key(r.value, c.value)]: v === true }))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
