/* ==========================================================
   storage.js
   The only file allowed to touch localStorage directly.
   Everything else calls these functions.
   ========================================================== */

// Old browsers may still hold the keys "comparestats", "communityposts", "trainers" and "activeTrainerId" from earlier
// versions. Nothing reads them any more and nothing deletes them; they are harmless leftovers.
const KEYS = {
  points: "pokepoints",
  collection: "pokecollection",
  ledger: "pe_ledger",           // prototype economy: recent PokéPoints transactions
  cards: "pe_card_inventory",    // prototype economy: {cardId: {count, acquiredAt, finishType}}
  economy: "pe_economy"          // prototype economy: small flags (starter wallet notice, etc.)
};
const LEDGER_MAX = 100;

const STARTER_POINTS = 1000;

function read(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------------------------------------------------- */
/* PokéPoints                                                   */
/* ---------------------------------------------------------- */
export function getPoints() {
  return read(KEYS.points, STARTER_POINTS);
}

export function addPoints(amount, reason = "legacy-reward", { requestId = null, meta = {} } = {}) {
  const next = getPoints() + amount;
  write(KEYS.points, next);
  logTransaction(reason, amount, next, meta, requestId);
  return next;
}

/** Returns false (and spends nothing) if the balance is too low. */
export function spendPoints(amount, reason = "legacy-spend") {
  const current = getPoints();
  if (current < amount) return false;
  write(KEYS.points, current - amount);
  logTransaction(reason, -amount, current - amount);
  return true;
}

/* ---------------------------------------------------------- */
/* Prototype economy: ledger, card inventory, flags             */
/* Used only while the economy runs in "prototype" mode        */
/* (js/economy/config.js). In "trusted" mode Firestore is the   */
/* source of truth and none of this is read for real balances.  */
/* ---------------------------------------------------------- */

/** Appends one entry to the local ledger (newest first, capped). `requestId` makes a retry a no-op. */
export function logTransaction(type, amount, balanceAfter, meta = {}, requestId = null) {
  const ledger = read(KEYS.ledger, []);
  if (requestId && ledger.some((t) => t.requestId === requestId)) return null;
  const entry = {
    id: requestId || crypto.randomUUID(),
    requestId,
    type, amount, balanceAfter,
    createdAt: Date.now(),
    meta
  };
  ledger.unshift(entry);
  write(KEYS.ledger, ledger.slice(0, LEDGER_MAX));
  return entry;
}
export const getLedger = () => read(KEYS.ledger, []);
export const hasPointsKey = () => localStorage.getItem(KEYS.points) !== null;

/** {cardId: {count, acquiredAt, finishType}} */
export const getCardInventory = () => read(KEYS.cards, {});
export const setCardInventory = (inventory) => write(KEYS.cards, inventory);

export const getEconomyFlags = () => read(KEYS.economy, {});
export function setEconomyFlag(name, value) {
  write(KEYS.economy, { ...getEconomyFlags(), [name]: value });
}

/* ---------------------------------------------------------- */
/* Collection                                                    */
/* ---------------------------------------------------------- */
export function getCollection() {
  return read(KEYS.collection, []);
}

export function addToCollection({ id, name, types, artwork, rarity }) {
  const collection = getCollection();
  const entry = {
    uid: crypto.randomUUID(),
    id,
    name,
    types,
    artwork,
    rarity,
    favorite: false,
    obtainedAt: new Date().toISOString()
  };
  collection.unshift(entry);
  write(KEYS.collection, collection);
  return entry;
}

export function removeFromCollection(uid) {
  write(KEYS.collection, getCollection().filter((p) => p.uid !== uid));
}

export function toggleFavorite(uid) {
  const collection = getCollection();
  const entry = collection.find((p) => p.uid === uid);
  if (entry) entry.favorite = !entry.favorite;
  write(KEYS.collection, collection);
  return entry?.favorite;
}

/* ---------------------------------------------------------- */
/* Avatars. Who you ARE comes from Firebase Auth (core/auth.js). */
/* ---------------------------------------------------------- */
/** Avatar to display for a trainer: their uploaded photo, or a generated placeholder. */
export function getAvatarSrc(trainer) {
  if (trainer?.avatar) return trainer.avatar;
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(trainer?.username || "?")}`;
}
