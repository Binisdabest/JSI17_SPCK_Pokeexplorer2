// Publishes this browser's PokéPoints and Pokémon collection to the trainer profile (users/{uid}), so other
// trainers can see them. The game data itself still lives in localStorage (js/core/storage.js); this is a mirror.
import { getPoints, getCollection } from "../core/storage.js";
import { saveProfile } from "./data.js";
import { ECONOMY_MODE } from "../economy/config.js";

const ORDER = ["Mythical", "Legendary", "Ultra Rare", "Rare", "Uncommon", "Common"];
const RARE_AND_UP = 3; // index of "Rare" in ORDER
const rank = (label) => { const i = ORDER.indexOf(label); return i < 0 ? ORDER.length : i; };
const key = (label) => String(label).toLowerCase().replace(/\s+/g, "-");
const slim = (p) => ({ id: p.id, name: p.name, rarity: p.rarity });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What this device knows, shaped for the profile document. Showcase = favourites first, then the rarest. */
export function localSnapshot() {
  const coll = getCollection();
  const byRarity = [...coll].sort((a, b) => rank(a.rarity) - rank(b.rarity));
  const favs = coll.filter((p) => p.favorite);
  const showcase = [...favs, ...byRarity.filter((p) => !p.favorite)].slice(0, 12).map(slim);
  const rarityCounts = {};
  coll.forEach((p) => { const k = key(p.rarity); rarityCounts[k] = (rarityCounts[k] || 0) + 1; });
  return {
    hasPoints: localStorage.getItem("pokepoints") !== null,
    points: getPoints(),
    collectionCount: coll.length,
    uniqueCount: new Set(coll.map((p) => p.id)).size,
    rarityCounts,
    showcase,
    rareCards: byRarity.filter((p) => rank(p.rarity) <= RARE_AND_UP).slice(0, 6).map(slim)
  };
}

/**
 * Writes only what changed. If this browser has fewer Pokémon than the profile already shows (you logged in on a
 * second device), the collection fields are left alone so a fresh browser never wipes your showcase.
 */
export async function syncSelf(user, doc) {
  const snap = localSnapshot();
  const patch = {};
  // Trusted economy: the server writes users/{uid}.points; a browser value would be refused by the rules (and untrusted anyway).
  if (ECONOMY_MODE !== "trusted" && snap.hasPoints && snap.points !== doc.points && snap.points <= 10000000) patch.points = snap.points;
  if (snap.collectionCount > 0 && snap.collectionCount >= (doc.collectionCount || 0)) {
    ["collectionCount", "uniqueCount", "rarityCounts", "showcase", "rareCards"].forEach((k) => { if (!same(snap[k], doc[k])) patch[k] = snap[k]; });
  }
  if (!Object.keys(patch).length) return doc;
  try { return await saveProfile(user.uid, patch); }
  catch (e) { console.warn("Could not sync your profile:", e.code || e.message); return doc; }
}
