/**
 * AI help with reading specs and drawings. The model only ever receives text taken from the documents,
 * never a file and never a price, and what it returns is a proposal: nothing is saved as a finish until a person accepts it.
 */
export type Proposal = { tag: string; product: string; manufacturer: string | null; colour: string | null; appliesTo: string | null; specRef: string | null; confidence: number };

const LIMIT = 60_000;
const looksBinary = (s: string) => /^\s*%PDF-/.test(s) || /^\s*data:[\w/+.-]+;base64,/i.test(s) || /[\u0000-\u0008]/.test(s.slice(0, 2000));

export function buildScopeRequest(input: { specText: string; scheduleText: string }): { system: string; prompt: string } {
  for (const t of [input.specText, input.scheduleText]) if (typeof t !== "string" || looksBinary(t)) throw new Error("Send the text of the document, not the file itself.");
  const spec = input.specText.trim().slice(0, LIMIT);
  const schedule = input.scheduleText.trim().slice(0, LIMIT);
  if (!spec && !schedule) throw new Error("There is no text to read.");
  return {
    system:
      "You read construction specifications and finish schedules for a flooring, tile and window covering contractor. List the floor, wall base, tile and window covering finishes the documents call for. Use only what the text says. Never invent a product, manufacturer or colour: leave a field null when the text does not state it. Reply with a JSON array only.",
    prompt: [
      'Return a JSON array. Each item: {"tag": finish tag as written (e.g. LVP-1), "product": product or product line, "manufacturer": string or null, "colour": string or null, "appliesTo": rooms or areas it applies to or null, "specRef": section or page reference or null, "confidence": number from 0 to 1}.',
      spec ? `SPECIFICATION TEXT:\n${spec}` : "",
      schedule ? `FINISH SCHEDULE TEXT:\n${schedule}` : "",
    ].filter(Boolean).join("\n\n"),
  };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);

/** The proposals in a model reply. Anything malformed, untagged or repeated is dropped rather than repaired. */
export function parseProposals(text: string): Proposal[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const start = fenced.search(/[[{]/);
  if (start < 0) return [];
  let data: unknown;
  try {
    data = JSON.parse(fenced.slice(start, Math.max(fenced.lastIndexOf("]"), fenced.lastIndexOf("}")) + 1));
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { proposals?: unknown })?.proposals) ? (data as { proposals: unknown[] }).proposals : [];
  const seen = new Set<string>();
  const out: Proposal[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const tag = str(r["tag"]);
    const product = str(r["product"]);
    if (!tag || !product || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    const c = typeof r["confidence"] === "number" && Number.isFinite(r["confidence"]) ? r["confidence"] : 0.5;
    out.push({ tag, product, manufacturer: str(r["manufacturer"]), colour: str(r["colour"]), appliesTo: str(r["appliesTo"]), specRef: str(r["specRef"]), confidence: Math.min(1, Math.max(0, c)) });
  }
  return out.slice(0, 200);
}

export function proposalToFinish(p: Proposal, projectId: string, sortOrder: number) {
  const what = [p.manufacturer, p.product].filter(Boolean).join(" ") + (p.colour ? `, ${p.colour}` : "");
  return { project_id: projectId, tag: p.tag, description: `${what}${p.appliesTo ? `. ${p.appliesTo}` : ""}${p.specRef ? ` (spec ${p.specRef})` : ""}`, assembly_template_id: null, catalogue_material_id: null, sort_order: sortOrder };
}

export type SheetText = { str: string; x: number; y: number; size: number };
const SHEET_NO = /^[A-Z]{1,3}[-. ]?\d{1,3}(?:[.-]\d{1,2})?[A-Z]?$/;
const TITLE_WORD = /\b(PLAN|PLANS|ELEVATION|ELEVATIONS|SCHEDULE|SCHEDULES|DETAIL|DETAILS|SECTION|SECTIONS|LEGEND|NOTES|COVER|INDEX)\b/;
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Sheet number and title from the title block: the largest sheet-number-like text in the lower right of the sheet, and the nearest title above it. */
export function suggestSheetName(items: SheetText[], page: { width: number; height: number }): { sheet_number: string; title: string | null } | null {
  const corner = items.filter((i) => i.x > page.width * 0.6 && i.y > page.height * 0.6);
  const number = corner.filter((i) => SHEET_NO.test(i.str.trim())).sort((a, b) => b.size - a.size)[0];
  if (!number) return null;
  const title = corner.filter((i) => i !== number && TITLE_WORD.test(i.str.toUpperCase()) && i.str.trim().length <= 80).sort((a, b) => Math.hypot(a.x - number.x, a.y - number.y) - Math.hypot(b.x - number.x, b.y - number.y))[0];
  return { sheet_number: number.str.trim(), title: title ? titleCase(title.str.trim()) : null };
}

/** Where a finish tag is written on a sheet (whole-word match, any case). */
export function findTags(items: SheetText[], tag: string): { x: number; y: number }[] {
  const t = tag.trim().toLowerCase();
  if (!t) return [];
  const word = new RegExp(`(^|[^a-z0-9-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9-])`, "i");
  return items.filter((i) => word.test(i.str)).map((i) => ({ x: i.x, y: i.y }));
}
