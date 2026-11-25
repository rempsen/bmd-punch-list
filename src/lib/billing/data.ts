/** Reads and writes for open-book jobs. Until migration 0087 is applied these read as "every job is fixed price". */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { NO_TERMS, type ContractType, type LabourEntry, type MaterialEntry, type NamedRate, type Terms } from "./openBook";
import { mayEditBill } from "./editor";

export function useBillPermission(projectId: string) {
  return useQuery({ queryKey: ["bill-permissions", projectId], queryFn: async () => {
    const [manage, price] = await Promise.all([db.rpc("has_capability", { _capability: "manage_projects", _project: projectId }), db.rpc("has_capability", { _capability: "view_pricing", _project: projectId })]);
    return mayEditBill(manage.data === true && !manage.error, price.data === true && !price.error);
  }});
}

/** A job's contract type. Anything unreadable counts as fixed price, which is what every job was before. */
export function useContractType(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["contract-type", projectId],
    enabled: !!projectId,
    staleTime: 60_000,
    queryFn: async (): Promise<ContractType> => {
      const { data, error } = await db.from("projects").select("contract_type").eq("id", projectId!).maybeSingle();
      return !error && (data as { contract_type?: string } | null)?.contract_type === "open_book" ? "open_book" : "fixed";
    },
  });
}

export async function setContractType(projectId: string, to: ContractType) {
  const { data, error } = await db.from("projects").update({ contract_type: to }).eq("id", projectId).select("id");
  if (error) throw new Error(error.message);
  // No row back means the person may not change this job: say so instead of leaving the job quietly unchanged.
  if (!data?.length) throw new Error("You don't have access to change this job's contract type.");
}

export function useRefreshContractType() {
  const qc = useQueryClient();
  return (projectId: string) => {
    void qc.invalidateQueries({ queryKey: ["contract-type", projectId] });
    void qc.invalidateQueries({ queryKey: ["open-book-jobs"] });
  };
}

/** Open-book jobs the person can see, with billed to date (null without pricing access). Used by the job lists. */
export function useOpenBookJobs() {
  return useQuery({
    queryKey: ["open-book-jobs"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("open_book_jobs");
      const rows = error ? [] : ((data ?? []) as { project_id: string; billed_cents: number | null }[]);
      return new Map(rows.map((r) => [r.project_id, { billedCents: r.billed_cents == null ? null : Number(r.billed_cents) }]));
    },
  });
}

type TermsRow = { materials_markup_pct: number | null; labour_rate_cents: number | null; named_rates: NamedRate[] | null; holdback_applies: boolean };
export function useOpenBookTerms(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["open-book-terms", projectId],
    enabled,
    queryFn: async (): Promise<Terms> => {
      const { data, error } = await db.from("open_book_terms").select("materials_markup_pct,labour_rate_cents,named_rates,holdback_applies").eq("project_id", projectId).maybeSingle();
      if (error) throw error;
      const t = data as TermsRow | null;
      if (!t) return NO_TERMS;
      return { markupPct: t.materials_markup_pct == null ? null : Number(t.materials_markup_pct), labourRateCents: t.labour_rate_cents == null ? null : Number(t.labour_rate_cents), namedRates: (t.named_rates ?? []).filter((r) => r && r.name && r.rateCents > 0), holdbackApplies: t.holdback_applies };
    },
  });
}

export const saveOpenBookTerms = (projectId: string, t: Terms) =>
  db.from("open_book_terms").upsert({ project_id: projectId, materials_markup_pct: t.markupPct, labour_rate_cents: t.labourRateCents, named_rates: t.namedRates, holdback_applies: t.holdbackApplies, updated_at: new Date().toISOString() });

type LabourRow = { id: string; description: string; work_date: string; work_date_end: string | null; hours: number; rate_cents: number; rate_name: string | null; bill_id: string | null };
export type LabourRecord = LabourEntry & { rateName: string | null };
type MaterialRow = { id: string; supplier_id: string | null; supplier_name: string; invoice_number: string; invoice_date: string; amount_cents: number; markup_pct: number | null; markup_note: string | null; document_id: string | null; bill_id: string | null; document: { file_name: string } | null };
export type MaterialRecord = MaterialEntry & { supplierId: string | null; documentId: string | null };

export function useOpenBookEntries(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["open-book-entries", projectId],
    enabled,
    queryFn: async (): Promise<{ labour: LabourRecord[]; materials: MaterialRecord[] }> => {
      const [l, m] = await Promise.all([
        db.from("open_book_labour").select("id,description,work_date,work_date_end,hours,rate_cents,rate_name,bill_id").eq("project_id", projectId).order("work_date").order("created_at"),
        db.from("open_book_materials").select("id,supplier_id,supplier_name,invoice_number,invoice_date,amount_cents,markup_pct,markup_note,document_id,bill_id,document:project_documents(file_name)").eq("project_id", projectId).order("invoice_date").order("created_at"),
      ]);
      if (l.error) throw l.error;
      if (m.error) throw m.error;
      return {
        labour: ((l.data ?? []) as LabourRow[]).map((r) => ({ id: r.id, description: r.description, workDate: r.work_date, workDateEnd: r.work_date_end, hours: Number(r.hours), rateCents: Number(r.rate_cents), rateName: r.rate_name, billId: r.bill_id })),
        materials: ((m.data ?? []) as unknown as MaterialRow[]).map((r) => ({ id: r.id, supplierId: r.supplier_id, supplierName: r.supplier_name, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date, amountCents: Number(r.amount_cents), markupPct: r.markup_pct == null ? null : Number(r.markup_pct), markupNote: r.markup_note, documentId: r.document_id, attachmentName: r.document?.file_name ?? null, billId: r.bill_id })),
      };
    },
  });
}

export type LabourWrite = { description: string; workDate: string; workDateEnd: string | null; hours: number; rateCents: number; rateName: string | null; sourceRef?: string };
export const addLabour = (projectId: string, rows: LabourWrite[]) =>
  db.from("open_book_labour").insert(rows.map((w) => ({ project_id: projectId, description: w.description.trim(), work_date: w.workDate, work_date_end: w.workDateEnd, hours: w.hours, rate_cents: w.rateCents, rate_name: w.rateName, source_ref: w.sourceRef ?? null })));
export const removeLabour = (id: string) => db.from("open_book_labour").delete().eq("id", id);

export type MaterialWrite = { supplierId: string | null; supplierName: string; invoiceNumber: string; invoiceDate: string; amountCents: number; markupPct: number | null; markupNote: string | null; documentId: string | null };
export const addMaterial = (projectId: string, w: MaterialWrite) =>
  db.from("open_book_materials").insert({ project_id: projectId, supplier_id: w.supplierId, supplier_name: w.supplierName.trim(), invoice_number: w.invoiceNumber.trim(), invoice_date: w.invoiceDate, amount_cents: w.amountCents, markup_pct: w.markupPct, markup_note: w.markupNote?.trim() || null, document_id: w.documentId });
export const removeMaterial = (id: string) => db.from("open_book_materials").delete().eq("id", id);

/** Vendors in the catalogue that supply materials (Materials or Both). */
export function useMaterialVendors(enabled: boolean) {
  return useQuery({
    queryKey: ["open-book-vendors"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("suppliers").select("id,name").eq("active", true).in("supplies", ["materials", "both"]).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

/** Files already in the job's Documents, to point an invoice at its copy. Nothing is uploaded from Billing. */
export function useJobDocuments(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["open-book-documents", projectId],
    enabled,
    queryFn: async () => {
      const { data, error } = await db.from("project_documents").select("id,file_name,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return (data ?? []) as { id: string; file_name: string }[];
    },
  });
}

export type ApprovedHours = { id: string; person: string; date: string; hours: number };
/** Approved hours from the time clock that are not yet on this job's labour, or null when there is no time clock to read. */
export function useApprovedHours(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["open-book-approved-hours", projectId],
    enabled,
    queryFn: async (): Promise<ApprovedHours[] | null> => {
      const { data, error } = await db.rpc("open_book_approved_hours", { _project: projectId });
      if (error || !Array.isArray(data)) return null;
      return (data as ApprovedHours[]).map((h) => ({ ...h, hours: Number(h.hours) }));
    },
  });
}
