import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Whether this person can be scheduled on visits (Staff under Crews), whatever their access level. Saves as soon as it is ticked. */
export function GoesToSite({ userId, name, disabled }: { userId: string; name: string; disabled: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", "goes-to-site", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_access").select("goes_to_site").eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return !!(data as { goes_to_site?: boolean } | null)?.goes_to_site;
    },
  });
  const set = async (on: boolean) => {
    const { error } = await supabase.rpc("set_goes_to_site" as never, { _user: userId, _on: on } as never);
    if (error) return void toast.error(error.message);
    toast.success(on ? `${name} can now be scheduled on visits` : `${name} is no longer offered when scheduling`);
    void qc.invalidateQueries({ queryKey: ["admin-users", "goes-to-site", userId] });
    void qc.invalidateQueries({ queryKey: ["technicians"] });
  };
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!data} disabled={disabled || isLoading} onChange={(e) => void set(e.target.checked)} />
      <span>
        <span className="font-medium">Goes to site</span>
        <span className="block text-xs text-muted-foreground">Lists them under Staff when a visit is scheduled and on Crews and Subcontractors. It does not change what they can see or do.</span>
      </span>
    </label>
  );
}
