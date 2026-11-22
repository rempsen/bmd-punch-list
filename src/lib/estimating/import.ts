/**
 * Imports of prices prepared elsewhere: a Procore estimate workbook and a Graber dealer quotation.
 * Nothing here invents a figure. Selling prices are kept as given (no second markup, waste or tax),
 * and a cost the source does not state is left unknown for staff to enter or mark not needed.
 */
import type * as XLSX from "xlsx";
import { simpleComponent, type SnapComponent } from "./assemble";
import type { Uom } from "./calc";
import type { SaveItem } from "./data";

export type ImportRow = {
  sourceRef: string;
  section: string;
  description: string;
  detail: string | null;
  qty: number;
  uom: Uom;
  /** Whole-line costs as the source states them; null when the source does not say. */
  materialCostCents: number | null;
  labourCostCents: number | null;
  sellCents: number;
  issue: string | null;
  attributes: Record<string, string>;
  source: "procore" | "graber";
};

const cents = (dollars: number) => Math.round(dollars * 100 + Number.EPSILON);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const UOMS: Record<string, Uom> = { "sq ft": "SF", sf: "SF", "sq yd": "SY", sy: "SY", ft: "LF", lf: "LF", ea: "EA", each: "EA" };

/** Sum of the lines against the total the source itself states. */
export function reconcile(rows: { sellCents: number }[], sourceCents: number) {
  const linesCents = rows.reduce((s, r) => s + r.sellCents, 0);
  return { linesCents, sourceCents, differenceCents: linesCents - sourceCents };
}

export function parseProcoreEstimate(wb: XLSX.WorkBook, utils: typeof XLSX.utils) {
  const skipped: string[] = [];
  const grids = wb.SheetNames.map((name) => ({ name, grid: utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, defval: null, raw: true }) }));
  const estimates = grids.filter((g) => String(g.grid[0]?.[0] ?? "").trim().toLowerCase() === "cost item");
  if (estimates.length === 0) throw new Error("This workbook has no Procore estimate sheet (a sheet starting with a \"Cost item\" column).");
  const main = estimates[0]!;
  for (const other of estimates.slice(1)) {
    if (JSON.stringify(other.grid) === JSON.stringify(main.grid)) skipped.push(`${other.name}: same rows as ${main.name}, not imported twice`);
    else skipped.push(`${other.name}: differs from ${main.name}; only ${main.name} was read. Import this sheet separately if it is a different job.`);
  }
  const head = (main.grid[0] as unknown[]).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`The estimate sheet has no "${name}" column.`);
    return i;
  };
  const C = { item: col("cost item"), desc: col("description"), code: col("budget code"), qty: col("quantity"), uom: col("uom (quantity)"), matCost: col("subtotal item cost"), matSell: col("subtotal item sales"), labCost: col("labour cost"), labSell: col("total labour sales"), total: col("total sales"), margin: col("margin") };

  const rows: ImportRow[] = [];
  let section = "General";
  let material = 0;
  let labour = 0;
  let matCost = 0;
  let labCost = 0;
  main.grid.slice(1).forEach((r, i) => {
    const row = r as unknown[];
    const name = String(row[C.item] ?? "").trim();
    const total = numOrNull(row[C.total]);
    if (!name) {
      if (total != null) skipped.push(`${main.name} row ${i + 2}: grand total, not a chargeable item`);
      return;
    }
    // A group row carries the subtotal of the items under it: Procore leaves its margin and unit cost as "--".
    if (numOrNull(row[C.margin]) == null && numOrNull(row[C.qty]) == null || String(row[C.code] ?? "").trim() === "?.?") {
      section = name;
      skipped.push(`${main.name} row ${i + 2}: "${name}" is a group subtotal, not a chargeable item`);
      return;
    }
    const mSell = numOrNull(row[C.matSell]) ?? 0;
    const lSell = numOrNull(row[C.labSell]) ?? 0;
    const mCost = numOrNull(row[C.matCost]);
    const lCost = numOrNull(row[C.labCost]);
    const unit = UOMS[String(row[C.uom] ?? "").trim().toLowerCase()];
    const qty = numOrNull(row[C.qty]);
    material += mSell;
    labour += lSell;
    matCost += mCost ?? 0;
    labCost += lCost ?? 0;
    const issues = [qty == null ? "Quantity is missing" : null, !unit ? `Unit "${String(row[C.uom] ?? "")}" is not recognised` : null, mCost == null ? "Material cost is missing" : null, lCost == null ? "Labour cost is missing" : null, total == null ? "Selling price is missing" : null].filter(Boolean);
    rows.push({
      sourceRef: `${main.name} row ${i + 2}`,
      section,
      description: name,
      detail: String(row[C.desc] ?? "").trim() || null,
      qty: qty ?? 1,
      uom: unit ?? "LS",
      materialCostCents: mCost == null ? null : cents(mCost),
      labourCostCents: lCost == null ? null : cents(lCost),
      sellCents: cents(total ?? mSell + lSell),
      issue: issues.length ? issues.join("; ") : null,
      attributes: {},
      source: "procore",
    });
  });

  // The source's own tax line is kept for the record only; outgoing tax follows BMD's own rule.
  let sourceTaxCents: number | null = null;
  for (const g of grids) {
    for (const r of g.grid as unknown[][]) {
      if (/tax/i.test(String(r?.[0] ?? "")) && !/^taxes$/i.test(String(r[0]).trim())) {
        const amount = [...r].reverse().map(numOrNull).find((v) => v != null);
        if (amount != null && sourceTaxCents == null) sourceTaxCents = cents(amount);
      }
    }
  }
  return {
    rows,
    skipped,
    sourceTotals: { materialCostCents: cents(matCost), labourCostCents: cents(labCost), materialSalesCents: cents(material), labourSalesCents: cents(labour), preTaxCents: cents(material + labour), sourceTaxCents },
  };
}

const MONEY = String.raw`\(?\$[\d,]+\.\d\d\)?`;
const PRODUCT = new RegExp(String.raw`^(\d+)\.0\s+(\d+)\s+Tag\s+(.+?)\s+(${MONEY})\s+(${MONEY})$`);
const DETAIL = new RegExp(String.raw`^(.+?)\s+(${MONEY})\s+(${MONEY})$`);
const money = (s: string) => (s.startsWith("(") ? -1 : 1) * cents(Number(s.replace(/[($,)]/g, "")));

/** Reads the text lines of a Graber dealer quotation. Option amounts under "Pricing Details" are already inside each line's price. */
export function parseGraberQuote(lines: string[]) {
  const rows: ImportRow[] = [];
  let section = "Window coverings";
  let current: ImportRow | null = null;
  let inDetails = false;
  const totals = { units: 0, subtotalCents: 0, taxCents: 0, totalCents: 0 };
  let statedUnits: number | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const p = PRODUCT.exec(line);
    if (p) {
      const qty = Number(p[2]);
      const each = money(p[4]!);
      const ext = money(p[5]!);
      current = { sourceRef: `Line ${p[1]}`, section, description: p[3]!.trim(), detail: null, qty, uom: "EA", materialCostCents: null, labourCostCents: null, sellCents: ext, issue: qty * each === ext ? null : "Quantity × price does not equal the extended price", attributes: {}, source: "graber" };
      rows.push(current);
      inDetails = false;
      continue;
    }
    const t = /^(Total Qty|Subtotal|Tax(?: \([\d.]+%\))?|Total Price)\s+(.+)$/.exec(line);
    if (t) {
      current = null;
      if (t[1] === "Total Qty") statedUnits = Number(t[2]);
      else if (t[1] === "Subtotal") totals.subtotalCents = money(t[2]!);
      else if (t[1] === "Total Price") totals.totalCents = money(t[2]!);
      else totals.taxCents = money(t[2]!);
      continue;
    }
    if (/^[A-Z][A-Z &/-]{5,}$/.test(line)) {
      section = line;
      current = null;
      continue;
    }
    if (line === "Pricing Details") {
      inDetails = true;
      continue;
    }
    if (current) {
      const d = DETAIL.exec(line);
      if (inDetails && d) current.attributes["Options"] = [current.attributes["Options"], d[1]].filter(Boolean).join("; ");
      else if (!inDetails) {
        const a = /^(Product|Color|Control|Additional Options|Inst)\s+(.+)$/.exec(line);
        if (a?.[1] === "Product") current.description = `${current.description} – ${a[2]}`;
        else if (a) current.attributes[a[1]!] = a[2]!;
      }
    }
  }
  totals.units = statedUnits ?? rows.reduce((n, r) => n + r.qty, 0);
  return { rows, skipped: [] as string[], sourceTotals: totals };
}

/** One estimate line per imported row, at the source's selling price. */
export function importRowToSaveItem(row: ImportRow, versionId: string, fileName: string, sortOrder: number): SaveItem {
  // A whole-line cost is spread over the quantity so the worksheet shows the exact source amount.
  const whole = (label: string, total: number | null, n: number): SnapComponent => ({ ...simpleComponent(label, total, row.uom), kind: "labour", qty_per_driver: row.qty > 0 ? 1 / row.qty : 1, cost_overridden: total != null, sort_order: n });
  const components =
    row.source === "graber"
      ? [{ ...simpleComponent("Product cost", null, "EA"), kind: "material" as const, sort_order: 1 }, { ...simpleComponent("Install", null, "EA"), kind: "labour" as const, sort_order: 2 }]
      : [whole("Material (imported)", row.materialCostCents, 1), whole("Labour (imported)", row.labourCostCents, 2)];
  const attrs = Object.entries(row.attributes).map(([k, v]) => `${k}: ${v}`);
  return {
    version_id: versionId,
    line: {
      section: row.section || "General",
      kind: row.source === "graber" ? "assembly" : "lump_sum",
      description: row.description,
      driver_qty: row.qty,
      driver_uom: row.uom,
      waste_pct: 0,
      markup_pct: 0,
      price_basis: "fixed_sell",
      fixed_sell_cents: row.sellCents,
      cost_code: row.source === "graber" ? "02-100" : null,
      tax_code: "GST",
      sort_order: sortOrder,
      notes: [`Imported from ${fileName}, ${row.sourceRef}.`, row.detail, ...attrs].filter(Boolean).join(" "),
    },
    components,
  };
}
