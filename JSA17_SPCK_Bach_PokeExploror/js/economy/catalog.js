/* ==========================================================
   economy/catalog.js
   Global card metadata for the browser, read-through: memory -> IndexedDB (core/cache.js) -> Firestore `cards/{id}`
   (the catalog the backend seeds) -> the Pokémon TCG API. It never stores anything per player.
   ========================================================== */

import { cacheGet, cacheSet, DAY } from "../core/cache.js";
import { normalizeTcgCard } from "./cards.js";

const TCG_BASE = "https://api.pokemontcg.io/v2";
const TTL = 14 * DAY;
const memory = new Map();

async function fromFirestore(id) {
  try {
    const { db, doc, getDoc } = await import("../community/fb.js");
    const snap = await getDoc(doc(db, "cards", id));
    return snap.exists() ? snap.data() : null;
  } catch { return null; } // rules not published yet, offline...: fall through to the TCG API
}

async function fromTcgApi(id) {
  try {
    const response = await fetch(`${TCG_BASE}/cards/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return normalizeTcgCard((await response.json()).data);
  } catch { return null; }
}

/** One card's metadata, or null if no source knows it. */
export async function getCardMeta(id) {
  if (memory.has(id)) return memory.get(id);
  const key = "card:" + id;
  let card = await cacheGet(key, TTL);
  if (!card) {
    card = (await fromFirestore(id)) || (await fromTcgApi(id));
    if (card) await cacheSet(key, card);
  }
  if (card) memory.set(id, card);
  return card || null;
}

/** Map cardId -> metadata for a list of ids (unknown ids are left out). */
export async function getCardsMeta(ids) {
  const found = await Promise.all([...new Set(ids)].map(async (id) => [id, await getCardMeta(id)]));
  return new Map(found.filter(([, card]) => card));
}
