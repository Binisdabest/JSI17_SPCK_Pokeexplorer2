"""Fill the global `cards/{cardId}` catalog from the Pokémon TCG API (run by YOU, once per set, with admin credentials).

    pip install firebase-admin requests
    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json   # keep this file private, never commit it
    python backend/tools/seed_cards.py sv3 [sv4 ...]

Point values come from economy_rules.py by rarity tier, so the server (not the browser) decides what a card is worth.
Not run against the live APIs in this repo's tests; the normalisation it uses is unit-tested.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "functions"))

import firebase_admin  # noqa: E402
import requests  # noqa: E402
from firebase_admin import firestore  # noqa: E402

from catalog import normalize_tcg_card  # noqa: E402

API = "https://api.pokemontcg.io/v2/cards"


def main(set_ids):
    firebase_admin.initialize_app()
    db = firestore.client()
    for set_id in set_ids:
        page, written = 1, 0
        while True:
            r = requests.get(API, params={"q": f"set.id:{set_id}", "page": page, "pageSize": 100}, timeout=30)
            r.raise_for_status()
            body = r.json()
            batch = db.batch()
            for raw in body.get("data", []):
                card = normalize_tcg_card(raw)
                if card:
                    batch.set(db.collection("cards").document(card["cardId"]), card)
                    written += 1
            batch.commit()
            if page * 100 >= body.get("totalCount", 0):
                break
            page += 1
        print(f"{set_id}: {written} cards written")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
