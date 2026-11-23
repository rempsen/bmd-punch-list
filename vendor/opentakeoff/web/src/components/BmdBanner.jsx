// BMD change (new file): tells the estimator, in plain words, whether the takeoff is safely saved in BMD Projects,
// and what to do when it is not. Shown above the canvas only when there is something to say.
import React, { useEffect, useState } from "react";

const bar = (tone) => ({
  position: "fixed", left: "50%", top: 6, transform: "translateX(-50%)", zIndex: 5000, maxWidth: "min(900px, 94vw)",
  display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "8px 14px", fontSize: 13, lineHeight: 1.35,
  border: `1px solid ${tone === "bad" ? "#b3261e" : "#b7791f"}`, background: tone === "bad" ? "#fdecea" : "#fff8e1", color: "#1c1b1f",
  borderRadius: 6, boxShadow: "0 4px 18px rgba(0,0,0,0.18)",
});
const btn = { padding: "6px 12px", fontSize: 12.5, fontWeight: 600, border: "1px solid #1c1b1f", background: "#1c1b1f", color: "#fff", borderRadius: 4, cursor: "pointer" };
const quiet = { ...btn, background: "transparent", color: "#1c1b1f" };
const when = (ts) => new Date(ts).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

export default function BmdBanner({ state, readOnly, store, api }) {
  const [recovery, setRecovery] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    // Asked a moment after mounting, once the canvas has loaded the takeoff.
    const t = setTimeout(() => { store?.pendingRecovery?.().then((r) => { if (live && r?.doc) setRecovery(r); }, () => {}); }, 2500);
    return () => { live = false; clearTimeout(t); };
  }, [store]);

  const keepAsRevision = async (doc, label) => {
    setBusy(true);
    try {
      await api.snapshots.put({ label, payload: doc });
      await store.discardRecovery();
      return true;
    } catch (e) {
      setNote(`That could not be kept: ${String(e?.message || e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (state?.kind === "conflict") {
    return (
      <div role="alert" style={bar("bad")}>
        <span><strong>{state.by} saved this takeoff while you were working.</strong> Your changes since then are not saved, and nothing of theirs has been overwritten.</span>
        <button type="button" style={btn} disabled={busy} onClick={async () => { const r = await store.pendingRecovery(); if (!r?.doc || (await keepAsRevision(r.doc, `My unsaved work, ${when(Date.now())}`))) window.location.reload(); }}>
          Keep mine as a revision, then load theirs
        </button>
        <button type="button" style={quiet} disabled={busy} onClick={async () => { await store.discardRecovery(); window.location.reload(); }}>Discard mine and load theirs</button>
        {note ? <span>{note}</span> : null}
      </div>
    );
  }
  if (state?.kind === "failed") {
    return (
      <div role="alert" style={bar("bad")}>
        <span><strong>Not saved to BMD Projects.</strong> {state.message} Your work is kept in this browser; keep this tab open. It is sent again with your next change.</span>
      </div>
    );
  }
  if (recovery) {
    return (
      <div role="status" style={bar("warn")}>
        <span><strong>Unsaved work from {when(recovery.ts)} was found in this browser.</strong> It never reached BMD Projects. What is on screen is the last saved takeoff.</span>
        <button type="button" style={btn} disabled={busy || readOnly} onClick={async () => { if (await keepAsRevision(recovery.doc, `Recovered work, ${when(recovery.ts)}`)) { setRecovery(null); setNote("Kept. Open Revisions to compare or restore it."); } }}>Keep it as a revision</button>
        <button type="button" style={quiet} disabled={busy} onClick={async () => { await store.discardRecovery(); setRecovery(null); }}>Discard it</button>
        {note ? <span>{note}</span> : null}
      </div>
    );
  }
  if (note) return <div role="status" style={bar("warn")}><span>{note}</span><button type="button" style={quiet} onClick={() => setNote("")}>OK</button></div>;
  if (readOnly) return <div role="status" style={{ ...bar("warn"), top: "auto", bottom: 30 }}><span><strong>Read-only.</strong> You can look and measure, but nothing you do here is saved.</span></div>;
  return null;
}
