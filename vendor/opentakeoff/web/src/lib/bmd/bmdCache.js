// BMD change (new file): a small key-value store in this browser for downloaded drawings and unsaved work.
// It is a convenience copy only. The project's documents and its saved takeoff live in BMD Projects.
const DB = "bmd-takeoff";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** Falls back to memory when the browser blocks storage (private windows), so the workspace still opens. */
export function createBmdCache() {
  const memory = new Map();
  let broken = typeof indexedDB === "undefined";
  const safe = async (viaDb, viaMemory) => {
    if (broken) return viaMemory();
    try {
      return await viaDb();
    } catch {
      broken = true;
      return viaMemory();
    }
  };
  return {
    get: (k) => safe(() => run("readonly", (os) => os.get(k)), () => memory.get(k)),
    put: (k, v) => safe(() => run("readwrite", (os) => os.put(v, k)), () => void memory.set(k, v)),
    del: (k) => safe(() => run("readwrite", (os) => os.delete(k)), () => void memory.delete(k)),
  };
}
