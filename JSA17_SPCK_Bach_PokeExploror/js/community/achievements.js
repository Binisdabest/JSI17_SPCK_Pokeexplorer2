// Achievements. The project had no achievement system, so badges are DERIVED from data that already exists:
// game scores (Firestore `scores`), the collection + PokéPoints (mirrored into users/{uid}), and community activity.
// Nothing extra is stored: change a rule here and every profile updates.
import { games } from "../games/registry.js";
import * as store from "../core/store.js";
import { counts } from "./data.js";

export const PLAYABLE = games.filter((g) => g.ready);

// mon = Pokédex number whose artwork is the badge picture, c = badge colour.
export const BADGES = [
  { id: "first-steps", name: "First Steps", desc: "Play your first mini game.", mon: 25, c: "#ffcb05", test: (s) => s.gamesTried >= 1 },
  { id: "game-hopper", name: "Game Hopper", desc: "Set a score in 3 different games.", mon: 133, c: "#a77dff", test: (s) => s.gamesTried >= 3 },
  { id: "game-master", name: "Game Master", desc: "Set a score in every game.", mon: 150, c: "#8b6cf0", test: (s) => s.gamesTotal > 0 && s.gamesTried >= s.gamesTotal },
  { id: "high-scorer", name: "High Scorer", desc: "Reach a total score of 1,000.", mon: 6, c: "#ff8a3d", test: (s) => s.totalScore >= 1000 },
  { id: "podium", name: "On the Podium", desc: "Finish in the top 3 of any leaderboard.", mon: 130, c: "#4a8dff", test: (s) => s.bestRank <= 3 },
  { id: "first-catch", name: "First Catch", desc: "Add a Pokémon to your collection.", mon: 1, c: "#4cc764", test: (s) => s.collectionCount >= 1 },
  { id: "collector", name: "Collector", desc: "Own 10 Pokémon.", mon: 143, c: "#6fb1fc", test: (s) => s.collectionCount >= 10 },
  { id: "dex-hunter", name: "Dex Hunter", desc: "Collect 8 different species.", mon: 137, c: "#ff6fa3", test: (s) => s.uniqueCount >= 8 },
  { id: "rare-find", name: "Rare Find", desc: "Pull a Rare or better Pokémon.", mon: 131, c: "#3b6fe0", test: (s) => s.hasRare },
  { id: "legend-hunter", name: "Legend Hunter", desc: "Pull a Legendary Pokémon.", mon: 144, c: "#e6b800", test: (s) => s.hasLegendary },
  { id: "mythical-luck", name: "Mythical Luck", desc: "Pull a Mythical Pokémon.", mon: 151, c: "#e5566d", test: (s) => s.hasMythical },
  { id: "pokepoint-pro", name: "PokéPoint Pro", desc: "Hold 5,000 PokéPoints.", mon: 52, c: "#f2c230", test: (s) => s.points >= 5000 },
  { id: "first-post", name: "Plaza Voice", desc: "Share your first post.", mon: 54, c: "#ffa168", test: (s) => s.posts >= 1 },
  { id: "friendly-face", name: "Friendly Face", desc: "Follow 5 trainers.", mon: 39, c: "#ff8fd0", test: (s) => s.following >= 5 },
  { id: "rising-star", name: "Rising Star", desc: "Get 5 followers.", mon: 175, c: "#ffd23f", test: (s) => s.followers >= 5 }
];

export const badgeById = (id) => BADGES.find((b) => b.id === id);

/** For the signed-in player, folds in scores that only exist in this browser so a fresh result counts straight away. */
export function withLocalScores(rows, user) {
  if (!user) return rows;
  const out = rows.map((r) => ({ ...r }));
  const local = store.getAllLocal();
  PLAYABLE.forEach((g) => {
    const best = local[g.id]?.best ?? 0;
    const mine = out.find((r) => r.uid === user.uid && r.gameId === g.id);
    if (mine) mine.best = Math.max(mine.best, best);
    else if (best > 0) out.push({ uid: user.uid, name: user.displayName || "You", gameId: g.id, best });
  });
  return out;
}

/** Numbers every badge rule reads. `doc` is users/{uid}; `c` is { posts, followers, following }. */
export function buildStats(uid, rows, doc, c) {
  const mine = rows.filter((r) => r.uid === uid && r.best > 0);
  const rc = doc?.rarityCounts || {};
  let bestRank = Infinity;
  PLAYABLE.forEach((g) => {
    const at = store.boardFor(rows, g.id).findIndex((p) => p.uid === uid);
    if (at >= 0 && mine.some((r) => r.gameId === g.id)) bestRank = Math.min(bestRank, at + 1);
  });
  return {
    gamesTried: new Set(mine.map((r) => r.gameId)).size,
    gamesTotal: PLAYABLE.length,
    totalScore: mine.reduce((n, r) => n + r.best, 0),
    bestRank,
    collectionCount: doc?.collectionCount || 0,
    uniqueCount: doc?.uniqueCount || 0,
    hasRare: ((rc.rare || 0) + (rc["ultra-rare"] || 0) + (rc.legendary || 0) + (rc.mythical || 0)) > 0,
    hasLegendary: (rc.legendary || 0) > 0,
    hasMythical: (rc.mythical || 0) > 0,
    points: doc?.points || 0,
    posts: c?.posts || 0, followers: c?.followers || 0, following: c?.following || 0
  };
}

export const earnedIds = (stats) => BADGES.filter((b) => b.test(stats)).map((b) => b.id);

/** Loads everything the badge rules need for one trainer. Scores are one read of the `scores` collection (cached 30 s). */
export async function loadStats(uid, doc, signedInUser) {
  let rows = [];
  try { rows = await store.fetchAllScores(); } catch (e) { console.warn("Scores unavailable:", e.code || e.message); }
  if (signedInUser && signedInUser.uid === uid) rows = withLocalScores(rows, signedInUser);
  const c = await counts(uid);
  return { rows, counts: c, stats: buildStats(uid, rows, doc, c) };
}
