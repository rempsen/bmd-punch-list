// BMD change (new file): adding drawings from the takeoff screen. Which dropped files are drawings, and how a
// newly uploaded drawing's pages join the sheet list.

/** The takeoff screen uploads in one piece, which suits files up to this size. Bigger sets go in through Documents → Plans. */
export const MAX_DRAWING_BYTES = 50 * 1024 * 1024;

const isPdf = (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");

/** Split dropped or chosen files into the PDFs to upload and the ones refused, each with a plain reason. */
export function pickDrawings(files) {
  const pdfs = [];
  const refused = [];
  const seen = new Set();
  for (const file of Array.from(files ?? [])) {
    const name = file.name || "file";
    if (!isPdf(file)) refused.push({ name, why: "Only PDF drawings can be measured." });
    else if (!file.size) refused.push({ name, why: "The file is empty." });
    else if (file.size > MAX_DRAWING_BYTES) refused.push({ name, why: `The file is too large to add here (over ${Math.round(MAX_DRAWING_BYTES / 1048576)} MB). Add it under Documents → Plans instead.` });
    else if (!seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); pdfs.push(file); }
  }
  return { pdfs, refused };
}

/** The sheet list after `file` was uploaded: its pages replace the old ones in place, or go at the end. */
export function mergeSheets(sheets, file, pages) {
  const at = sheets.findIndex((s) => s.file === file);
  const rest = sheets.filter((s) => s.file !== file);
  if (at < 0) return [...rest, ...pages];
  const before = sheets.slice(0, at).filter((s) => s.file !== file).length;
  return [...rest.slice(0, before), ...pages, ...rest.slice(before)];
}

/**
 * The sheet numbers ("A-101") worth remembering in BMD Projects: sheets with something measured on them whose
 * number has been read from the title block and has not been sent yet. Quotes name their drawings from these.
 * @param {{key: string, label: string | null}[]} sheets
 * @param {{shapes?: {sheet_id: string}[]}} doc
 * @param {Map<string, string>} sent what this window has already sent, by sheet key
 */
export function labelsToSave(sheets, doc, sent) {
  const measured = new Set((doc?.shapes || []).map((s) => s.sheet_id));
  const out = [];
  for (const s of sheets) {
    const label = String(s.label ?? "").trim().slice(0, 60);
    if (!label || !measured.has(s.key) || sent.get(s.key) === label) continue;
    out.push({ sheet_key: s.key, label });
  }
  return out;
}
