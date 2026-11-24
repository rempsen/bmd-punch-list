// BMD change (new file): looking through a drawing set before an automatic takeoff: what each sheet is, how many
// room tags it carries, and where the room finish schedule is. Text only; nothing is measured here. BMD's own code.
//
// What a sheet is, and the first reading of the schedule, come from OpenTakeoff's sheet graph (lib/sheetgraph.ts),
// handed in as `graph` so this file can be tested without it.
import { findRoomTags } from "./roomTags.js";
import { cellFinish, readRoomSchedule } from "./roomSchedule.js";
import { pickScheduleRows, sheetChoice } from "./autoTakeoff.js";

/** The rows of the room finish schedules OpenTakeoff's sheet graph read, in the shape the automatic takeoff uses. */
export function engineScheduleRows(graph) {
  const rows = [];
  for (const t of graph?.tables ?? []) {
    if (t.kind !== "room-finish") continue;
    const col = (cells, re) => { const k = Object.keys(cells).find((h) => re.test(h)); return k ? String(cells[k]?.text ?? "") : ""; };
    for (const r of t.rows ?? []) {
      rows.push({ number: String(r.key ?? "").toUpperCase().replace(/\s+/g, ""), name: col(r.cells, /^NAME$/), floor: cellFinish(col(r.cells, /^FLOOR( FINISH)?$/)), base: cellFinish(col(r.cells, /^BASE( FINISH)?$/)), areaSf: null });
    }
  }
  return rows;
}

/**
 * @param {object} a
 * @param {{key: string, label: string|null, page: number, file: string}[]} a.sheets
 * @param {(sheet: object) => Promise<object[]>} a.spansOf the sheet's text as OpenTakeoff page spans
 * @param {(sheet: object) => Promise<string|null>} [a.labelOf] the sheet number from its title block, for a sheet that has none yet
 * @param {{classifySheetRole: Function, buildSheetGraph: Function}} a.graph OpenTakeoff's sheet graph
 * @param {(text: string) => void} [a.onProgress]
 * @param {() => boolean} [a.shouldStop]
 * @returns {Promise<{rows: {key: string, label: string|null, page: number, file: string, title: string, ticked: boolean, why: string, roomTags: number}[], spans: Map<string, object[]>, schedule: {rows: object[], reader: string|null, sheets: string[]}}>}
 */
export async function scanSheets({ sheets, spansOf, labelOf = null, graph, onProgress = () => {}, shouldStop = () => false }) {
  const spans = new Map();
  const rows = [];
  const bmdRows = [];
  const scheduleSheets = [];
  const forGraph = [];
  for (let i = 0; i < sheets.length; i++) {
    if (shouldStop()) break;
    let s = sheets[i];
    // a sheet whose number has not been read from its title block yet is read now, so it is named properly
    if (!s.label && labelOf) { try { const label = await labelOf(s); if (label) s = { ...s, label }; } catch { /* it stays "Page n" */ } }
    const name = s.label || `Page ${s.page}`;
    onProgress(`Reading the sheets… ${i + 1} of ${sheets.length} (${name})`);
    let text = [];
    try { text = await spansOf(s); } catch { text = []; }
    spans.set(s.key, text);
    let role = { role: "unknown", evidence: null };
    try { role = graph.classifySheetRole({ key: s.key, sheet_number: s.label || null, spans: text }); } catch { /* a sheet that cannot be read is simply not ticked */ }
    const title = String(role.evidence?.text ?? "").replace(/[\s:–-]+$/, "");
    const roomTags = text.length ? findRoomTags(text).length : 0;
    const read = readRoomSchedule(text);
    if (read.rows.length) { bmdRows.push(...read.rows); scheduleSheets.push(name); }
    forGraph.push({ key: s.key, sheet_number: s.label || null, spans: text });
    const choice = text.length ? sheetChoice({ title, role: role.role, roomTags }) : { ticked: false, why: "No text on this sheet (a scan): room tags cannot be read" };
    rows.push({ key: s.key, label: s.label, page: s.page, file: s.file, title, roomTags, ...choice });
  }
  let engineRows = [];
  try { engineRows = engineScheduleRows(graph.buildSheetGraph(forGraph)); } catch { engineRows = []; }
  const picked = pickScheduleRows(engineRows, bmdRows);
  return { rows, spans, schedule: { ...picked, sheets: picked.reader === "BMD" ? scheduleSheets : [] } };
}

/** One plain line about the schedule, for the run panel. */
export function scheduleLine(schedule) {
  if (!schedule?.rows?.length) return "No room finish schedule could be read in this set. Rooms will be proposed with a finish only where a finish tag on this job is lettered inside them; the rest are left for you to assign.";
  const where = schedule.sheets?.length ? ` on ${schedule.sheets.join(", ")}` : "";
  return `Room finish schedule read${where}: ${schedule.rows.length} rooms.`;
}
