"""The numbers the SERVER trusts. The browser has a display-only copy in js/economy/config.js; if the two ever
differ, this file wins. Change values here, redeploy, and update the browser copy so the UI text stays right."""

STARTER_POINTS = 1000
LEGACY_MIGRATION_CAP = 5000      # most browser-stored PokéPoints a one-time migration accepts (unverifiable claim)
EXCHANGE_RATE = 0.5              # share of a card's point value paid per extra copy
MAX_POINTS = 10_000_000          # same ceiling the Firestore rules put on a profile balance
MAX_EXCHANGE_QUANTITY = 1000     # copies per request
MAX_CARD_VALUE = 100_000         # sanity bound on a catalog pointValue

# Proposed in-game values by rarity tier (not real-world prices). Mirrors POINT_VALUES in js/economy/config.js.
POINT_VALUES = {
    "common": 5,
    "uncommon": 10,
    "rare": 25,
    "holo-rare": 60,
    "ultra-rare": 150,
    "secret-rare": 400,
    "chase": 1000,
}
