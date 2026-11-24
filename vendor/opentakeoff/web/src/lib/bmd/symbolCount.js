// BMD change (new file): "Count symbols like this one" on the simple screen. BMD's own code.
//
// The finding is done by OpenTakeoff's Symbol Sweep (lib/symbolsweep.ts): a person draws a box around one symbol
// and every other placement of that same little cluster of lines on the sheet is found from the linework alone.
// No AI is involved and nothing is guessed: a placement either reproduces the example's lines or it does not.
//
// This file turns what the sweep found into count proposals. Like every proposal they are not counted in totals
// and do not reach the estimate until a person accepts them (./autoReview.js). The clear matches are one item to
// review; each near-match is its own item, because a near-match is a question to look at, never a silent count.
import { computeShapeMetrics } from "../shapeMetrics.js";
import { METHOD } from "./autoTakeoff.js";

const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const SAME_PX = 6;   // a count mark this close to a placement is that symbol, already counted

/**
 * @param {object} doc the takeoff document
 * @param {object} a
 * @param {string} a.sheetId
 * @param {string} a.conditionId the finish being counted
 * @param {object} a.result what sweepSymbols returned for the box
 * @param {{w: number, h: number}} a.dims
 * @param {string} [a.sweepId]
 * @param {() => string} [a.now]
 * @returns {{doc: object, found: number, close: number, partial: boolean}} `found`: symbols proposed, the example
 *   included; `close`: near-matches proposed for a look; `partial`: the sheet was too busy to search completely
 */
export function symbolProposals(doc, { sheetId, conditionId, result, dims, sweepId = uid("swp"), now = () => new Date().toISOString() }) {
  const cond = (doc.conditions || []).find((c) => c.id === conditionId);
  if (!cond) throw new Error("Choose a finish to measure first.");
  if (!result?.seed || result.seed.segments < 2) throw new Error("Draw the box around the whole symbol, and only the symbol. Nothing was found inside that box to match.");
  const partial = result.complete === false;
  const marks = (doc.shapes || []).filter((s) => s.sheet_id === sheetId && s.measure_role === "count" && s.condition_id === conditionId).map((s) => [s.verts_norm[0][0] * dims.w, s.verts_norm[0][1] * dims.h]);
  const fresh = (at) => !marks.some((m) => Math.hypot(m[0] - at[0], m[1] - at[1]) <= SAME_PX);
  const ts = now();
  const mark = (at, confidence, auto) => {
    const shape = { id: uid("shp"), sheet_id: sheetId, condition_id: conditionId, measure_role: "count", verts_norm: [[at[0] / dims.w, at[1] / dims.h]], created_at: ts, origin: { method: METHOD, actor: "auto", reviewed: false, confidence: round2(Math.max(0.05, Math.min(0.97, confidence))), proposed_ts: ts, auto: { kind: "count", room: cond.finish_tag, name: "", notes: [], ...auto } } };
    shape.computed = computeShapeMetrics(shape, dims, 0, cond);
    marks.push(at);
    return shape;
  };
  const matches = (result.matches || []).filter((m) => fresh(m.at));
  const withheld = (result.withheld || []).filter((m) => fresh(m.at));
  if (!matches.length && !withheld.length) return { doc, found: 0, close: 0, partial };
  const shapes = [];
  const why = `Drawn with the same lines as the symbol you boxed.${partial ? " This sheet was too busy to search completely, so there may be more." : ""}`;
  if (fresh(result.seed.center)) shapes.push(mark(result.seed.center, 0.97, { sweep: sweepId, from: "symbol", why: matches.length ? `The symbol you boxed, and ${matches.length} more drawn with the same lines.${partial ? " This sheet was too busy to search completely, so there may be more." : ""}` : "The symbol you boxed.", name: "symbols like your example" }));
  for (const m of matches) {
    shapes.push(mark(m.at, m.extra ? Math.min(m.score, 0.8) : m.score, { sweep: sweepId, from: "symbol", why, name: "symbols like your example", notes: [...(m.extra ? ["One of these has more linework than your example: look at it before accepting."] : []), ...(m.rotation || m.mirrored ? ["Some are turned or mirrored on the sheet; they are the same symbol."] : [])] }));
  }
  const found = shapes.length;
  for (const m of withheld) shapes.push(mark(m.at, m.score, { from: "symbol", name: "close to your example", why: `Close to the symbol you boxed but not the same (${Math.round(m.score * 100)}% alike): ${m.reason || "some of its lines were not found"}. Look at it and accept it only if it is one.` }));
  // one item's notes are read from its first shape: carry every note of the group there
  const group = shapes.filter((s) => s.origin.auto.sweep === sweepId);
  if (group.length) group[0].origin.auto.notes = [...new Set(group.flatMap((s) => s.origin.auto.notes))];
  return { doc: { ...doc, shapes: [...(doc.shapes || []), ...shapes] }, found, close: shapes.length - found, partial };
}
