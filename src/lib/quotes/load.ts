/** Loads a quote with everything needed to show or send it. Works with the browser client and the signed-in server client alike. */
import { shapeLine, type EstVersion } from "@/lib/estimating/data";
import { chosenDrawings, type ChosenDrawing, type TakeoffDoc } from "@/lib/takeoff/marked";
import type { Rates } from "@/lib/estimating/worksheet";
import { categoryLabel } from "@/lib/catalogue/logic";
import { brandingFrom, SETTINGS_COLS, type Branding, type SettingsRow } from "./branding";
import { buildSnapshot, normalizeDisplay, rollupByCostCode, unknownCostLabels, type Presentation, type QuoteDisplay, type QuoteKind, type QuoteSnapshot } from "./logic";
import { areaParts, areasByFinish, docAreaRows, lineAreas } from "@/lib/takeoff/areas";

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
  display: Partial<QuoteDisplay> | null;
  drawing_sheet_ids: string[];
  /** The takeoff sheets ("Plans.pdf#4") whose marked-up drawings go with the quote. */
  drawing_sheets: string[];
  inclusions: string[];
  exclusions: string[];
  clarifications: string[];
  deposit: string | null;
  /** Who at the client the quote is addressed to. */
  attention: string | null;
  /** Notes written for the client; printed on the quote. */
  client_notes: string;
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
  "id,project_id,kind,co_number,revision,number,status,version_ids,validity_days,presentation,display,drawing_sheet_ids,drawing_sheets,inclusions,exclusions,clarifications,deposit,attention,client_notes,snapshot,rollup,value_cents,recipients,sent_at,accepted_version_id,accepted_at,accepted_value_cents,decision_note,document_id,created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = { from: (t: string) => any };

/** The saved company details (Company settings → Quotes). Kept here, free of browser-only code, because the server reads it when a quote is sent. */
export async function loadBranding(sb: Sb): Promise<Branding> {
  const { data, error } = await sb.from("quote_settings").select(SETTINGS_COLS).eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return brandingFrom(data as SettingsRow | null);
}

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
  // The kind of material behind each line, for quotes grouped by material: the finish's catalogue category, else window coverings by cost code.
  const { data: fin } = await sb.from("project_finishes").select("id,material:catalogue_materials(category)").eq("project_id", quote.project_id);
  const categoryOf = new Map(((fin ?? []) as { id: string; material: { category: string } | null }[]).map((f) => [f.id, f.material?.category ?? null]));
  const materialOf: Record<string, string> = {};
  for (const v of versions) {
    for (const l of v.lines) {
      const cat = l.finish_id ? categoryOf.get(l.finish_id) : null;
      if (cat) materialOf[l.id] = categoryLabel(cat);
      else if (l.cost_code === "02-100") materialOf[l.id] = "Window coverings";
    }
  }
  // The marked-up drawings chosen to go with the quote, from the project's takeoff, in sheet order.
  const chosen = quote.drawing_sheets ?? [];
  let drawingSheets: ChosenDrawing[] = [];
  if (chosen.length) {
    const [{ data: tk }, { data: lab }] = await Promise.all([
      sb.from("project_takeoffs").select("doc").eq("project_id", quote.project_id).maybeSingle(),
      sb.from("takeoff_sheet_labels").select("sheet_key,label").eq("project_id", quote.project_id),
    ]);
    const labels = Object.fromEntries(((lab ?? []) as { sheet_key: string; label: string }[]).map((r) => [r.sheet_key, r.label]));
    drawingSheets = chosenDrawings(chosen, (tk as { doc: TakeoffDoc } | null)?.doc, labels);
  }
  // Base broken out by area, when the quote asks for it: each LF line that follows the takeoff, from the takeoff's
  // accepted lines. A line whose areas do not add up to its quantity gets none, and is named so the office can see why.
  const display = normalizeDisplay(quote.display, quote.presentation);
  const areasOf: Record<string, { label: string; qty: number }[]> = {};
  const areasMissing: string[] = [];
  if (display.showAreas) {
    const [{ data: tk }, { data: links }] = await Promise.all([
      sb.from("project_takeoffs").select("conditions:doc->conditions,shapes:doc->shapes").eq("project_id", quote.project_id).maybeSingle(),
      sb.from("takeoff_quantities").select("condition_key,finish_id").eq("project_id", quote.project_id),
    ]);
    const areas = areasByFinish(docAreaRows(tk as Parameters<typeof docAreaRows>[0]), (links ?? []) as { condition_key: string; finish_id: string }[]);
    for (const v of versions) {
      for (const l of v.lines) {
        const a = lineAreas(l, v.lines, areas);
        if (!a) continue;
        if (a.matches) areasOf[l.id] = areaParts(a.areas);
        else areasMissing.push(l.description);
      }
    }
  }
  const date = todayInWinnipeg();
  const branding = await loadBranding(sb);
  const snapshot = buildSnapshot({
    branding,
    attention: quote.attention,
    remarks: quote.client_notes,
    number: quote.number,
    date,
    validityDays: quote.validity_days,
    presentation: quote.presentation,
    display,
    materialOf,
    areasOf,
    preparedBy,
    project: { name: project.name, number: project.project_number, address: project.address },
    client: { name: project.client?.name ?? "", address: project.client?.billing_address ?? null },
    inclusions: quote.inclusions,
    exclusions: quote.exclusions,
    clarifications: quote.clarifications,
    deposit: quote.deposit,
    drawings: drawingSheets.map((s) => s.label),
    versions,
    rates,
  });
  return {
    quote,
    snapshot,
    rollup: versions.map((v) => ({ versionId: v.id, ...rollupByCostCode(v, rates) })),
    unknown: unknownCostLabels(versions, rates),
    areasMissing,
    drawingSheets,
    versions,
    fileName: quoteFileName(quote.number, project.name, date),
    projectName: project.name,
    clientName: project.client?.name ?? "",
  };
}

/**
 * A fingerprint of everything the client would see, except the date and who prepared it.
 * A send is refused when it differs from the preview, so the emailed PDF and the stored quote cannot drift apart.
 */
export function snapshotFingerprint(s: QuoteSnapshot): string {
  const { date: _date, preparedBy: _by, ...rest } = s;
  const text = JSON.stringify(rest);
  let a = 0x811c9dc5;
  let b = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${text.length}-${a.toString(16)}-${b.toString(16)}`;
}
