// BMD change (new file): the storage adapter that keeps a takeoff in BMD Projects instead of in one browser.
//
// OpenTakeoff talks to storage through the interface described at the top of ../store.js. This implements it:
//   - the drawings are the project's own documents (Plans, then Specifications), read through `api`;
//   - the takeoff is one versioned document per project, saved only if nobody else has saved since it was loaded;
//   - a save that fails is kept in this browser and reported, never dropped;
//   - the estimator's libraries belong to the company, and snapshots to the project.
// Everything that reaches the network is injected as `api`, and everything kept in the browser as `cache`, so this
// file has no dependency on a database client and can be tested on its own.
import { takeoffQuantities } from "./quantities.js";
import { emptyAnnotations, ANN_SCHEMA } from "../store.js";
import { sanitizeTemplates } from "../templates.js";
import { sanitizeMaterialLibrary } from "../materials.js";
import { sanitizeStampLibrary } from "../stamps.js";
import { startPdfHash } from "../ocr/pdfHash.ts";

/** Someone else saved this project's takeoff after this window loaded it. */
export class ConflictError extends Error {
  constructor(version, by) {
    super(`${by || "Someone else"} saved this takeoff while you were working.`);
    this.name = "ConflictError";
    this.version = version;
    this.by = by || "Someone else";
  }
}

const SECTION_ORDER = { plans: 0, specifications: 1 };
const SECTION_LABEL = { specifications: "Specifications" };
const copyOf = (u8) => new Uint8Array(u8);

/**
 * @param {{projectId: string, api: any, cache: {get: Function, put: Function, del: Function}, onState?: (s: any) => void}} deps
 */
export function createBmdStore({ projectId, api, cache, onState = () => {} }) {
  const key = (kind, id) => `${kind}:${projectId}:${id}`;
  const crashKey = `crash:${projectId}`;

  // ── drawings ────────────────────────────────────────────────────────────
  /** @type {Promise<Map<string, {id: string, versionId: string}>> | null} name → document */
  let manifest = null;
  const changed = new Set();
  function loadManifest() {
    manifest = (async () => {
      const docs = [...(await api.listDocuments())].sort((a, b) => (SECTION_ORDER[a.section] ?? 9) - (SECTION_ORDER[b.section] ?? 9));
      const byName = new Map();
      for (const d of docs) {
        // Two documents can share a file name across sections; the later one carries its section so both stay reachable.
        const name = byName.has(d.name) ? `${SECTION_LABEL[d.section] ?? d.section} - ${d.name}` : d.name;
        byName.set(name, { id: d.id, versionId: d.versionId });
      }
      return byName;
    })();
    manifest.catch(() => { manifest = null; });
    return manifest;
  }
  const docs = () => manifest ?? loadManifest();

  /** The revision trail of one drawing in this browser: [{rev, versionId, hash, ts}], oldest first. */
  async function trail(name, entry) {
    const k = key("pdfmeta", entry.id);
    const meta = (await cache.get(k)) ?? { revs: [] };
    const last = meta.revs[meta.revs.length - 1];
    if (!last || last.versionId !== entry.versionId) {
      if (last) changed.add(name);
      meta.revs.push({ rev: (last?.rev ?? 0) + 1, versionId: entry.versionId, hash: null, ts: Date.now() });
      await cache.put(k, meta);
    }
    return { k, meta };
  }
  async function bytesFor(versionId) {
    const k = key("pdf", versionId);
    const had = await cache.get(k);
    if (had) return had;
    const fresh = copyOf(await api.download(versionId));
    await cache.put(k, fresh);
    return fresh;
  }
  async function entryFor(name) {
    const entry = (await docs()).get(name);
    if (!entry) throw new Error(`${name} is not one of this project's drawings.`);
    return entry;
  }

  const hashMemo = new Map();
  const forgetHash = (name) => void hashMemo.delete(name);
  function hashOf(name) {
    const had = hashMemo.get(name);
    if (had) return had;
    const p = (async () => {
      const entry = await entryFor(name);
      const { k, meta } = await trail(name, entry);
      const cur = meta.revs[meta.revs.length - 1];
      if (cur.hash) return cur.hash;
      const h = await startPdfHash(await bytesFor(entry.versionId));
      if (h) { cur.hash = h; await cache.put(k, meta); }
      return h;
    })().catch(() => null);
    hashMemo.set(name, p);
    p.then((h) => { if (h == null && hashMemo.get(name) === p) hashMemo.delete(name); });
    return p;
  }

  // ── the takeoff ─────────────────────────────────────────────────────────
  let version = 0;
  let stopped = null;      // "conflict" once someone else has saved; nothing more is sent
  let inFlight = null;     // the save on the wire
  let queued = null;       // the newest payload waiting behind it
  let recovery;            // crash copy found on load

  async function send(payload) {
    try {
      onState({ kind: "saving" });
      const doc = { ...payload, schema: ANN_SCHEMA };
      version = await api.saveTakeoff(doc, version, takeoffQuantities(doc));   // the estimate reads these
      await cache.del(crashKey);
      onState({ kind: "saved", version });
    } catch (e) {
      // Whatever went wrong, the work stays in this browser until a save succeeds.
      try { await cache.put(crashKey, { doc: payload, baseVersion: version, ts: Date.now() }); } catch { /* storage full or blocked */ }
      if (e instanceof ConflictError || e?.name === "ConflictError") {
        stopped = "conflict";
        onState({ kind: "conflict", version: e.version, by: e.by });
      } else {
        onState({ kind: "failed", message: String(e?.message || e) });
      }
    }
  }
  async function drain() {
    while (queued && !stopped) {
      const next = queued;
      queued = null;
      await send(next);
    }
  }

  return {
    // drawings
    async listSheets() {
      return [...(await docs()).keys()].map((name) => ({ name }));
    },
    async loadPdfData(name) {
      const entry = await entryFor(name);
      await trail(name, entry);
      return copyOf(await bytesFor(entry.versionId));   // pdf.js may detach what it is given
    },
    async addPdf(file) {
      if (!api.canSave) throw new Error("This takeoff is read-only for you, so drawings cannot be added here.");
      const existed = (await docs()).has(file.name);
      await api.upload(file);
      forgetHash(file.name);
      await loadManifest();
      const entry = (await docs()).get(file.name);
      const rev = entry ? (await trail(file.name, entry)).meta.revs.length : 1;
      return existed ? { name: file.name, rev, prev_rev: rev - 1, revised: rev > 1, unchanged: rev <= 1 } : { name: file.name, rev };
    },
    async removePdf() {
      throw new Error("Remove drawings in Documents. The takeoff workspace never deletes a project's documents.");
    },
    /** Drawings whose document has a newer version than the one this browser last showed. */
    async changedSheets() {
      for (const [name, entry] of await docs()) await trail(name, entry);
      return [...changed];
    },
    async refreshDrawings() {
      changed.clear();
      await loadManifest();
    },
    pdfHash: (name) => hashOf(name),
    async pdfHashIfKnown(name) {
      return (await hashMemo.get(name)) ?? null;
    },
    rememberPdfHash(name, hashPromise) {
      hashMemo.set(name, Promise.resolve(hashPromise).catch(() => null));
    },
    beginPdfHash(name) {
      return (hashPromise) => { hashMemo.set(name, Promise.resolve(hashPromise).catch(() => null)); };
    },
    forgetPdfHash: forgetHash,
    async listPdfRevisions(name) {
      const entry = (await docs()).get(name);
      if (!entry) return [];
      const { meta } = await trail(name, entry);
      return meta.revs.map((r, i) => ({ rev: r.rev, hash: r.hash ?? null, ts: r.ts ?? null, current: i === meta.revs.length - 1 })).sort((a, b) => b.rev - a.rev);
    },
    async loadPdfRevisionData(name, rev) {
      const entry = await entryFor(name);
      const { meta } = await trail(name, entry);
      const r = meta.revs.find((x) => x.rev === rev);
      if (!r) throw new Error(`Revision ${rev} of ${name} is not available.`);
      return copyOf(await bytesFor(r.versionId));
    },

    // the takeoff
    async loadAnnotations() {
      const loaded = await api.loadTakeoff();
      version = loaded?.version ?? 0;
      recovery = (await cache.get(crashKey)) ?? null;
      if (!api.canSave) onState({ kind: "readonly" });
      return loaded?.doc ? { ...emptyAnnotations(), ...loaded.doc } : emptyAnnotations();
    },
    saveAnnotations(payload) {
      if (!api.canSave) { onState({ kind: "readonly" }); return Promise.resolve(); }
      if (stopped) return Promise.resolve();
      queued = payload;
      if (!inFlight) inFlight = drain().finally(() => { inFlight = null; });
      return inFlight;
    },
    /** Unsaved work from an earlier session that never reached BMD Projects, or null. Offered to the estimator, never applied silently. */
    async pendingRecovery() {
      return recovery === undefined ? ((await cache.get(crashKey)) ?? null) : recovery;
    },
    async discardRecovery() {
      recovery = null;
      await cache.del(crashKey);
    },
    get version() { return version; },

    // the company's libraries
    async loadTemplates() { return sanitizeTemplates((await api.library.load())?.templates); },
    async saveTemplates(list) { await api.library.save("templates", Array.isArray(list) ? list : []); },
    async loadMaterialLibrary() { return sanitizeMaterialLibrary((await api.library.load())?.materials); },
    async saveMaterialLibrary(list) { await api.library.save("materials", Array.isArray(list) ? list : []); },
    async loadStampLibrary() { return sanitizeStampLibrary((await api.library.load())?.stamps); },
    async saveStampLibrary(lib) { await api.library.save("stamps", sanitizeStampLibrary(lib)); },

    // snapshots
    async saveSnapshot(label, payload) {
      return api.snapshots.put({ label: String(label || "").trim() || null, payload });
    },
    async putSnapshot(record) {
      if (!record || typeof record.id !== "string" || !record.id.trim()) throw new Error("putSnapshot: record.id (non-empty string) required");
      if (record.payload == null) throw new Error("putSnapshot: record.payload required");
      await api.snapshots.put(record);
    },
    async listSnapshots() {
      const rows = (await api.snapshots.list()) ?? [];
      return rows.map((r) => ({ id: r.id, ts: r.ts, label: r.label ?? null, conditions: r.conditions ?? (r.payload?.conditions || []).length, shapes: r.shapes ?? (r.payload?.shapes || []).length })).sort((a, b) => b.ts - a.ts);
    },
    getSnapshot: (id) => api.snapshots.get(id),
    deleteSnapshot: (id) => api.snapshots.remove(id),
  };
}
