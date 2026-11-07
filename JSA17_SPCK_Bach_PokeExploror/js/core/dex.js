/* ==========================================================
   dex.js
   The searchable Pokédex index behind the search page. No DOM in here.

   What loads, and when:
     ready()          ~20 small requests (names + the 18 type lists), cached 30 days. After this, autocomplete,
                      type filters, generation filters and sorting by number/name all work for every Pokémon.
     startIndexing()  base stats, height, weight and abilities for all 1025 Pokémon, plus translated names.
                      One GraphQL request when possible, otherwise a throttled one-request-per-Pokémon crawl.
                      Runs when the browser is idle, pauses while the tab is hidden, stores into IndexedDB in
                      batches and can be interrupted at any point: the next visit only fetches what is missing.

   Until the stats are in, number-based filters and sorts only see the Pokémon loaded so far. query() reports
   exactly how many are missing so the page can say so instead of silently showing partial results.
   ========================================================== */

import { POKEAPI_BASE, MAX_DEX_ID, TYPE_COLORS, getAllNames, simplifyPokemon, artworkUrl } from "./api.js";
import { cacheGet, cacheSet, fetchJson, dexMemory, altMemory, dexPut, altPut, loadStoredDexOnce } from "./cache.js";

export const TYPES = Object.keys(TYPE_COLORS); // all 18

export const GENERATIONS = [
  { n: 1, roman: "I", region: "Kanto", from: 1, to: 151 },
  { n: 2, roman: "II", region: "Johto", from: 152, to: 251 },
  { n: 3, roman: "III", region: "Hoenn", from: 252, to: 386 },
  { n: 4, roman: "IV", region: "Sinnoh", from: 387, to: 493 },
  { n: 5, roman: "V", region: "Unova", from: 494, to: 649 },
  { n: 6, roman: "VI", region: "Kalos", from: 650, to: 721 },
  { n: 7, roman: "VII", region: "Alola", from: 722, to: 809 },
  { n: 8, roman: "VIII", region: "Galar / Hisui", from: 810, to: 905 },
  { n: 9, roman: "IX", region: "Paldea", from: 906, to: 1025 }
];
/** Generation a Pokédex number was introduced in (the National Dex ranges are fixed history, so no request needed). */
export const generationOf = (id) => (GENERATIONS.find((g) => id >= g.from && id <= g.to) || GENERATIONS[8]).n;

export const STAT_KEYS = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"];

/** Everything that can be sorted or range-filtered, in display order. */
export const FIELDS = [
  { key: "id", label: "Pokédex number", sortOnly: true },
  { key: "name", label: "Name", sortOnly: true },
  { key: "height", label: "Height", unit: "m" },
  { key: "weight", label: "Weight", unit: "kg" },
  { key: "bst", label: "Base Stat Total" },
  { key: "hp", label: "HP" },
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "special-attack", label: "Sp. Atk" },
  { key: "special-defense", label: "Sp. Def" },
  { key: "speed", label: "Base Speed" }
];

export const bstOf = (rec) => STAT_KEYS.reduce((sum, k) => sum + (rec.stats?.[k] || 0), 0);
export function fieldValue(rec, key) {
  if (!rec) return null;
  if (key === "height" || key === "weight") return rec[key];
  if (key === "bst") return bstOf(rec);
  return rec.stats?.[key] ?? null;
}

/** "mr-mime" -> "Mr Mime" for display. */
export const prettyName = (name) => String(name).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Lower-case, accent-free, punctuation-free text for matching: "Mr. Mime" and "mr-mime" both become "mr mime". */
export const fold = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’:]/g, "").replace(/[-_]/g, " ").trim();

/* ---------- events ---------- */

const listeners = new Set();
/** fn({type: "base" | "records" | "progress" | "state"}). Returns an unsubscribe function. */
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (type) => listeners.forEach((fn) => { try { fn({ type }); } catch (err) { console.error(err); } });

/* ---------- base index: names + types ---------- */

let names = null;               // names[id - 1]
let foldedNames = null;         // same order, folded for matching
const typeMap = new Map();      // id -> ["grass", "poison"]
let basePromise = null;

const idFromUrl = (url) => Number(/\/pokemon\/(\d+)\/?$/.exec(url)?.[1]);

async function loadTypeList(type) {
  const stored = await cacheGet("dex-type:" + type);
  if (stored) return stored;
  const raw = await fetchJson(`${POKEAPI_BASE}/type/${type}`);
  // Keep only [id, slot] for base species: ids above 1025 are alternate forms (Megas, regional variants...).
  const compact = raw.pokemon
    .map((p) => [idFromUrl(p.pokemon.url), p.slot])
    .filter(([id]) => id >= 1 && id <= MAX_DEX_ID);
  await cacheSet("dex-type:" + type, compact);
  return compact;
}

async function loadBase() {
  const [list] = await Promise.all([getAllNames(), loadStoredDexOnce()]);
  const failed = [];
  await Promise.all(TYPES.map(async (type) => {
    try {
      (await loadTypeList(type)).forEach(([id, slot]) => {
        const entry = typeMap.get(id) || [];
        entry[slot - 1] = type;
        typeMap.set(id, entry);
      });
    } catch { failed.push(type); }
  }));
  // Missing type lists are only acceptable when every Pokémon's types are already known from stored records.
  if (failed.length && dexMemory.size < MAX_DEX_ID) throw new Error("Could not load the Pokémon type lists");
  names = list;
  foldedNames = list.map(fold);
  emit("base");
}

/** Resolves when names and types are loaded. Rejects (and can be retried by calling again) when PokéAPI is unreachable. */
export function ready() {
  if (!basePromise) basePromise = loadBase().catch((err) => { basePromise = null; throw err; });
  return basePromise;
}
export const isReady = () => names !== null;

/* ---------- bulk loading (stats + translated names) ---------- */

const crawl = { promise: null, boost: false, phase: "idle", done: 0, total: 0, failed: new Set(), graphqlBroken: false };

/** Skip automatic background downloads on Data Saver or 2G connections. The user can still start it by hand. */
export function canAutoPrefetch() {
  const c = navigator.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/(^|-)2g$/.test(c.effectiveType || "");
}

/** Snapshot for progress UI. */
export const progress = () => ({
  running: !!crawl.promise,
  phase: crawl.phase,
  done: crawl.done,
  total: crawl.total,
  failed: crawl.failed.size,
  statsLoaded: dexMemory.size,
  namesLoaded: altMemory.size,
  statsTotal: MAX_DEX_ID
});

const GRAPHQL_URL = "https://beta.pokeapi.co/graphql/v1beta";
const ALT_LANGS = ["ja", "ja-Hrkt", "roomaji", "ko", "zh-Hans", "zh-Hant", "fr", "de", "es", "it"];

async function graphql(query) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error("GraphQL " + response.status);
  const body = await response.json();
  if (body.errors || !body.data) throw new Error("GraphQL returned errors");
  return body.data;
}

/** All base stats in ONE request. Throws on any problem so the caller can fall back to the per-Pokémon crawl. */
async function bulkStats() {
  const data = await graphql(`{
    pokemon_v2_pokemon(where: {id: {_lte: ${MAX_DEX_ID}}}, order_by: {id: asc}) {
      id name height weight
      pokemon_v2_pokemontypes(order_by: {slot: asc}) { pokemon_v2_type { name } }
      pokemon_v2_pokemonstats(order_by: {stat_id: asc}) { base_stat pokemon_v2_stat { name } }
      pokemon_v2_pokemonabilities(order_by: {slot: asc}) { pokemon_v2_ability { name } }
    }
  }`);
  const records = [];
  for (const row of data.pokemon_v2_pokemon || []) {
    const stats = Object.fromEntries((row.pokemon_v2_pokemonstats || []).map((s) => [s.pokemon_v2_stat?.name, s.base_stat]));
    const types = (row.pokemon_v2_pokemontypes || []).map((t) => t.pokemon_v2_type?.name).filter(Boolean);
    const valid = Number.isInteger(row.id) && typeof row.name === "string" && types.length >= 1 && STAT_KEYS.every((k) => Number.isFinite(stats[k]));
    if (!valid) continue;
    records.push({
      id: row.id,
      name: row.name,
      types,
      height: row.height / 10,
      weight: row.weight / 10,
      abilities: (row.pokemon_v2_pokemonabilities || []).map((a) => a.pokemon_v2_ability?.name).filter(Boolean),
      stats: Object.fromEntries(STAT_KEYS.map((k) => [k, stats[k]])),
      artwork: artworkUrl(row.id)
    });
  }
  if (records.length < MAX_DEX_ID * 0.9) throw new Error("GraphQL answer incomplete");
  return records;
}

async function bulkNames() {
  const list = ALT_LANGS.map((l) => `"${l}"`).join(",");
  const data = await graphql(`{
    pokemon_v2_pokemonspecies(where: {id: {_lte: ${MAX_DEX_ID}}}, order_by: {id: asc}) {
      id
      pokemon_v2_pokemonspeciesnames(where: {pokemon_v2_language: {name: {_in: [${list}]}}}) { name }
    }
  }`);
  const out = (data.pokemon_v2_pokemonspecies || [])
    .filter((s) => Number.isInteger(s.id))
    .map((s) => ({ id: s.id, names: [...new Set((s.pokemon_v2_pokemonspeciesnames || []).map((n) => n.name).filter(Boolean))] }));
  if (out.length < MAX_DEX_ID * 0.9) throw new Error("GraphQL answer incomplete");
  return out;
}

async function restNames(id) {
  const raw = await fetchJson(`${POKEAPI_BASE}/pokemon-species/${id}`);
  const wanted = new Set(ALT_LANGS);
  const found = (raw.names || []).filter((n) => wanted.has(n.language?.name)).map((n) => n.name);
  return { id, names: [...new Set(found)] };
}
const restStats = async (id) => simplifyPokemon(await fetchJson(`${POKEAPI_BASE}/pokemon/${id}`));

/** Waits until the tab is visible, then (unless boosted) until the browser is idle. */
async function gate() {
  while (document.hidden) await new Promise((r) => document.addEventListener("visibilitychange", r, { once: true }));
  if (crawl.boost) return;
  await new Promise((r) => ("requestIdleCallback" in window ? requestIdleCallback(r, { timeout: 1500 }) : setTimeout(r, 30)));
}

/** Runs `work(id)` over `ids` with a few requests in flight, saving finished records in batches of 20. */
async function pool(phase, ids, work, save) {
  crawl.phase = phase; crawl.done = 0; crawl.total = ids.length;
  emit("progress");
  let next = 0;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending; pending = [];
    await save(batch);
    emit("records");
  };
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      await gate();
      try {
        const record = await work(id);
        pending.push(record); // look `pending` up AFTER the await: another worker may have swapped the array meanwhile
      } catch { crawl.failed.add(id); }
      crawl.done++;
      if (pending.length >= 20) await flush();
      emit("progress");
    }
  };
  const width = crawl.boost ? 8 : 4;
  await Promise.all(Array.from({ length: width }, worker));
  await flush();
}

const missing = (has) => Array.from({ length: MAX_DEX_ID }, (_, i) => i + 1).filter((id) => !has(id));

async function runIndexing(withNames) {
  await loadStoredDexOnce();

  let ids = missing((id) => dexMemory.has(id));
  if (ids.length > 50 && !crawl.graphqlBroken) {
    crawl.phase = "stats"; crawl.done = 0; crawl.total = ids.length; emit("progress");
    try { await dexPut(await bulkStats()); emit("records"); ids = missing((id) => dexMemory.has(id)); }
    catch { crawl.graphqlBroken = true; } // fall back to one request per Pokémon
  }
  if (ids.length) await pool("stats", ids, restStats, dexPut);

  if (withNames) {
    ids = missing((id) => altMemory.has(id));
    if (ids.length > 50 && !crawl.graphqlBroken) {
      crawl.phase = "names"; crawl.done = 0; crawl.total = ids.length; emit("progress");
      try { await altPut(await bulkNames()); emit("records"); ids = missing((id) => altMemory.has(id)); }
      catch { crawl.graphqlBroken = true; }
    }
    if (ids.length) await pool("names", ids, restNames, altPut);
  }
}

/**
 * Downloads whatever stats/names are not stored yet. Safe to call repeatedly: a run in progress is reused.
 * `boost: true` (the user is waiting on it) skips the wait-for-idle step and uses more parallel requests.
 */
export function startIndexing({ boost = false, names: withNames = true } = {}) {
  if (boost) crawl.boost = true;
  if (!crawl.promise) {
    crawl.failed = new Set();
    crawl.promise = runIndexing(withNames)
      .catch((err) => console.warn("Pokédex indexing stopped:", err.message))
      .finally(() => { crawl.promise = null; crawl.boost = false; crawl.phase = "idle"; emit("state"); });
    emit("state");
  }
  return crawl.promise;
}

/* ---------- search + filter + sort (pure, in memory) ---------- */

const activeBound = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

/** True when a range has at least one real bound. */
export const rangeActive = (r) => !!r && (activeBound(r.min) || activeBound(r.max));

function typeMatches(types, c) {
  if (!c.types || !c.types.size) return true;
  if (!types) return false;
  if (c.typeSlot === "primary") return c.types.has(types[0]);
  if (c.typeSlot === "secondary") return types[1] !== undefined && c.types.has(types[1]);
  if (c.typeMode === "all") return [...c.types].every((t) => types.includes(t));
  return types.some((t) => c.types.has(t));
}

/**
 * Filters and sorts every Pokémon.
 * criteria: {types:Set, typeMode:"any"|"all", typeSlot:"either"|"primary"|"secondary", gens:Set<number>,
 *            ranges:{[field]: {min,max}}, sort:{key, dir:"asc"|"desc"}}
 * Returns {items:[{id,name,types,rec}], pendingStats, usesStats}. `pendingStats` is how many Pokémon could not be
 * checked (or sorted properly) because their stats have not been downloaded yet.
 */
export function query(c) {
  if (!names) return { items: [], pendingStats: 0, usesStats: false };
  const ranges = Object.entries(c.ranges || {}).filter(([, r]) => rangeActive(r));
  const sortKey = c.sort?.key || "id";
  const usesStats = ranges.length > 0 || !(sortKey === "id" || sortKey === "name");
  const items = [];
  let skipped = 0;

  for (let id = 1; id <= MAX_DEX_ID; id++) {
    const rec = dexMemory.get(id) || null;
    const types = rec ? rec.types : typeMap.get(id) || null;
    if (c.gens && c.gens.size && !c.gens.has(generationOf(id))) continue;
    if (!typeMatches(types, c)) continue;
    if (ranges.length) {
      if (!rec) { skipped++; continue; }
      let ok = true;
      for (const [key, r] of ranges) {
        const v = fieldValue(rec, key);
        if ((activeBound(r.min) && v < Number(r.min)) || (activeBound(r.max) && v > Number(r.max))) { ok = false; break; }
      }
      if (!ok) continue;
    }
    items.push({ id, name: names[id - 1], types, rec });
  }

  const dir = c.sort?.dir === "desc" ? -1 : 1;
  items.sort((a, b) => {
    if (sortKey === "id") return (a.id - b.id) * dir;
    if (sortKey === "name") return a.name.localeCompare(b.name) * dir || a.id - b.id;
    const av = fieldValue(a.rec, sortKey), bv = fieldValue(b.rec, sortKey);
    if (av === null && bv === null) return a.id - b.id;
    if (av === null) return 1;   // unknown values always last, in both directions
    if (bv === null) return -1;
    return (av - bv) * dir || a.id - b.id;
  });

  const pendingStats = usesStats ? MAX_DEX_ID - dexMemory.size : 0;
  return { items, pendingStats, usesStats, skipped };
}

/**
 * Autocomplete: matches by Pokédex number, English name (prefix, word start, anywhere) and translated names.
 * Entirely local: typing never makes a network request. Returns up to `limit` {id, name, types, alt}.
 */
const altFolded = new WeakMap(); // translated-name arrays are folded once, not on every keystroke
const foldedAlt = (arr) => { let f = altFolded.get(arr); if (!f) altFolded.set(arr, (f = arr.map(fold))); return f; };

export function suggest(text, limit = 8) {
  if (!names) return [];
  const q = fold(text);
  if (q.length < 2) return [];
  const hits = [];

  if (/^\d+$/.test(q)) {
    const num = Number(q);
    for (let id = 1; id <= MAX_DEX_ID; id++) {
      const plain = String(id), padded = plain.padStart(3, "0");
      if (id === num) hits.push({ id, rank: 0 });
      else if (plain.startsWith(q) || padded.startsWith(q)) hits.push({ id, rank: 1 });
    }
  } else {
    for (let id = 1; id <= MAX_DEX_ID; id++) {
      const n = foldedNames[id - 1];
      let rank = -2, alt = null;
      if (n === q) rank = -1;           // exact name always first ("mew" before "mewtwo")
      else if (n.startsWith(q)) rank = 0;
      else if (n.includes(" " + q)) rank = 1;
      else if (n.includes(q)) rank = 2;
      else {
        const others = altMemory.get(id);
        const at = others ? foldedAlt(others).findIndex((o) => o.includes(q)) : -1;
        if (at >= 0) { rank = 3; alt = others[at]; }
      }
      if (rank > -2) hits.push({ id, rank, alt });
    }
  }

  hits.sort((a, b) => a.rank - b.rank || a.id - b.id);
  return hits.slice(0, limit).map(({ id, alt }) => ({
    id,
    name: names[id - 1],
    types: dexMemory.get(id)?.types || typeMap.get(id) || [],
    alt: alt || null
  }));
}

export const nameOf = (id) => (names ? names[id - 1] : undefined);
