import { describe, expect, test } from "bun:test";
import {
  CHUNK,
  backoffMinutes,
  createDrive,
  mirrorFileName,
  processQueue,
  projectFolderName,
  safeFolderName,
  sectionFolder,
  type MirrorDb,
  type QueueRow,
} from "./mirror";

describe("names", () => {
  test("folder names drop characters OneDrive refuses and trailing dots", () => {
    expect(safeFolderName('Kothari Group: Broadway Hotels Inc.')).toBe("Kothari Group - Broadway Hotels Inc");
    expect(safeFolderName('A/B\\C*D?"E<F>G|H')).toBe("A-B-C-D-E-F-G-H");
    expect(safeFolderName("  ...  ")).toBe("Untitled");
  });
  test("project folder is number, en dash, name", () => {
    expect(projectFolderName("26-041", "Hyatt Centric: Level 4")).toBe("26-041 – Hyatt Centric - Level 4");
    expect(projectFolderName(null, "No Number")).toBe("No Number");
  });
  test("section folders use the filing names", () => {
    expect(sectionFolder("vendor")).toBe("Vendor quotes and data sheets");
    expect(sectionFolder("quotes_sent")).toBe("Quotes sent");
  });
  test("later versions get a suffix before the extension so nothing is overwritten", () => {
    expect(mirrorFileName("A-101.pdf", 1)).toBe("A-101.pdf");
    expect(mirrorFileName("A-101.pdf", 3)).toBe("A-101 (v3).pdf");
    expect(mirrorFileName("README", 2)).toBe("README (v2)");
  });
  test("back-off grows: 1, 5, then 30 minutes", () => {
    expect([1, 2, 3, 9].map(backoffMinutes)).toEqual([1, 5, 30, 30]);
  });
});

/** A pretend OneDrive: folders by id, with a log of every request. */
function fakeGraph(opts: { failUploads?: number } = {}) {
  const log: { method: string; url: string; headers: Record<string, string>; bytes: number }[] = [];
  const folders = new Map<string, { id: string; name: string; parent: string }>([["root", { id: "root", name: "Customers", parent: "" }]]);
  const files: { parent: string; name: string; size: number }[] = [];
  const sessions = new Map<string, { parent: string; name: string; received: number }>();
  let n = 0;
  let failures = opts.failUploads ?? 0;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const bytes = init.body instanceof Uint8Array ? init.body.length : 0;
    log.push({ method, url, headers, bytes });
    let m: RegExpExecArray | null;
    if (method === "GET" && (m = /\/me\/drive\/items\/([^/]+)\/children\?\$filter=name eq '(.*)'/.exec(decodeURIComponent(url)))) {
      const hit = [...folders.values()].filter((f) => f.parent === m![1] && f.name === m![2]!.replace(/''/g, "'"));
      return json({ value: hit.map((f) => ({ id: f.id, name: f.name, folder: {} })) });
    }
    if (method === "POST" && (m = /\/me\/drive\/items\/([^/]+)\/children$/.exec(url))) {
      const body = JSON.parse(String(init.body)) as { name: string };
      if ([...folders.values()].some((f) => f.parent === m![1] && f.name === body.name)) return json({ error: { code: "nameAlreadyExists" } }, 409);
      const id = `f${++n}`;
      folders.set(id, { id, name: body.name, parent: m[1]! });
      return json({ id, name: body.name }, 201);
    }
    if (method === "POST" && (m = /\/me\/drive\/items\/([^/]+):\/(.+):\/createUploadSession$/.exec(decodeURIComponent(url)))) {
      const sid = `https://upload.example/s${++n}`;
      sessions.set(sid, { parent: m[1]!, name: m[2]!, received: 0 });
      return json({ uploadUrl: sid });
    }
    if (method === "PUT" && sessions.has(url)) {
      if (failures > 0) {
        failures -= 1;
        return json({ error: { message: "The service is unavailable." } }, 503);
      }
      const s = sessions.get(url)!;
      const [, a, b, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(headers["content-range"] ?? "")!;
      if (Number(a) !== s.received) return json({ error: { message: "range mismatch" } }, 416);
      s.received = Number(b) + 1;
      if (s.received < Number(total)) return json({ nextExpectedRanges: [`${s.received}-`] }, 202);
      files.push({ parent: s.parent, name: s.name, size: s.received });
      return json({ id: `item-${files.length}`, name: s.name }, 201);
    }
    return json({ error: { message: `unexpected ${method} ${url}` } }, 400);
  };
  return { call, log, folders, files };
}

function fakeDb(rows: QueueRow[], extra: Partial<Parameters<typeof baseDoc>[0]> = {}) {
  const state = {
    rows: rows.map((r) => ({ ...r })),
    client: { id: "c1", name: "Kothari Group", onedrive_folder_id: null as string | null },
    project: { id: "p1", project_number: "26-041", name: "Hyatt Centric", onedrive_folder_id: null as string | null, onedrive_parent_item_id: null as string | null },
    doc: baseDoc(extra),
    docStatus: "pending",
    docError: null as string | null,
    itemId: null as string | null,
  };
  const db: MirrorDb = {
    root: async () => ({ rootItemId: "root" }),
    due: async (_now, limit) => state.rows.filter((r) => r.status === "pending").slice(0, limit),
    project: async () => ({ ...state.project, client: state.client }),
    document: async () => state.doc,
    saveClientFolder: async (_id, folderId) => void (state.client.onedrive_folder_id = folderId),
    saveProjectFolder: async (_id, folderId) => void (state.project.onedrive_folder_id = folderId),
    saveQueue: async (id, patch) => void Object.assign(state.rows.find((r) => r.id === id)!, patch),
    saveDocument: async (_id, patch) => {
      if (patch.mirror_status) state.docStatus = patch.mirror_status;
      if ("mirror_error" in patch) state.docError = patch.mirror_error ?? null;
      if (patch.onedrive_item_id) state.itemId = patch.onedrive_item_id;
    },
  };
  return { db, state };
}
function baseDoc(o: Partial<{ file_name: string; version: number; size_bytes: number; section: "plans" | "vendor" }>) {
  return { id: "d1", section: "plans" as const, file_name: "A-101.pdf", version: 1, size_bytes: 1000, storage_path: "p1/plans/d1/A-101.pdf", ...o };
}
const row = (o: Partial<QueueRow> = {}): QueueRow => ({
  id: "q1", project_id: "p1", document_id: "d1", action: "upload", status: "pending", attempts: 0, last_error: null,
  next_attempt_at: "2026-11-22T00:00:00Z", upload_url: null, next_offset: 0, ...o,
});
const storage = { range: async (_path: string, start: number, end: number) => new Uint8Array(end - start + 1) };
const now = new Date("2026-11-22T12:00:00Z");

describe("drive wrapper", () => {
  test("refuses anything that could delete, move or rename", async () => {
    const g = fakeGraph();
    const drive = createDrive(g.call);
    expect(drive.request("DELETE", "/me/drive/items/x")).rejects.toThrow("not allowed");
    expect(drive.request("PATCH", "/me/drive/items/x", { name: "new" })).rejects.toThrow("not allowed");
    expect(drive.request("POST", "/me/drive/items/x/copy")).rejects.toThrow("not allowed");
    expect(g.log).toHaveLength(0);
  });
  test("an existing folder is reused rather than duplicated", async () => {
    const g = fakeGraph();
    const drive = createDrive(g.call);
    const a = await drive.ensureFolder("root", "Kothari Group");
    const b = await drive.ensureFolder("root", "Kothari Group");
    expect(a).toBe(b);
    expect([...g.folders.values()].filter((f) => f.name === "Kothari Group")).toHaveLength(1);
  });
  test("a folder name with an apostrophe is looked up safely", async () => {
    const g = fakeGraph();
    const drive = createDrive(g.call);
    const a = await drive.ensureFolder("root", "O'Brien Builders");
    expect(await drive.ensureFolder("root", "O'Brien Builders")).toBe(a);
  });
});

describe("processQueue", () => {
  test("mirrors a document into Client / Project / Section and only ever reads, creates and uploads", async () => {
    const g = fakeGraph();
    const { db, state } = fakeDb([row()]);
    const res = await processQueue({ drive: createDrive(g.call), storage, db }, now, { maxItems: 5, maxChunks: 50 });
    expect(res).toEqual({ done: 1, failed: 0, retried: 0, waiting: 0 });
    const names = (id: string): string => { const f = g.folders.get(id)!; return f.parent ? `${names(f.parent)}/${f.name}` : f.name; };
    expect(g.files).toEqual([{ parent: expect.any(String), name: "A-101.pdf", size: 1000 }]);
    expect(names(g.files[0]!.parent)).toBe("Customers/Kothari Group/26-041 – Hyatt Centric/Plans");
    expect(state.client.onedrive_folder_id).toBeTruthy();
    expect(state.project.onedrive_folder_id).toBeTruthy();
    expect(state.rows[0]!.status).toBe("done");
    expect(state.docStatus).toBe("done");
    expect(state.itemId).toBe("item-1");
    const methods = new Set(g.log.map((c) => c.method));
    expect([...methods].sort()).toEqual(["GET", "POST", "PUT"]);
    expect(g.log.filter((c) => c.method === "POST").every((c) => /\/children$|createUploadSession$/.test(c.url))).toBe(true);
    expect(g.log.some((c) => /conflictBehavior/.test(c.url))).toBe(false);
  });

  test("a confirmed client folder and a chosen parent folder are used as they are", async () => {
    const g = fakeGraph();
    g.folders.set("existing-client", { id: "existing-client", name: "KOTHARI (old name)", parent: "root" });
    g.folders.set("sub", { id: "sub", name: "Broadway Hotels Inc", parent: "existing-client" });
    const { db, state } = fakeDb([row()]);
    state.client.onedrive_folder_id = "existing-client";
    state.project.onedrive_parent_item_id = "sub";
    await processQueue({ drive: createDrive(g.call), storage, db }, now, { maxItems: 5, maxChunks: 50 });
    const projectFolder = g.folders.get(state.project.onedrive_folder_id!)!;
    expect(projectFolder.parent).toBe("sub");
    expect([...g.folders.values()].filter((f) => f.parent === "root")).toHaveLength(1);
  });

  test("a large file goes up in ordered chunks with correct ranges", async () => {
    const g = fakeGraph();
    const size = CHUNK * 2 + 123;
    const { db } = fakeDb([row()], { size_bytes: size });
    await processQueue({ drive: createDrive(g.call), storage, db }, now, { maxItems: 5, maxChunks: 50 });
    const puts = g.log.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.headers["content-range"])).toEqual([
      `bytes 0-${CHUNK - 1}/${size}`,
      `bytes ${CHUNK}-${CHUNK * 2 - 1}/${size}`,
      `bytes ${CHUNK * 2}-${size - 1}/${size}`,
    ]);
    expect(puts.every((c) => !("authorization" in c.headers))).toBe(true);
    expect(CHUNK % (320 * 1024)).toBe(0);
  });

  test("a file too big for one run stops at the chunk budget and continues next run without restarting", async () => {
    const g = fakeGraph();
    const size = CHUNK * 3;
    const { db, state } = fakeDb([row()], { size_bytes: size });
    const deps = { drive: createDrive(g.call), storage, db };
    const first = await processQueue(deps, now, { maxItems: 5, maxChunks: 2 });
    expect(first).toEqual({ done: 0, failed: 0, retried: 0, waiting: 1 });
    expect(state.rows[0]).toMatchObject({ status: "pending", next_offset: CHUNK * 2, attempts: 0 });
    expect(state.rows[0]!.upload_url).toContain("https://upload.example/");
    const second = await processQueue(deps, now, { maxItems: 5, maxChunks: 2 });
    expect(second.done).toBe(1);
    expect(g.log.filter((c) => /createUploadSession/.test(c.url))).toHaveLength(1);
    expect(g.files).toHaveLength(1);
  });

  test("a failed upload is retried with back-off and shows as failed after three attempts", async () => {
    const g = fakeGraph({ failUploads: 99 });
    const { db, state } = fakeDb([row()]);
    const deps = { drive: createDrive(g.call), storage, db };
    const r1 = await processQueue(deps, now, { maxItems: 5, maxChunks: 50 });
    expect(r1).toEqual({ done: 0, failed: 0, retried: 1, waiting: 0 });
    expect(state.rows[0]).toMatchObject({ status: "pending", attempts: 1, last_error: "The service is unavailable." });
    expect(state.rows[0]!.next_attempt_at).toBe("2026-11-22T12:01:00.000Z");
    expect(state.docStatus).toBe("pending");
    await processQueue(deps, now, { maxItems: 5, maxChunks: 50 });
    expect(state.rows[0]).toMatchObject({ attempts: 2, next_attempt_at: "2026-11-22T12:05:00.000Z" });
    const r3 = await processQueue(deps, now, { maxItems: 5, maxChunks: 50 });
    expect(r3).toEqual({ done: 0, failed: 1, retried: 0, waiting: 0 });
    expect(state.rows[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(state.docStatus).toBe("failed");
    expect(state.docError).toBe("The service is unavailable.");
  });

  test("a new project gets its folder tree before any document exists", async () => {
    const g = fakeGraph();
    const { db, state } = fakeDb([row({ action: "folder", document_id: null })]);
    await processQueue({ drive: createDrive(g.call), storage, db }, now, { maxItems: 5, maxChunks: 50 });
    const children = [...g.folders.values()].filter((f) => f.parent === state.project.onedrive_folder_id).map((f) => f.name);
    expect(children).toEqual(["Plans", "Specifications", "Vendor quotes and data sheets", "Quotes sent", "Contract", "Photos", "Other"]);
    expect(state.rows[0]!.status).toBe("done");
  });

  test("with no library folder chosen, nothing is attempted and nothing is marked failed", async () => {
    const g = fakeGraph();
    const { db, state } = fakeDb([row()]);
    db.root = async () => null;
    const res = await processQueue({ drive: createDrive(g.call), storage, db }, now, { maxItems: 5, maxChunks: 50 });
    expect(res).toEqual({ done: 0, failed: 0, retried: 0, waiting: 1 });
    expect(state.rows[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(g.log).toHaveLength(0);
  });
});

import { matchClientFolders } from "./mirror";
describe("matchClientFolders", () => {
  const folders = [{ id: "f1", name: "KOTHARI GROUP" }, { id: "f2", name: "Bird Construction" }, { id: "f3", name: "Acme" }, { id: "f4", name: "ACME." }];
  test("pairs by name ignoring case and punctuation, skipping clients already matched", () => {
    expect(
      matchClientFolders(
        [
          { id: "c1", name: "Kothari Group", onedrive_folder_id: null },
          { id: "c2", name: "Bird Construction", onedrive_folder_id: "already" },
          { id: "c3", name: "PCL", onedrive_folder_id: null },
        ],
        folders,
      ),
    ).toEqual([{ clientId: "c1", clientName: "Kothari Group", folderId: "f1", folderName: "KOTHARI GROUP", confidence: "exact" }]);
  });
  test("an ambiguous name is left for a person to decide", () => {
    expect(matchClientFolders([{ id: "c1", name: "Acme", onedrive_folder_id: null }], folders)).toEqual([]);
  });
});

describe("matchClientFolders: near matches from the real Customers folder", () => {
  const names = ["31 Colchester - Dave and Marisa Hochman", "Allard Condos", "Bost Construction", "Brian and Gail", "Britewater Living Riverbend Construction", "Bull & Filly", "Chisick, Dan", "Direct Focus", "Edgecorp", "Grace Anne", "Hofer", "Jim Patison Collison Center", "Kaebe Custome Homes", "Kotahri", "Launch Construction", "Nemy", "NEXUS HOMES", "Ray Wan Tuxedo", "Sigfusson 525 Bower", "Thiessen Construction", "Weinstein", "PCL", "MRH", "Patrick Payne Supply Only", "One Time Clients"];
  const folders = names.map((name, i) => ({ id: `f${i}`, name }));
  const c = (name: string, onedrive_folder_id: string | null = null) => ({ id: name, name, onedrive_folder_id });
  const pick = (clients: ReturnType<typeof c>[]) => matchClientFolders(clients, folders).map((p) => `${p.clientName} -> ${p.folderName} (${p.confidence})`);

  test("an exact name is marked exact; '&' and 'and' are the same word", () => {
    expect(pick([c("Bull and Filly")])).toEqual(["Bull and Filly -> Bull & Filly (exact)"]);
  });
  test("reordered names, dropped company words, extra words and small typos are offered as likely", () => {
    expect(
      pick([c("Dan Chisick"), c("EdgeCorp Group"), c("Rick Hofer"), c("Adam Nemy"), c("Michael & Erin Weinstein"), c("Brian & Gail Chornoboy"), c("Riverbend Construction"), c("Kaebe Homes"), c("Allard development inc"), c("Dorect Focus"), c("Jim Pattison Collision & Glass"), c("Bosk Construction"), c("David Hochman"), c("Heida & Skuli Sigfusson"), c("Ray Wan Architect")]),
    ).toEqual([
      "Dan Chisick -> Chisick, Dan (likely)",
      "EdgeCorp Group -> Edgecorp (likely)",
      "Rick Hofer -> Hofer (likely)",
      "Adam Nemy -> Nemy (likely)",
      "Michael & Erin Weinstein -> Weinstein (likely)",
      "Brian & Gail Chornoboy -> Brian and Gail (likely)",
      "Riverbend Construction -> Britewater Living Riverbend Construction (likely)",
      "Kaebe Homes -> Kaebe Custome Homes (likely)",
      "Allard development inc -> Allard Condos (likely)",
      "Dorect Focus -> Direct Focus (likely)",
      "Jim Pattison Collision & Glass -> Jim Patison Collison Center (likely)",
      "Bosk Construction -> Bost Construction (likely)",
      "David Hochman -> 31 Colchester - Dave and Marisa Hochman (likely)",
      "Heida & Skuli Sigfusson -> Sigfusson 525 Bower (likely)",
      "Ray Wan Architect -> Ray Wan Tuxedo (likely)",
    ]);
  });
  test("two clients that fit one folder equally are both offered; a closer fit wins outright", () => {
    expect(pick([c("Kothari Trail"), c("Kothari Place")])).toEqual(["Kothari Trail -> Kotahri (likely)", "Kothari Place -> Kotahri (likely)"]);
    expect(pick([c("Kothari Group"), c("Kothari Trail")])).toEqual(["Kothari Group -> Kotahri (likely)"]);
  });
  test("company words, short first names and unrelated names are not a match", () => {
    expect(pick([c("Bockstael Construction"), c("Emmett Leo Homes"), c("Dan Rosenblat"), c("Winnipeg Blue Bombers"), c("Procast")])).toEqual([]);
  });
  test("a short name that is the whole folder name is offered", () => {
    expect(pick([c("MRH Management")])).toEqual(["MRH Management -> MRH (likely)"]);
  });
  test("a look-alike word with a different first letter, or a generic word, is not a match", () => {
    expect(pick([c("Jayne Steeves"), c("Lev Zenter"), c("UNKNOWN CUSTOMER"), c("General Client"), c("Women's Enterprise Center")])).toEqual([]);
  });
  test("a folder goes only to the client that fits it best", () => {
    expect(pick([c("Jim Pattison Collision & Glass"), c("Jim Fettes"), c("Patrick Payne"), c("Patrick Collison")])).toEqual([
      "Jim Pattison Collision & Glass -> Jim Patison Collison Center (likely)",
      "Patrick Payne -> Patrick Payne Supply Only (likely)",
    ]);
  });
  test("a folder already linked to a client is not offered to another", () => {
    expect(pick([c("Grace Anne", "f9"), c("Grace Christian Church")])).toEqual([]);
  });
});
