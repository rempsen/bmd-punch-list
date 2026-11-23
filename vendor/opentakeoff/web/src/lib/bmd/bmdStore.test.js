import { describe, expect, test } from "bun:test";
import { createBmdStore, ConflictError } from "./bmdStore.js";
import { emptyAnnotations } from "../store.js";

const bytes = (s) => new TextEncoder().encode(s);
const text = (u8) => new TextDecoder().decode(u8);
const memCache = (map = new Map()) => ({ map, get: async (k) => map.get(k), put: async (k, v) => void map.set(k, v), del: async (k) => void map.delete(k) });
const doc = (name, versionId, section = "plans", id = name) => ({ id, name, section, versionId });

function harness(over = {}) {
  const calls = { download: [], save: [], upload: [], lib: [] };
  const state = { docs: over.docs ?? [doc("A-101.pdf", "v1")], files: { v1: "one", v2: "two", w1: "other" }, takeoff: over.takeoff ?? { doc: null, version: 0 }, lib: { templates: [], materials: [], stamps: {} }, snaps: [] };
  const api = {
    canSave: over.canSave ?? true,
    listDocuments: async () => state.docs,
    download: async (versionId) => (calls.download.push(versionId), bytes(state.files[versionId])),
    loadTakeoff: async () => state.takeoff,
    saveTakeoff: over.saveTakeoff ?? (async (d, expected) => (calls.save.push([d, expected]), expected + 1)),
    upload: async (file) => { calls.upload.push(file.name); state.files["up-" + file.name] = "uploaded"; state.docs = [...state.docs, doc(file.name, "up-" + file.name)]; },
    snapshots: { list: async () => state.snaps, get: async (id) => state.snaps.find((s) => s.id === id) ?? null, put: async (r) => { const rec = { id: r.id ?? "s" + state.snaps.length, ts: r.ts ?? 1, ...r }; state.snaps.push(rec); return { id: rec.id, ts: rec.ts }; }, remove: async (id) => { state.snaps = state.snaps.filter((s) => s.id !== id); } },
    library: { load: async () => state.lib, save: async (part, value) => { calls.lib.push(part); state.lib[part] = value; } },
  };
  const seen = [];
  const cache = over.cache ?? memCache();
  const store = createBmdStore({ projectId: over.projectId ?? "p1", api, cache, onState: (s) => seen.push(s) });
  return { store, api, calls, state, seen, cache };
}

describe("drawings come from the project's documents", () => {
  test("lists only this project's PDFs, plans before specifications", async () => {
    const { store } = harness({ docs: [doc("A-101.pdf", "w1", "specifications", "d2"), doc("A-101.pdf", "v1", "plans", "d1"), doc("Spec.pdf", "v2", "specifications", "d3")] });
    expect(await store.listSheets()).toEqual([{ name: "A-101.pdf" }, { name: "Specifications - A-101.pdf" }, { name: "Spec.pdf" }]);
    expect(text(await store.loadPdfData("Specifications - A-101.pdf"))).toBe("other");
  });
  test("loads bytes once and serves them from the cache afterwards", async () => {
    const { store, calls } = harness();
    expect(text(await store.loadPdfData("A-101.pdf"))).toBe("one");
    const again = await store.loadPdfData("A-101.pdf");
    expect(text(again)).toBe("one");
    expect(calls.download).toEqual(["v1"]);
  });
  test("each caller gets its own copy of the bytes", async () => {
    const { store } = harness();
    const a = await store.loadPdfData("A-101.pdf");
    a.fill(0);
    expect(text(await store.loadPdfData("A-101.pdf"))).toBe("one");
  });
  test("a new document version is downloaded again and reported as a revision", async () => {
    const h = harness();
    await h.store.loadPdfData("A-101.pdf");
    h.state.docs = [doc("A-101.pdf", "v2")];
    const again = createBmdStore({ projectId: "p1", api: h.api, cache: h.cache, onState: () => {} });
    expect(text(await again.loadPdfData("A-101.pdf"))).toBe("two");
    const revs = await again.listPdfRevisions("A-101.pdf");
    expect(revs.map((r) => [r.rev, r.current])).toEqual([[2, true], [1, false]]);
    expect(text(await again.loadPdfRevisionData("A-101.pdf", 1))).toBe("one");
    expect(await again.changedSheets()).toEqual(["A-101.pdf"]);
  });
  test("the cache is per project", async () => {
    const cache = memCache();
    const a = harness({ cache, projectId: "pA" });
    await a.store.loadPdfData("A-101.pdf");
    const b = harness({ cache, projectId: "pB", docs: [doc("A-101.pdf", "w1")] });
    expect(text(await b.store.loadPdfData("A-101.pdf"))).toBe("other");
    expect(text(await a.store.loadPdfData("A-101.pdf"))).toBe("one");
  });
  test("a drawing that is not in the project is an error, not another project's file", async () => {
    await expect(harness().store.loadPdfData("Nope.pdf")).rejects.toThrow("Nope.pdf is not one of this project's drawings.");
  });
  test("removing a drawing is refused", async () => {
    await expect(harness().store.removePdf("A-101.pdf")).rejects.toThrow("Remove drawings in Documents.");
  });
  test("a dropped file is uploaded to the project's plans", async () => {
    const { store, calls } = harness();
    const out = await store.addPdf(new File([bytes("x")], "New.pdf", { type: "application/pdf" }));
    expect(calls.upload).toEqual(["New.pdf"]);
    expect(out).toMatchObject({ name: "New.pdf" });
    expect(await store.listSheets()).toContainEqual({ name: "New.pdf" });
  });
  test("a read-only viewer cannot add drawings", async () => {
    const { store, calls } = harness({ canSave: false });
    await expect(store.addPdf(new File([bytes("x")], "New.pdf"))).rejects.toThrow(/read-only/i);
    expect(calls.upload).toEqual([]);
  });
  test("the store never looks like a folder-browsing cloud store", () => {
    expect(typeof harness().store.listFolder).toBe("undefined");
  });
});

describe("the takeoff is saved in BMD Projects", () => {
  test("an empty project loads the empty takeoff", async () => {
    expect(await harness().store.loadAnnotations()).toEqual(emptyAnnotations());
  });
  test("saves carry the version that was loaded and move it forward", async () => {
    const { store, calls } = harness({ takeoff: { doc: { ...emptyAnnotations(), shapes: [{ id: "a" }] }, version: 3 } });
    expect((await store.loadAnnotations()).shapes).toEqual([{ id: "a" }]);
    await store.saveAnnotations({ n: 1 });
    await store.saveAnnotations({ n: 2 });
    expect(calls.save.map(([d, v]) => [d.n, v])).toEqual([[1, 3], [2, 4]]);
  });
  test("each save carries the measured quantities for the estimate", async () => {
    let sent = null;
    const { store } = harness({ saveTakeoff: async (d, expected, q) => { sent = q; return expected + 1; } });
    await store.loadAnnotations();
    await store.saveAnnotations({ conditions: [{ id: "cnd-1", finish_tag: "CPT-1", color: "#111111", waste_pct: 10 }], shapes: [{ id: "s", condition_id: "cnd-1", measure_role: "floor_area", computed: { area_sf: 120 } }] });
    expect(sent.conditions).toEqual([{ key: "cnd-1", tag: "CPT-1", variant: false, colour: "#111111" }]);
    expect(sent.rows).toEqual([{ key: "cnd-1", section: "", floor_sf: 120, wall_sf: 0, border_sf: 0, lf: 0, ea: 0 }]);
  });
  test("saves are one at a time and the latest wins", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const saved = [];
    const { store } = harness({ saveTakeoff: async (d, expected) => { saved.push([d.n, expected]); if (saved.length === 1) await gate; return expected + 1; } });
    await store.loadAnnotations();
    const first = store.saveAnnotations({ n: 1 });
    const second = store.saveAnnotations({ n: 2 });
    const third = store.saveAnnotations({ n: 3 });
    release();
    await Promise.all([first, second, third]);
    expect(saved).toEqual([[1, 0], [3, 1]]);
  });
  test("a conflict stops saving and reports who saved", async () => {
    let n = 0;
    const { store, seen } = harness({ saveTakeoff: async () => { n++; throw new ConflictError(5, "Brian"); } });
    await store.loadAnnotations();
    await store.saveAnnotations({ n: 1 });
    await store.saveAnnotations({ n: 2 });
    expect(n).toBe(1);
    expect(seen.at(-1)).toMatchObject({ kind: "conflict", version: 5, by: "Brian" });
  });
  test("a failed save is kept in the browser and reported, and the next success clears it", async () => {
    let fail = true;
    const h = harness({ saveTakeoff: async (d, expected) => { if (fail) throw new Error("offline"); return expected + 1; } });
    await h.store.loadAnnotations();
    await h.store.saveAnnotations({ n: 1 });
    expect(h.seen.at(-1)).toMatchObject({ kind: "failed" });
    expect((await h.cache.get("crash:p1")).doc).toEqual({ n: 1 });
    fail = false;
    await h.store.saveAnnotations({ n: 2 });
    expect(h.seen.at(-1)).toMatchObject({ kind: "saved", version: 1 });
    expect(await h.cache.get("crash:p1")).toBeUndefined();
  });
  test("a crash copy from an unsaved session is offered on load, not applied", async () => {
    const cache = memCache(new Map([["crash:p1", { doc: { n: 9 }, baseVersion: 2, ts: 5 }]]));
    const { store } = harness({ cache, takeoff: { doc: { ...emptyAnnotations(), shapes: [] }, version: 2 } });
    expect((await store.loadAnnotations()).shapes).toEqual([]);
    expect(await store.pendingRecovery()).toMatchObject({ doc: { n: 9 }, baseVersion: 2 });
  });
  test("read-only never saves", async () => {
    const { store, calls, seen } = harness({ canSave: false });
    await store.loadAnnotations();
    await store.saveAnnotations({ n: 1 });
    expect(calls.save).toEqual([]);
    expect(seen.some((s) => s.kind === "readonly")).toBe(true);
  });
  test("a very large takeoff saves whole", async () => {
    const { store, calls } = harness();
    await store.loadAnnotations();
    const big = { shapes: Array.from({ length: 200_000 }, (_, i) => ({ id: "s" + i, pts: [i, i + 1, i + 2, i + 3] })) };
    await store.saveAnnotations(big);
    expect(calls.save[0][0].shapes.length).toBe(200_000);
    expect(calls.save[0][0].shapes[199_999]).toEqual({ id: "s199999", pts: [199999, 200000, 200001, 200002] });
  });
});

describe("libraries and snapshots", () => {
  test("libraries are the company's", async () => {
    const { store, calls, state } = harness();
    await store.saveTemplates([{ id: "t" }]);
    await store.saveMaterialLibrary([{ id: "m" }]);
    await store.saveStampLibrary({ stamps: [] });
    expect(calls.lib).toEqual(["templates", "materials", "stamps"]);
    expect(Array.isArray(await store.loadTemplates())).toBe(true);
    expect(Array.isArray(await store.loadMaterialLibrary())).toBe(true);
    expect(state.lib.templates).toEqual([{ id: "t" }]);
  });
  test("snapshots are kept with the project and listed without their contents", async () => {
    const { store } = harness();
    const { id } = await store.saveSnapshot("Addendum 1", { conditions: [{}, {}], shapes: [{}] });
    expect(await store.listSnapshots()).toEqual([expect.objectContaining({ id, label: "Addendum 1", conditions: 2, shapes: 1 })]);
    expect((await store.getSnapshot(id)).payload.shapes).toEqual([{}]);
    await store.deleteSnapshot(id);
    expect(await store.listSnapshots()).toEqual([]);
  });
});
