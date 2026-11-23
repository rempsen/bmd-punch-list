// BMD change (new file): decides whether this person may open this project's takeoff, connects the workspace to
// BMD Projects, and only then shows the canvas.
import React, { useEffect, useRef, useState } from "react";
import TakeoffCanvas from "../pages/TakeoffCanvas.jsx";
import SimpleTakeoff from "../pages/SimpleTakeoff.jsx";
import BmdBanner from "./BmdBanner.jsx";
import { setActiveStore } from "../lib/store.js";
import { bmdClient } from "../lib/bmd/bmdClient.js";
import { createBmdApi, gateState, savedMessage } from "../lib/bmd/bmdApi.js";
import { createBmdCache } from "../lib/bmd/bmdCache.js";
import { createBmdStore } from "../lib/bmd/bmdStore.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wrap = { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", background: "var(--paper-bright)", color: "var(--ink)" };
const link = { color: "var(--cobalt)", fontWeight: 600 };

function Message({ title, body, href, action }) {
  return (
    <div style={wrap}>
      <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 14, color: "var(--ink-muted)", maxWidth: 480 }}>{body}</div>
      {href ? <a href={href} target="_top" style={link}>{action}</a> : null}
      <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 16 }}>Built on OpenTakeoff (Apache-2.0)</div>
    </div>
  );
}

function tellOpener(projectId, version) {
  const note = savedMessage(projectId, version);
  for (const target of [window.parent !== window ? window.parent : null, window.opener]) {
    try { target?.postMessage(note, window.location.origin); } catch { /* the tab that opened us is gone */ }
  }
}

export default function BmdGate({ projectId, advanced = false }) {
  const [gate, setGate] = useState({ status: "checking" });
  const [save, setSave] = useState({ kind: "idle" });
  const storeRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!projectId || !UUID.test(projectId)) return setGate({ status: "noproject" });
        const supabase = bmdClient();
        const { data: s } = await supabase.auth.getSession();
        if (!s.session) return live && setGate({ status: "signin" });
        const { data: project } = await supabase.from("projects").select("id,name,project_number").eq("id", projectId).maybeSingle();
        let canSave = false;
        if (project) {
          const { data: ok } = await supabase.rpc("has_capability", { _capability: "manage_estimates" });
          canSave = ok === true;
        }
        const status = gateState({ projectId, session: true, project: !!project, canSave });
        if (!live) return;
        if (status !== "ready" && status !== "readonly") return setGate({ status });
        const api = createBmdApi(supabase, projectId, { canSave });
        const store = createBmdStore({
          projectId,
          api,
          cache: createBmdCache(),
          onState: (st) => {
            if (!live) return;
            setSave(st);
            if (st.kind === "saved") tellOpener(projectId, st.version);
          },
        });
        apiRef.current = api;
        storeRef.current = store;
        setActiveStore(store);   // before the canvas mounts, so its first load reads this project
        document.title = `Takeoff · ${project.project_number ? `${project.project_number} ` : ""}${project.name} · BMD Projects`;
        setGate({ status, project });
      } catch (e) {
        if (live) setGate({ status: "error", message: String(e?.message || e) });
      }
    })();
    return () => { live = false; setActiveStore(); };
  }, [projectId]);

  if (gate.status === "checking") return null;
  if (gate.status === "noproject") return <Message title="Open the takeoff from a project" body="The takeoff workspace opens from a project's Takeoff tab in BMD Projects, so it knows which drawings to load and where to save." href="/projects" action="Go to Projects" />;
  if (gate.status === "signin") return <Message title="Sign in to BMD Projects" body="You are signed out. Sign in, then open the takeoff from the project again." href="/auth" action="Sign in" />;
  if (gate.status === "noaccess") return <Message title="This project is not available to you" body="You are signed in, but you are not on this project, or it no longer exists." href="/projects" action="Go to Projects" />;
  if (gate.status === "error") return <Message title="The takeoff could not be opened" body={gate.message} href="/projects" action="Go to Projects" />;
  return (
    <>
      <BmdBanner state={save} readOnly={gate.status === "readonly"} store={storeRef.current} api={apiRef.current} />
      {advanced
        ? <TakeoffCanvas key={`bmd:${projectId}`} />
        : <SimpleTakeoff key={`simple:${projectId}`} projectId={projectId} readOnly={gate.status === "readonly"} saveState={save} />}
    </>
  );
}
