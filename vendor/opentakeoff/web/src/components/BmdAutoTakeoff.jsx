// BMD change (new file): the two panels of the automatic takeoff on the simple BMD takeoff screen: choosing the
// sheets and watching the run, and reviewing what it proposed. BMD's own code. The work itself is in
// lib/bmd/autoTakeoff.js (the run) and lib/bmd/autoReview.js (accepting and correcting).
import React, { useState } from "react";
import { FROM_LABEL } from "../lib/bmd/autoReview.js";

const KIND_LABEL = { base: "Base", inside: "Inside the room", transition: "Transition", count: "Count" };
import { LIMITS, LIMITS_SHORT } from "../lib/bmd/autoTakeoff.js";

const fmt = (n) => (Number(n) || 0).toLocaleString("en-CA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (c) => `${Math.round((Number(c) || 0) * 100)}%`;

/**
 * The run panel. `phase`: "reading" (looking through the sheets), "pick" (choose sheets), "running", "done".
 */
export function AutoRunPanel({ phase, rows, reading, schedule, askAi, onAskAi, onToggle, onStart, onStop, onClose, onReview, progress, results, stopping, proposed }) {
  const ticked = rows.filter((r) => r.ticked).length;
  return (
    <div className="st-auto-veil" role="dialog" aria-modal="true" aria-label="Run automatic takeoff" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="st-auto">
        <h2>Run automatic takeoff</h2>
        {phase === "reading" && <p className="st-auto-status" role="status">{reading || "Reading the sheets…"}</p>}
        {phase === "pick" && (
          <>
            <p className="st-sub">It finds each room tag on the sheets you tick, measures the room to its walls, and looks up its floor and base finish. Everything it makes is a proposal for you to accept or correct. Nothing is added to the estimate until you accept it.</p>
            <p className="st-auto-schedule">{schedule}</p>
            <ul className="st-auto-sheets">
              {rows.map((r) => (
                <li key={r.key}>
                  <label>
                    <input type="checkbox" checked={r.ticked} onChange={() => onToggle(r.key)} />
                    <span><strong>{r.label || `Page ${r.page}`}</strong>{r.title ? <em> {r.title}</em> : null}<small>{r.why}</small></span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="st-auto-ai"><input type="checkbox" checked={askAi} onChange={(e) => onAskAi(e.target.checked)} /><span>Ask the AI helper about rooms the drawings give no finish for. Its answers are marked and rated lower.</span></label>
            <div className="st-auto-actions">
              <button type="button" className="st-btn st-big" onClick={onClose}>Cancel</button>
              <button type="button" className="st-btn st-btn-primary st-big" disabled={!ticked} onClick={onStart}>{ticked ? `Start on ${ticked} sheet${ticked === 1 ? "" : "s"}` : "Tick a sheet to start"}</button>
            </div>
          </>
        )}
        {(phase === "running" || phase === "done") && (
          <>
            <p className="st-sub">{phase === "running" ? "Leave this tab open while it works. You can stop at any time; what it has proposed so far is kept." : `Finished. ${proposed} proposal${proposed === 1 ? "" : "s"} waiting for your review.`}</p>
            <ul className="st-auto-progress" role="status">
              {results.map((r) => <li key={r.key} className={r.skipped ? "st-auto-skipped" : ""}>{r.text}</li>)}
              {progress && <li className="st-auto-now">{progress}</li>}
            </ul>
            <div className="st-auto-actions">
              {phase === "running"
                ? <button type="button" className="st-btn st-big" onClick={onStop} disabled={stopping}>{stopping ? "Stopping…" : "Stop"}</button>
                : <>
                    <button type="button" className="st-btn st-big" onClick={onClose}>Close</button>
                    {proposed > 0 && <button type="button" className="st-btn st-btn-primary st-big" onClick={onReview}>Review proposals</button>}
                  </>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The review list: proposals by sheet, then finish, lowest confidence first. */
export function AutoReview({ list, conditions, summary, readOnly, selected, onJump, onAccept, onRemove, onFinish, onAcceptAbove, onAcceptSheet, onClose, above }) {
  const [open, setOpen] = useState(null);   // the item whose "why" and choices are shown
  const total = list.reduce((n, s) => n + s.count, 0);
  return (
    <div className="st-review">
      <div className="st-review-head">
        <h2>Review proposals</h2>
        <button type="button" className="st-btn" onClick={onClose}>Back to measuring</button>
      </div>
      <p className="st-sub st-review-limits" title={LIMITS}>{LIMITS_SHORT}</p>
      {summary.length > 0 && (
        <div className="st-review-banner" role="note">
          <strong>From the last run</strong>
          <ul>{summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </div>
      )}
      {total === 0 && <p className="st-sub">Nothing is waiting for review. Run the automatic takeoff to propose measurements.</p>}
      {total > 0 && !readOnly && (
        <button type="button" className="st-btn st-big st-review-all" disabled={!above} onClick={onAcceptAbove}>{above ? `Accept all above 80% (${above})` : "Nothing is rated above 80%"}</button>
      )}
      <div className="st-review-list">
        {list.map((sheet) => (
          <section key={sheet.sheetKey}>
            <header>
              <h3>{sheet.sheetLabel} <span>{sheet.count} to review</span></h3>
              {!readOnly && <button type="button" className="st-btn" onClick={() => onAcceptSheet(sheet.sheetKey)}>Accept all on this sheet</button>}
            </header>
            {sheet.groups.map((g) => (
              <div key={g.finish ?? "none"} className="st-review-group">
                <h4>{g.finish ?? "No finish chosen"}{g.isNew ? <span> not on this job yet; added when you accept</span> : null}</h4>
                <ul>
                  {g.items.map((it) => {
                    const on = open === it.id || it.ids.includes(selected);
                    const low = it.confidence < 0.6;
                    return (
                      <li key={it.id} className={on ? "st-on" : ""}>
                        <button type="button" className="st-review-item" onClick={() => { setOpen(open === it.id ? null : it.id); onJump(it); }} aria-expanded={on}>
                          <span className="st-review-room"><strong>{it.room}{it.name ? ` ${it.name}` : ""}</strong>{KIND_LABEL[it.kind] ? <em>{KIND_LABEL[it.kind]}</em> : null}</span>
                          <span className="st-review-qty">{it.unit === "EA" ? it.qty : fmt(it.qty)} {it.unit}</span>
                          <span className={`st-review-conf ${low ? "st-low" : it.confidence > 0.8 ? "st-high" : ""}`}>{pct(it.confidence)}</span>
                        </button>
                        {on && (
                          <div className="st-review-more">
                            <p><strong>{FROM_LABEL[it.from] ?? it.from}.</strong> {it.why}</p>
                            {it.notes.map((n, i) => <p key={i}>{n}</p>)}
                            {!readOnly && (
                              <div className="st-review-actions">
                                <button type="button" className="st-btn st-btn-primary st-big" disabled={!it.finish} title={it.finish ? "" : "Choose a finish first"} onClick={() => onAccept(it)}>Accept</button>
                                <select className="st-input st-big" value="" onChange={(e) => e.target.value && onFinish(it, e.target.value)} aria-label={`Change the finish for ${it.room} ${it.name}`}>
                                  <option value="">{it.finish ? "Change finish…" : "Choose a finish…"}</option>
                                  {conditions.map((c) => <option key={c.id} value={c.id}>{c.finish_tag}</option>)}
                                </select>
                                <button type="button" className="st-btn st-btn-danger st-big" onClick={() => onRemove(it)}>Remove</button>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))}
        <p className="st-sub st-review-foot">{LIMITS}</p>
      </div>
    </div>
  );
}
