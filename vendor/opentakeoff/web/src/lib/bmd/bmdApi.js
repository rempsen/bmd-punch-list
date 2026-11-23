// BMD change (new file): how the takeoff workspace talks to BMD Projects. Everything here runs as the person
// signed in to BMD Projects in this browser, so BMD's own access rules decide what can be read and saved.
// Only documents and takeoff records are touched: no prices, costs or margins are ever requested.
import { ConflictError } from "./bmdStore.js";

export const BUCKET = "project-documents";
const SECTIONS = ["plans", "specifications"];

/** "TAKEOFF_CONFLICT:<version>:<who>" inside a database error → who saved over us. */
export function parseConflict(message) {
  const m = /TAKEOFF_CONFLICT:(\d+):([^\n]*)/.exec(String(message ?? ""));
  return m ? { version: Number(m[1]), by: m[2].trim() || "someone else" } : null;
}

/** What the workspace shows for this person and project. */
export function gateState({ projectId, session, project, canSave }) {
  if (!projectId) return "noproject";
  if (!session) return "signin";
  if (!project) return "noaccess";
  return canSave ? "ready" : "readonly";
}

/** The newest version of each PDF in Plans and Specifications. `id` stays the same from one version to the next. */
export function latestPdfs(rows) {
  const newest = new Map();
  for (const r of rows ?? []) {
    if (!SECTIONS.includes(r.section)) continue;
    if (!(/\.pdf$/i.test(r.file_name) || r.mime === "application/pdf")) continue;
    const id = `${r.section}/${r.file_name.toLowerCase()}`;
    const had = newest.get(id);
    if (!had || r.version > had.version) newest.set(id, { ...r, key: id });
  }
  return [...newest.values()]
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.file_name.localeCompare(b.file_name, undefined, { numeric: true }))
    .map((r) => ({ id: r.key, name: r.file_name, section: r.section, versionId: r.id, path: r.storage_path }));
}

/** A storage-key-safe file name, made the same way BMD Documents makes them. */
export function safeFileName(name) {
  const flat = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^[.\\/\s]+/, "").replace(/[^A-Za-z0-9 ._()-]+/g, "_").trim();
  if (!/[A-Za-z0-9]/.test(flat)) return "file";
  if (flat.length <= 120) return flat;
  const dot = flat.lastIndexOf(".");
  const ext = dot > 0 && flat.length - dot <= 10 ? flat.slice(dot) : "";
  return flat.slice(0, 120 - ext.length) + ext;
}

/** The note sent to the BMD Projects tab that opened the workspace after each successful save. */
export const savedMessage = (projectId, version) => ({ type: "bmd-takeoff-saved", projectId, version });

const fail = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

/**
 * @param {any} supabase a signed-in Supabase client for BMD Projects
 * @param {string} projectId
 * @param {{canSave: boolean}} access
 */
export function createBmdApi(supabase, projectId, { canSave }) {
  const paths = new Map();   // document version id → storage path
  const docs = () => supabase.from("project_documents");
  return {
    canSave,
    async listDocuments() {
      const { data, error } = await docs().select("id,section,file_name,storage_path,version,mime").eq("project_id", projectId).in("section", SECTIONS);
      fail(error, "The project's drawings could not be listed");
      const list = latestPdfs(data);
      for (const r of data ?? []) paths.set(r.id, r.storage_path);
      return list;
    },
    async download(versionId) {
      let path = paths.get(versionId);
      if (!path) {
        const { data, error } = await docs().select("storage_path").eq("id", versionId).eq("project_id", projectId).maybeSingle();
        fail(error, "The drawing could not be found");
        path = data?.storage_path;
        if (!path) throw new Error("That drawing is no longer in the project's documents.");
      }
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(path);
      fail(error, "The drawing could not be downloaded");
      return new Uint8Array(await blob.arrayBuffer());
    },
    async upload(file) {
      const id = crypto.randomUUID();
      const path = `${projectId}/plans/${id}/${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
      fail(error, `${file.name} could not be added to the project's Plans`);
      const { error: rowError } = await docs().insert({ id, project_id: projectId, section: "plans", file_name: file.name, storage_path: path, size_bytes: file.size, mime: file.type || "application/pdf", note: "Added from the takeoff workspace" });
      fail(rowError, `${file.name} was uploaded but could not be filed under Plans`);
    },
    async loadTakeoff() {
      const { data, error } = await supabase.from("project_takeoffs").select("doc,version").eq("project_id", projectId).maybeSingle();
      fail(error, "The takeoff could not be loaded");
      return { doc: data?.doc ?? null, version: data?.version ?? 0 };
    },
    async saveTakeoff(doc, expectedVersion, quantities = null) {
      const { data, error } = await supabase.rpc("save_project_takeoff", { _project: projectId, _doc: doc, _expected_version: expectedVersion, _quantities: quantities ?? { conditions: [], rows: [] } });
      if (error) {
        const c = parseConflict(error.message);
        if (c) throw new ConflictError(c.version, c.by);
        throw new Error(error.message);
      }
      return data;
    },
    snapshots: {
      async list() {
        const { data, error } = await supabase.from("project_takeoff_snapshots").select("id,label,created_at,conditions:doc->conditions,shapes:doc->shapes").eq("project_id", projectId).order("created_at", { ascending: false });
        fail(error, "The saved revisions could not be listed");
        return (data ?? []).map((r) => ({ id: r.id, ts: Date.parse(r.created_at), label: r.label || null, conditions: Array.isArray(r.conditions) ? r.conditions.length : 0, shapes: Array.isArray(r.shapes) ? r.shapes.length : 0 }));
      },
      async get(id) {
        const { data, error } = await supabase.from("project_takeoff_snapshots").select("id,label,created_at,doc").eq("id", id).eq("project_id", projectId).maybeSingle();
        fail(error, "That revision could not be opened");
        return data ? { id: data.id, ts: Date.parse(data.created_at), label: data.label || null, project: projectId, payload: data.doc } : null;
      },
      async put(record) {
        const { data, error } = await supabase.from("project_takeoff_snapshots").insert({ project_id: projectId, label: String(record.label ?? "").slice(0, 200), doc: record.payload }).select("id,created_at").single();
        fail(error, "The revision could not be saved");
        return { id: data.id, ts: Date.parse(data.created_at) };
      },
      async remove(id) {
        const { error } = await supabase.from("project_takeoff_snapshots").delete().eq("id", id).eq("project_id", projectId);
        fail(error, "The revision could not be removed");
      },
    },
    library: {
      async load() {
        const { data, error } = await supabase.from("takeoff_library").select("templates,materials,stamps").eq("id", 1).maybeSingle();
        fail(error, "The company's takeoff libraries could not be loaded");
        return data ?? { templates: [], materials: [], stamps: {} };
      },
      async save(part, value) {
        if (!["templates", "materials", "stamps"].includes(part)) throw new Error("Unknown library");
        if (!canSave) return;
        const { error } = await supabase.from("takeoff_library").update({ [part]: value }).eq("id", 1);
        fail(error, "The company's takeoff library could not be saved");
      },
    },
  };
}
