/* ==========================================================
   economy/wallet.js
   The one entry point the rest of the site uses for PokéPoints, card inventory and history. It picks the backend from
   config.js, so pages never care whether the economy is "prototype" or "trusted".

   Every result is {ok: true, ...} or {ok: false, code, message}; nothing throws for an expected refusal.
   Changes carry a requestId: sending the same id again (a retry after a dropped connection) never applies twice.
   ========================================================== */

import { ECONOMY_MODE, EXCHANGE_RATE } from "./config.js";
import * as prototype from "./backend-prototype.js";
import { getCardMeta } from "./catalog.js";

let trusted = null;
async function backend() {
  if (ECONOMY_MODE !== "trusted") return prototype;
  return (trusted ||= await import("./backend-trusted.js")); // Firestore/Functions code only loads in trusted mode
}

export const economyMode = () => (ECONOMY_MODE === "trusted" ? "trusted" : "prototype");
export const isTrusted = () => economyMode() === "trusted";

export const newRequestId = () => crypto.randomUUID();

export async function getWallet(user) { return (await backend()).getWallet(user); }
export async function initWallet(user, options) { return (await backend()).initWallet(user, options); }
export async function getInventory(user) { return (await backend()).getInventory(user); }
export async function getHistory(user, n) { return (await backend()).getHistory(user, n); }

/** Trade extra copies (one is always kept) for points. */
export async function exchangeDuplicates(user, { cardId, quantity, requestId = newRequestId() }) {
  const b = await backend();
  if (b.mode === "trusted") return b.exchangeDuplicates(user, { cardId, quantity, requestId });
  const card = await getCardMeta(cardId); // prototype only: the browser has to supply the value itself
  return b.exchangeDuplicates(user, { cardId, quantity, requestId, pointValue: card?.pointValue });
}

export { EXCHANGE_RATE };
