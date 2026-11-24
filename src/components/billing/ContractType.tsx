import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { setContractType, useContractType, useOpenBookJobs, useRefreshContractType } from "@/lib/billing/data";
import { CONTRACT_TYPES, contractTypeLock, type ContractType } from "@/lib/billing/openBook";
import { dollars } from "@/lib/estimating/data";
import { db, errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

const tag = "inline-flex items-center rounded-full border border-sky-300 bg-sky-50 font-medium text-sky-900";

/** The small "Open book" tag beside a job's stage. Nothing is shown for a fixed-price job. */
export function ContractTag({ projectId, className }: { projectId: string; className?: string }) {
  const { data } = useContractType(projectId);
  return data === "open_book" ? <span className={cn(tag, "px-3 py-1 text-sm", className)}>Open book</span> : null;
}

/** For job lists: "Open book" and billed to date in place of a contract value. Null for a fixed-price job. */
export function useOpenBookValue() {
  const { data } = useOpenBookJobs();
  return (projectId: string) => data?.get(projectId) ?? null;
}
export function OpenBookValue({ billedCents }: { billedCents: number | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className={cn(tag, "px-2 py-0.5 text-xs")}>Open book</span>
      {billedCents != null && <span className="text-xs tabular-nums text-muted-foreground">{dollars(billedCents)} billed</span>}
    </span>
  );
}

/** The one question asked when a job is created: fixed price or open book. */
export function ContractTypeField({ value, onChange }: { value: ContractType; onChange: (v: ContractType) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">How is this job billed?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {CONTRACT_TYPES.map((t) => (
          <label key={t.value} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm", value === t.value ? "border-primary bg-primary/5" : "border-border")}>
            <input type="radio" name="contract_type" className="mt-0.5 h-5 w-5" checked={value === t.value} onChange={() => onChange(t.value)} />
            <span>
              <span className="font-medium">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** After a job is created: record that it is open book. A fixed-price job needs nothing, it is what every job starts as. */
export async function applyContractType(projectId: string, type: ContractType) {
  if (type !== "open_book") return;
  try {
    await setContractType(projectId, type);
  } catch (e) {
    toast.error(`The job was created as fixed price. Set it to open book on its Overview. (${errText(e)})`);
  }
}

/** On the job's Overview: how the job is billed, with billed to date for an open-book job, and the change (until a bill is issued). */
export function ContractTypeFact({ projectId, estimatedValue }: { projectId: string; estimatedValue: string }) {
  const { canAny } = useAuth();
  const { data: type } = useContractType(projectId);
  const value = useOpenBookValue()(projectId);
  const refresh = useRefreshContractType();
  const canChange = canAny("manage_projects");
  const pricing = canAny("view_pricing");
  const { data: bills } = useQuery({
    queryKey: ["bills", projectId, "statuses"],
    enabled: canChange && pricing && !!type,
    queryFn: async () => {
      const { data } = await db.from("progress_bills").select("status").eq("project_id", projectId);
      return (data ?? []) as { status: string }[];
    },
  });
  const [busy, setBusy] = useState(false);
  if (!type)
    return (
      <div>
        <dt className="text-xs text-muted-foreground">Estimated value</dt>
        <dd>{estimatedValue}</dd>
      </div>
    );
  const lock = bills ? contractTypeLock(bills) : null;
  const other: ContractType = type === "open_book" ? "fixed" : "open_book";
  const change = async () => {
    if (!window.confirm(other === "open_book" ? "Make this an open-book job? It will be billed from hours and supplier invoices instead of against a quote." : "Make this a fixed-price job? It will be billed against its accepted quote.")) return;
    setBusy(true);
    try {
      await setContractType(projectId, other);
      toast.success(other === "open_book" ? "This is now an open-book job." : "This is now a fixed-price job.");
      refresh(projectId);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {type === "open_book" ? (
        <div>
          <dt className="text-xs text-muted-foreground">Contract value</dt>
          <dd><OpenBookValue billedCents={pricing ? (value?.billedCents ?? null) : null} /></dd>
        </div>
      ) : (
        <div>
          <dt className="text-xs text-muted-foreground">Estimated value</dt>
          <dd>{estimatedValue}</dd>
        </div>
      )}
      <div>
        <dt className="text-xs text-muted-foreground">Contract type</dt>
        <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {type === "open_book" ? "Open book (time and materials)" : "Fixed price"}
          {canChange && !lock && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void change()}>
              Change to {other === "open_book" ? "open book" : "fixed price"}
            </Button>
          )}
        </dd>
        {canChange && lock && <dd className="text-xs text-muted-foreground">{lock}</dd>}
      </div>
    </>
  );
}
