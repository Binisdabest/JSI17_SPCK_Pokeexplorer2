/* ==========================================================
   economy/config.js
   The ONE switch between the two economy modes, plus the numbers the browser shows to the player.

   "prototype"  everything runs in this browser (localStorage). Fine for a demo, NOT cheat-resistant: anyone can edit
                their own balance in dev tools. The UI says so.
   "trusted"    balance, inventory and history live in Firestore and can only be changed by the Cloud Functions in
                /backend (see README, "Trusted economy"). Set this only after those functions are deployed and the
                Firestore rules have `economyTrusted()` returning true.

   The numbers below are only for display and for prototype mode. In trusted mode the server uses its own copy
   (backend/functions/economy_rules.py) and ignores whatever the browser thinks.
   ========================================================== */

export const ECONOMY_MODE = "prototype"; // "prototype" | "trusted"
export const FUNCTIONS_REGION = "us-central1"; // region the functions are deployed to (trusted mode only)

export const STARTER_POINTS = 1000;
/** Most legacy (browser-stored) PokéPoints that migration will accept. The browser's number cannot be verified. */
export const LEGACY_MIGRATION_CAP = 5000;
/** Duplicate exchange pays this share of a card's point value, per extra copy (always at least 1 point). */
export const EXCHANGE_RATE = 0.5;

/** Proposed in-game values by rarity. These are game numbers, not real-world card prices. */
export const POINT_VALUES = {
  common: 5,
  uncommon: 10,
  rare: 25,
  "holo-rare": 60,
  "ultra-rare": 150,
  "secret-rare": 400,
  chase: 1000
};
