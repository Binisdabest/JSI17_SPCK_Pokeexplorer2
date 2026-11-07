/* ==========================================================
   cache.js
   Three layers, fastest first:
     1. memory      Maps that live until the tab closes
     2. IndexedDB   big data (the whole Pokédex index, API responses), survives reloads
     3. localStorage  only tiny cache metadata (version + creation time), never data

   Every record carries `savedAt`; anything older than its TTL counts as missing.
   When CACHE_VERSION changes, everything stored by an older version is wiped on the next open.
   If IndexedDB is unavailable (private mode, blocked, quota) everything still works from memory + network.
   ========================================================== */

/** Bump when the shape of stored records changes. Old data is dropped automatically. */
export const CACHE_VERSION = 1;
export const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL = 30 * DAY;

const DB_NAME = "pokeexplorer-cache";
const DB_VERSION = 1;
const META_KEY = "pe_cache_meta";
const STORES = { kv: "key", dex: "id", names: "id" }; // store name -> keyPath

/* ---------- localStorage metadata (tiny) ---------- */

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || null; } catch { return null; }
}
function writeMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* private mode: fine */ }
}
/** {version, createdAt} of the data currently stored, for a "cache info" readout. */
export const cacheInfo = () => readMeta();

/* ---------- IndexedDB plumbing ---------- */

let dbPromise = null;
let writesDisabled = false; // set after a quota error so we stop retrying

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
});

/** Opens the database once. Resolves null (never rejects) when IndexedDB can't be used. */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = async () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      try {
        const meta = readMeta();
        if (!meta || meta.version !== CACHE_VERSION) {
          await clearStores(db); // data from an older version (or none): start clean
          writeMeta({ version: CACHE_VERSION, createdAt: Date.now() });
        }
        resolve(db);
      } catch { resolve(null); }
    };
  });
  return dbPromise;
}

async function clearStores(db) {
  const tx = db.transaction(Object.keys(STORES), "readwrite");
  Object.keys(STORES).forEach((name) => tx.objectStore(name).clear());
  await txDone(tx);
}

async function idbGet(store, key) {
  const db = await openDb();
  if (!db) return undefined;
  try { return await wrap(db.transaction(store).objectStore(store).get(key)); } catch { return undefined; }
}
async function idbGetAll(store) {
  const db = await openDb();
  if (!db) return [];
  try { return await wrap(db.transaction(store).objectStore(store).getAll()); } catch { return []; }
}
async function idbPutMany(store, records) {
  const db = await openDb();
  if (!db || writesDisabled || !records.length) return false;
  try {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    records.forEach((r) => os.put(r));
    await txDone(tx);
    return true;
  } catch (err) {
    if (err?.name === "QuotaExceededError") writesDisabled = true; // keep working from memory
    return false;
  }
}

const fresh = (record, ttl) => record && Date.now() - record.savedAt <= ttl;

/* ---------- generic key/value cache (memory -> IndexedDB) ---------- */

const kvMemory = new Map();

/** Cached value for `key`, or undefined when missing or older than `ttl`. */
export async function cacheGet(key, ttl = DEFAULT_TTL) {
  const hit = kvMemory.get(key);
  if (fresh(hit, ttl)) return hit.value;
  const stored = await idbGet("kv", key);
  if (fresh(stored, ttl)) { kvMemory.set(key, stored); return stored.value; }
  return undefined;
}

export async function cacheSet(key, value) {
  const record = { key, value, savedAt: Date.now() };
  kvMemory.set(key, record);
  await idbPutMany("kv", [record]);
}

/* ---------- Pokédex records (one compact object per Pokémon) ---------- */

/** id -> simplified Pokémon record. Filled from IndexedDB at startup and as records arrive. */
export const dexMemory = new Map();
/** id -> {id, names:[...]}: translated names, used only to make search smarter. */
export const altMemory = new Map();

/** Loads every stored, unexpired Pokédex record into memory. Call once; cheap (a few hundred KB). */
export async function loadStoredDex(ttl = DEFAULT_TTL) {
  const [dex, names] = await Promise.all([idbGetAll("dex"), idbGetAll("names")]);
  dex.forEach((r) => { if (fresh(r, ttl) && r.data) dexMemory.set(r.id, r.data); });
  names.forEach((r) => { if (fresh(r, ttl) && Array.isArray(r.names)) altMemory.set(r.id, r.names); });
}

export async function dexGet(id) {
  if (dexMemory.has(id)) return dexMemory.get(id);
  await loadStoredDexOnce();
  return dexMemory.get(id);
}
let storedLoad = null;
export const loadStoredDexOnce = () => (storedLoad ||= loadStoredDex());

/** Remembers simplified records (in memory right away, in IndexedDB as one batch write). */
export async function dexPut(records) {
  const now = Date.now();
  records.forEach((r) => dexMemory.set(r.id, r));
  await idbPutMany("dex", records.map((data) => ({ id: data.id, data, savedAt: now })));
}

export async function altPut(entries) {
  const now = Date.now();
  entries.forEach((e) => altMemory.set(e.id, e.names));
  await idbPutMany("names", entries.map((e) => ({ id: e.id, names: e.names, savedAt: now })));
}

/** Wipes everything cached (used by the "reset offline data" link). */
export async function cacheClear() {
  kvMemory.clear(); dexMemory.clear(); altMemory.clear(); storedLoad = null;
  const db = await openDb();
  if (db) { try { await clearStores(db); } catch { /* ignore */ } }
  writeMeta({ version: CACHE_VERSION, createdAt: Date.now() });
}

/* ---------- network helpers ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch + JSON with a few polite retries for network errors, 429 and 5xx. 404 and other 4xx fail at once.
 * Errors carry `.status` (0 for network failures).
 */
export async function fetchJson(url, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      const error = Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (err) {
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      lastError = err.status !== undefined ? err : Object.assign(new Error("Could not reach PokéAPI"), { status: 0 });
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt);
  }
  throw lastError;
}

/** In-flight request sharing: two callers asking for the same URL at once make ONE request. */
const inflight = new Map();
export function dedupe(key, producer) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve().then(producer).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Cached JSON (memory + IndexedDB) for SMALL responses. Large ones should use `memoJson` instead. */
export function cachedJson(url, { ttl = DEFAULT_TTL, key = "url:" + url } = {}) {
  return dedupe(key, async () => {
    const hit = await cacheGet(key, ttl);
    if (hit !== undefined) return hit;
    const data = await fetchJson(url);
    await cacheSet(key, data);
    return data;
  });
}

/** Memory-only JSON cache with a size cap (oldest dropped first) for big responses we don't want in IndexedDB. */
const memo = new Map();
export function memoJson(url, max = 40) {
  if (memo.has(url)) return Promise.resolve(memo.get(url));
  return dedupe("memo:" + url, async () => {
    const data = await fetchJson(url, { retries: 1 });
    memo.set(url, data);
    if (memo.size > max) memo.delete(memo.keys().next().value);
    return data;
  });
}
