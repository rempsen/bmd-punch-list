/** Loads a quote with everything needed to show or send it. Works with the browser client and the signed-in server client alike. */
import { shapeLine, type EstVersion } from "@/lib/estimating/data";
import type { Rates } from "@/lib/estimating/worksheet";
import { buildSnapshot, rollupByCostCode, unknownCostLabels, type Presentation, type QuoteKind, type QuoteSnapshot } from "./logic";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "superseded";
export type QuoteRow = {
  id: string;
  project_id: string;
  kind: QuoteKind;
  co_number: number | null;
  revision: number;
  number: string;
  status: QuoteStatus;
  version_ids: string[];
  validity_days: number;
  presentation: Presentation;
  inclusions: string[];
  exclusions: string[];
  clarifications: string[];
  deposit: string | null;
  snapshot: QuoteSnapshot | null;
  /** Internal: selling amounts by cost code for each price, saved when the quote was sent. */
  rollup: { versionId: string; lines: { costCode: string; amountCents: number; taxCode: "GST" | "HST" | "EXEMPT" | "ZERO" }[]; subtotalCents: number; taxCents: number; totalCents: number }[] | null;
  value_cents: number | null;
  recipients: string[];
  sent_at: string | null;
  accepted_version_id: string | null;
  accepted_at: string | null;
  accepted_value_cents: number | null;
  decision_note: string | null;
  document_id: string | null;
  created_at: string;
};
export const QUOTE_COLS =
  "id,project_id,kind,co_number,revision,number,status,version_ids,validity_days,presentation,inclusions,exclusions,clarifications,deposit,snapshot,rollup,value_cents,recipients,sent_at,accepted_version_id,accepted_at,accepted_value_cents,decision_note,document_id,created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };

export const todayInWinnipeg = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Winnipeg" });
export const quoteFileName = (number: string, project: string, date: string) => `${number} - ${project.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()} - ${date}.pdf`;

export async function loadQuoteContext(sb: Sb, quoteId: string, preparedBy: { name: string; email: string }) {
  const one = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`${what} not found`);
    return data as T;
  };
  const quote = await one<QuoteRow>(sb.from("quotes").select(QUOTE_COLS).eq("id", quoteId).maybeSingle(), "Quote");
  const project = await one<{ name: string; project_number: string | null; address: string | null; client: { name: string; billing_address: string | null } | null }>(
    sb.from("projects").select("name,project_number,address,client:clients(name,billing_address)").eq("id", quote.project_id).maybeSingle(),
    "Project",
  );
  const tax = await one<{ pst_pct: number; gst_pct: number; hst_pct: number }>(sb.from("tax_settings").select("pst_pct,gst_pct,hst_pct").eq("id", 1).maybeSingle(), "Tax rates");
  const rates: Rates = { pstPct: Number(tax.pst_pct), gstPct: Number(tax.gst_pct), hstPct: Number(tax.hst_pct) };
  const rows = await one<Record<string, unknown>[]>(
    sb
      .from("estimate_versions")
      .select("id,project_id,kind,co_number,name,description,default_markup_pct,sort_order,is_base,locked,status,lines:estimate_lines(*,components:estimate_line_components(*))")
      .in("id", quote.version_ids)
      .order("sort_order"),
    "Prices",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const versions = (rows as any[]).map((v): EstVersion => ({ ...v, default_markup_pct: Number(v.default_markup_pct), lines: (v.lines as unknown[]).map(shapeLine).sort((a, b) => a.sort_order - b.sort_order) }));
  const date = todayInWinnipeg();
  const snapshot = buildSnapshot({
    number: quote.number,
    date,
    validityDays: quote.validity_days,
    presentation: quote.presentation,
    preparedBy,
    project: { name: project.name, number: project.project_number, address: project.address },
    client: { name: project.client?.name ?? "", address: project.client?.billing_address ?? null },
    inclusions: quote.inclusions,
    exclusions: quote.exclusions,
    clarifications: quote.clarifications,
    deposit: quote.deposit,
    versions,
    rates,
  });
  return {
    quote,
    snapshot,
    rollup: versions.map((v) => ({ versionId: v.id, ...rollupByCostCode(v, rates) })),
    unknown: unknownCostLabels(versions, rates),
    fileName: quoteFileName(quote.number, project.name, date),
    projectName: project.name,
    clientName: project.client?.name ?? "",
  };
}

/** A fingerprint of the figures a preview showed, so a send can be refused if the estimate changed underneath it. */
export const snapshotFingerprint = (s: QuoteSnapshot) => [s.number, s.presentation, s.validityDays, ...s.versions.map((v) => `${v.id}:${v.subtotalCents}:${v.totalCents}`), s.inclusions.length, s.exclusions.length, s.clarifications.length, s.deposit ?? ""].join("|");
