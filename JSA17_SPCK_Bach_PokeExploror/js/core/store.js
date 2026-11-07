// Scores. Guests: saved in this browser. Logged in: the best score is also written to Firestore.
// Games call store.saveScore(gameId, score) when a run ends and never touch Firebase themselves.
import { auth, db } from "./firebase-config.js";
import { displayName } from "./auth.js";
import { doc, setDoc, serverTimestamp, collection, query, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const KEY = "pe_scores";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export const getBest = (gameId) => read()[gameId]?.best ?? 0;
export const getPlays = (gameId) => read()[gameId]?.plays ?? 0;

/** Records one finished run. Returns { best, isBest, synced }. */
export async function saveScore(gameId, score) {
  const all = read();
  const entry = all[gameId] || { best: 0, plays: 0 };
  const isBest = score > entry.best;
  entry.plays += 1;
  if (isBest) entry.best = score;
  all[gameId] = entry;
  localStorage.setItem(KEY, JSON.stringify(all));
  window.dispatchEvent(new Event("scores-changed"));

  let synced = false;
  const user = auth.currentUser;
  if (user && isBest) {
    try {
      await setDoc(doc(db, "scores", `${user.uid}_${gameId}`), {
        uid: user.uid, name: displayName(user), gameId, best: entry.best, updatedAt: serverTimestamp()
      });
      synced = true;
    } catch (e) {
      console.warn("Could not sync score:", e.code || e.message); // offline or rules not published yet
    }
  }
  return { best: entry.best, isBest, synced };
}

/* ---------- leaderboard + profile helpers ---------- */

export const getAllLocal = () => read();
export function clearLocal() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("scores-changed"));
}

let cache = null, cacheAt = 0;
/** Every score document (max 1000), cached for 30 seconds. Throws if Firestore is unavailable. */
export async function fetchAllScores(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  const snap = await getDocs(query(collection(db, "scores"), limit(1000)));
  cache = snap.docs.map((d) => d.data());
  cacheAt = Date.now();
  return cache;
}

/** Ranked list [{ uid, name, score, games }] for one game, or gameId "all" = sum of every game's best. */
export function boardFor(rows, gameId) {
  if (gameId !== "all") {
    return rows.filter((r) => r.gameId === gameId)
      .map((r) => ({ uid: r.uid, name: r.name, score: r.best, games: 1 }))
      .sort((a, b) => b.score - a.score);
  }
  const byUser = new Map();
  rows.forEach((r) => {
    const e = byUser.get(r.uid) || { uid: r.uid, name: r.name, score: 0, games: 0 };
    e.score += r.best; e.games += 1; e.name = r.name;
    byUser.set(r.uid, e);
  });
  return [...byUser.values()].sort((a, b) => b.score - a.score);
}

/**
 * Pushes this browser's bests (and the current display name) to Firestore.
 * Lets scores played as a guest count once the player logs in. Returns how many documents were written.
 */
export async function syncLocal(user) {
  const online = await fetchAllScores(true);
  const mine = Object.fromEntries(online.filter((r) => r.uid === user.uid).map((r) => [r.gameId, r]));
  let written = 0;
  for (const [gameId, entry] of Object.entries(read())) {
    const best = Math.max(entry.best, mine[gameId]?.best ?? 0);
    const name = displayName(user);
    if (best <= 0 || (mine[gameId] && mine[gameId].best === best && mine[gameId].name === name)) continue;
    await setDoc(doc(db, "scores", `${user.uid}_${gameId}`), { uid: user.uid, name, gameId, best, updatedAt: serverTimestamp() });
    written++;
  }
  cache = null;
  return written;
}
