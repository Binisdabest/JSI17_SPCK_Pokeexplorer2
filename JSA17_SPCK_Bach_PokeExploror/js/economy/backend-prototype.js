/* ==========================================================
   economy/backend-prototype.js
   PROTOTYPE economy: balance, inventory and history live in this browser (js/core/storage.js).
   Honest limits: a player can edit their own localStorage, so nothing here is cheat-resistant, and nothing is shared
   between devices. It exists so the rest of the site (and Phase 3's pack opening) can be built and demonstrated
   before the trusted backend is deployed. Same function names as backend-trusted.js.
   ========================================================== */

import {
  getPoints, addPoints, getLedger, logTransaction, getCardInventory, setCardInventory, hasPointsKey
} from "../core/storage.js";
import { STARTER_POINTS, EXCHANGE_RATE, LEGACY_MIGRATION_CAP } from "./config.js";
import { exchangeValue } from "./cards.js";

export const mode = "prototype";

export async function getWallet() {
  return {
    mode, ready: true, balance: getPoints(), starter: STARTER_POINTS,
    legacy: { hasLocal: hasPointsKey(), localBalance: getPoints(), cap: LEGACY_MIGRATION_CAP },
    migration: null // nothing to migrate: the browser balance IS the balance
  };
}

export async function initWallet() { return getWallet(); }

export async function getInventory() {
  return Object.entries(getCardInventory())
    .map(([cardId, v]) => ({ cardId, count: v.count, acquiredAt: v.acquiredAt, finishType: v.finishType }))
    .filter((row) => row.count > 0);
}

export async function getHistory(_user, n = 20) {
  return getLedger().slice(0, n);
}

/**
 * Exchange extra copies of a card for points. One copy is always kept. `pointValue` comes from the catalog; the
 * browser is the only authority in prototype mode. A repeated requestId does nothing the second time.
 */
export async function exchangeDuplicates(_user, { cardId, quantity, requestId, pointValue }) {
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, code: "bad-quantity", message: "Pick at least 1 copy." };
  if (!Number.isFinite(pointValue) || pointValue < 1) return { ok: false, code: "unknown-card", message: "That card's value is unknown." };
  if (requestId && getLedger().some((t) => t.requestId === requestId)) {
    const done = getLedger().find((t) => t.requestId === requestId);
    return { ok: true, repeated: true, credited: done.amount, balance: getPoints(), count: getCardInventory()[cardId]?.count ?? 0 };
  }
  const inventory = getCardInventory();
  const have = inventory[cardId]?.count ?? 0;
  if (quantity > have - 1) return { ok: false, code: "not-enough-duplicates", message: have ? "You can only exchange copies beyond the first." : "You don't own that card." };
  const credited = exchangeValue(pointValue, quantity, EXCHANGE_RATE);
  inventory[cardId] = { ...inventory[cardId], count: have - quantity };
  setCardInventory(inventory);
  const balance = addPoints(credited, "exchange-duplicates", { requestId, meta: { cardId, quantity } });
  return { ok: true, credited, balance, count: have - quantity };
}

/** Development / test helper only (prototype mode): put cards into the inventory. Phase 3 pack opening replaces this. */
export function devGrantCards(cardId, quantity = 1, finishType = "normal") {
  const inventory = getCardInventory();
  const now = Date.now();
  inventory[cardId] = { count: (inventory[cardId]?.count ?? 0) + quantity, acquiredAt: inventory[cardId]?.acquiredAt ?? now, finishType };
  setCardInventory(inventory);
  logTransaction("dev-grant", 0, getPoints(), { cardId, quantity });
}
