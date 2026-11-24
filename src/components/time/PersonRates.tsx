import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/platform/db";
import { dollarsToCents } from "@/lib/time/logic";

type Field = "hourly_cost_cents" | "billable_rate_cents";
const show = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));

/**
 * A person's hourly cost and default billable rate, in dollars. Only for people who both manage users and see pricing;
 * everyone else gets nothing here. Each box saves when you leave it. Blank means unknown, which is never treated as zero.
 */
export function PersonRates({ userId, name, disabled }: { userId: string; name: string; disabled: boolean }) {
  const { canAny } = useAuth();
  const allowed = canAny("manage_users") && canAny("view_pricing");
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["time", "rates", "person", userId],
    enabled: allowed,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.from("person_rates").select("hourly_cost_cents,billable_rate_cents").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return (data ?? { hourly_cost_cents: null, billable_rate_cents: null }) as Record<Field, number | null>;
    },
  });
  const [text, setText] = useState<Record<Field, string>>({ hourly_cost_cents: "", billable_rate_cents: "" });
  useEffect(() => {
    if (data) setText({ hourly_cost_cents: show(data.hourly_cost_cents), billable_rate_cents: show(data.billable_rate_cents) });
  }, [data]);
  if (!allowed) return null;

  const save = async (field: Field) => {
    const parsed = dollarsToCents(text[field]);
    if (!parsed.ok) return void toast.error("Enter a dollar amount, or leave it blank if it is not known.");
    if (!data || parsed.cents === data[field]) return;
    const { data: auth } = await db.auth.getUser();
    const { error } = await db.from("person_rates").upsert({ user_id: userId, [field]: parsed.cents, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null }, { onConflict: "user_id" });
    if (error) return void toast.error(error.message);
    const what = field === "hourly_cost_cents" ? "hourly cost" : "billable rate";
    toast.success(parsed.cents == null ? `${name}'s ${what} is now unknown` : `${name}'s ${what} saved`);
    void qc.invalidateQueries({ queryKey: ["time", "rates"] });
  };
  const box = (field: Field, label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`rate-${field}`}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input id={`rate-${field}`} className="h-11 pl-7" inputMode="decimal" placeholder="Unknown" disabled={disabled || isLoading || !!error} value={text[field]} onChange={(e) => setText((t) => ({ ...t, [field]: e.target.value }))} onBlur={() => void save(field)} />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Labour rates</h3>
      {error ? (
        <p className="text-sm text-muted-foreground">Rates are not available yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {box("hourly_cost_cents", "Hourly cost", "What an hour of their time costs the company. Used for labour cost on timesheets.")}
          {box("billable_rate_cents", "Default billable rate", "What an hour of their time is billed at, unless a job says otherwise.")}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Leave a box blank when the amount is not known. Crews never see these.</p>
    </section>
  );
}
