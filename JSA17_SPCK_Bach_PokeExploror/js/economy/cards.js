/* ==========================================================
   economy/cards.js
   The card metadata model. GLOBAL data about a card (name, set, rarity, artwork, point value) lives here and in the
   Firestore `cards/{cardId}` collection; what a PLAYER owns lives separately in `users/{uid}/cardInventory/{cardId}`.
   Everything below the model is pure (no DOM, no network), so it can be unit-tested.

   Source of card data: the Pokémon TCG API (api.pokemontcg.io). Nothing is invented.
   ========================================================== */

import { POINT_VALUES } from "./config.js";

/** Rarity tiers, lowest to highest. `rank` is used for sorting (the rarest cards first in a showcase). */
export const RARITIES = [
  { key: "common", label: "Common", rank: 0 },
  { key: "uncommon", label: "Uncommon", rank: 1 },
  { key: "rare", label: "Rare", rank: 2 },
  { key: "holo-rare", label: "Holo Rare", rank: 3 },
  { key: "ultra-rare", label: "Ultra Rare", rank: 4 },
  { key: "secret-rare", label: "Secret Rare", rank: 5 },
  { key: "chase", label: "Special Chase", rank: 6 }
];
const RANK = Object.fromEntries(RARITIES.map((r) => [r.key, r.rank]));
export const rarityRank = (key) => RANK[key] ?? -1;
export const rarityLabel = (key) => RARITIES.find((r) => r.key === key)?.label ?? "Unknown";

export const FINISHES = ["normal", "holo", "reverse-holo", "full-art", "secret", "special"];

const words = (text) => new Set(String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []);
const hasAny = (set, list) => list.some((w) => set.has(w));

/**
 * Maps the TCG API's free-text rarity ("Rare Holo EX", "Special Illustration Rare"...) to one of the seven tiers.
 * Rules are checked from the rarest down, on whole words. Anything unrecognised falls to "common" (the lowest value),
 * so an odd label can never inflate what a card is worth. The Python backend has the same table
 * (backend/functions/catalog.py); the test suite checks both against the same list of examples.
 */
export function cardRarity(rawRarity) {
  const w = words(rawRarity);
  if (w.has("special") && w.has("illustration")) return "chase";
  if (w.has("hyper")) return "chase";
  if (hasAny(w, ["secret", "rainbow", "illustration", "shiny"])) return "secret-rare";
  if (hasAny(w, ["ultra", "vmax", "vstar", "gx", "ex", "v", "vunion", "break", "legend", "radiant", "amazing", "full", "ace"])) return "ultra-rare";
  if (hasAny(w, ["holo", "holofoil"])) return "holo-rare";
  if (w.has("rare")) return "rare";
  if (w.has("uncommon")) return "uncommon";
  return "common";
}

/** Finish type from the rarity label and the price keys the TCG API lists ("normal", "holofoil", "reverseHolofoil"...). */
export function cardFinish(rawRarity, priceKeys = []) {
  const w = words(rawRarity);
  if (hasAny(w, ["secret", "rainbow", "hyper"])) return "secret";
  if (hasAny(w, ["illustration", "shiny", "amazing", "radiant"])) return "special";
  if (hasAny(w, ["ultra", "vmax", "vstar", "gx", "ex", "v", "full"])) return "full-art";
  const keys = priceKeys.map((k) => String(k).toLowerCase());
  if (w.has("holo") || keys.some((k) => k === "holofoil" || k.endsWith("holofoil") && !k.startsWith("reverse"))) return "holo";
  if (keys.includes("reverseholofoil")) return "reverse-holo";
  return "normal";
}

export const pointValueFor = (rarityKey) => POINT_VALUES[rarityKey] ?? POINT_VALUES.common;

/**
 * Raw TCG API card -> our card model:
 * { cardId, name, setCode, setName, number, rarity, rawRarity, imageUrl, finishType, pointValue, source }
 * Returns null when the card is unusable (no id or name), so callers can skip it.
 */
export function normalizeTcgCard(raw) {
  if (!raw || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name) return null;
  const rawRarity = typeof raw.rarity === "string" ? raw.rarity : "";
  const rarity = cardRarity(rawRarity);
  const image = raw.images?.large || raw.images?.small || "";
  return {
    cardId: raw.id,
    name: raw.name,
    setCode: String(raw.set?.id || raw.id.split("-")[0] || ""),
    setName: String(raw.set?.name || "Unknown set"),
    number: String(raw.number ?? ""),
    rarity,
    rawRarity,
    imageUrl: typeof image === "string" && image.startsWith("https://") ? image : "",
    finishType: cardFinish(rawRarity, Object.keys(raw.tcgplayer?.prices || {})),
    pointValue: pointValueFor(rarity),
    source: "pokemontcg.io"
  };
}

/* ---------- collection statistics (pure: inventory + catalog in, numbers out) ---------- */

/**
 * inventory: [{cardId, count}]   catalog: Map or object cardId -> card model   setTotals: {setCode: totalCardsInSet}
 * Cards missing from the catalog still count as owned copies, but add no value and no set progress.
 */
export function collectionStats(inventory, catalog, setTotals = {}) {
  const get = (id) => (catalog instanceof Map ? catalog.get(id) : catalog?.[id]);
  let copies = 0, unique = 0, value = 0;
  const perSet = {};
  for (const row of inventory) {
    const count = Number(row.count) || 0;
    if (count <= 0) continue;
    copies += count; unique += 1;
    const card = get(row.cardId);
    if (!card) continue;
    value += card.pointValue * count;
    const s = (perSet[card.setCode] ||= { setCode: card.setCode, setName: card.setName, owned: 0 });
    s.owned += 1;
  }
  const sets = Object.values(perSet).map((s) => {
    const total = Number(setTotals[s.setCode]) || 0;
    return { ...s, total, percent: total ? Math.min(100, Math.round((s.owned / total) * 1000) / 10) : null };
  }).sort((a, b) => b.owned - a.owned);
  return { copies, unique, value, duplicates: copies - unique, sets };
}

/** The six rarest owned cards (rarity first, then point value), for the trainer-profile showcase. */
export function topRarest(inventory, catalog, n = 6) {
  const get = (id) => (catalog instanceof Map ? catalog.get(id) : catalog?.[id]);
  return inventory
    .filter((row) => (Number(row.count) || 0) > 0 && get(row.cardId))
    .map((row) => get(row.cardId))
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.pointValue - a.pointValue || a.cardId.localeCompare(b.cardId))
    .slice(0, n);
}

/** Points paid for `quantity` extra copies of a card. Mirrors the server (card value x rate, at least 1 each). */
export const exchangeValue = (pointValue, quantity, rate) => Math.max(1, Math.floor(pointValue * rate)) * quantity;
