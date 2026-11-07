/* ==========================================================
   economy/backend-trusted.js
   TRUSTED economy: Firestore is the source of truth and only the Cloud Functions in /backend can change it. This file
   READS the player's own wallet / inventory / history (rules allow owner-read only) and ASKS the functions to change
   them. It never writes those documents itself, and never sends a balance.
   Same function names as backend-prototype.js.
   ========================================================== */

import { db, doc, collection, getDoc, getDocs, query, orderBy, limit } from "../community/fb.js";
import { FUNCTIONS_REGION, LEGACY_MIGRATION_CAP, STARTER_POINTS } from "./config.js";
import { getPoints, hasPointsKey } from "../core/storage.js";
import { app } from "../core/firebase-config.js";

export const mode = "trusted";

const FUNCTIONS_URL = "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
let callables = null;

async function call(name, data) {
  if (!callables) {
    const { getFunctions, httpsCallable } = await import(FUNCTIONS_URL); // loaded only in trusted mode
    const fns = getFunctions(app, FUNCTIONS_REGION);
    callables = (n) => httpsCallable(fns, n);
  }
  try {
    const { data: result } = await callables(name)(data);
    return result;
  } catch (err) {
    const code = String(err.code || "unknown").replace("functions/", "");
    return { ok: false, code, message: err.message || "The server refused the request." };
  }
}

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);

export async function getWallet(user) {
  const snap = await getDoc(doc(db, "users", user.uid, "wallet", "main"));
  const legacy = { hasLocal: hasPointsKey(), localBalance: getPoints(), cap: LEGACY_MIGRATION_CAP };
  if (!snap.exists()) return { mode, ready: false, balance: 0, starter: STARTER_POINTS, legacy, migration: null };
  const w = snap.data();
  return { mode, ready: true, balance: w.points, starter: STARTER_POINTS, legacy, migration: w.legacyMigration || null };
}

/** Creates the wallet once. `claimLegacy` asks the server to start it from this browser's old balance (capped there). */
export async function initWallet(user, { claimLegacy = false, requestId = crypto.randomUUID() } = {}) {
  const result = await call("initWallet", { requestId, claimedPoints: claimLegacy ? getPoints() : null });
  return result;
}

export async function getInventory(user) {
  const snap = await getDocs(collection(db, "users", user.uid, "cardInventory"));
  return snap.docs
    .map((d) => ({ cardId: d.id, count: d.data().count, acquiredAt: ms(d.data().acquiredAt), finishType: d.data().finishType }))
    .filter((row) => row.count > 0);
}

export async function getHistory(user, n = 20) {
  const snap = await getDocs(query(collection(db, "users", user.uid, "pointTransactions"), orderBy("createdAt", "desc"), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ms(d.data().createdAt) }));
}

/** The server looks the card's value up itself; whatever the browser thinks it is worth is ignored. */
export function exchangeDuplicates(user, { cardId, quantity, requestId = crypto.randomUUID() }) {
  return call("exchangeDuplicates", { requestId, cardId, quantity });
}
