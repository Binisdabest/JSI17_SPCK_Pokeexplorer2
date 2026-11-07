"""Card metadata model for the server. Same rules as js/economy/cards.js (checked by tests/rarity_cases.json)."""
import re

from economy_rules import POINT_VALUES

RARITY_KEYS = ["common", "uncommon", "rare", "holo-rare", "ultra-rare", "secret-rare", "chase"]
_ULTRA = {"ultra", "vmax", "vstar", "gx", "ex", "v", "vunion", "break", "legend", "radiant", "amazing", "full", "ace"}


def _words(text):
    return set(re.findall(r"[a-z0-9]+", str(text or "").lower()))


def card_rarity(raw_rarity):
    """TCG API free-text rarity -> one of the seven tiers. Unknown text falls to 'common' (the lowest value)."""
    w = _words(raw_rarity)
    if {"special", "illustration"} <= w or "hyper" in w:
        return "chase"
    if w & {"secret", "rainbow", "illustration", "shiny"}:
        return "secret-rare"
    if w & _ULTRA:
        return "ultra-rare"
    if w & {"holo", "holofoil"}:
        return "holo-rare"
    if "rare" in w:
        return "rare"
    if "uncommon" in w:
        return "uncommon"
    return "common"


def card_finish(raw_rarity, price_keys=()):
    w = _words(raw_rarity)
    if w & {"secret", "rainbow", "hyper"}:
        return "secret"
    if w & {"illustration", "shiny", "amazing", "radiant"}:
        return "special"
    if w & {"ultra", "vmax", "vstar", "gx", "ex", "v", "full"}:
        return "full-art"
    keys = [str(k).lower() for k in price_keys]
    if "holo" in w or any(k == "holofoil" or (k.endswith("holofoil") and not k.startswith("reverse")) for k in keys):
        return "holo"
    if "reverseholofoil" in keys:
        return "reverse-holo"
    return "normal"


def normalize_tcg_card(raw):
    """Raw Pokémon TCG API card -> our card document, or None if unusable."""
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not raw["id"]:
        return None
    if not isinstance(raw.get("name"), str) or not raw["name"]:
        return None
    raw_rarity = raw["rarity"] if isinstance(raw.get("rarity"), str) else ""
    rarity = card_rarity(raw_rarity)
    images = raw.get("images") or {}
    image = images.get("large") or images.get("small") or ""
    card_set = raw.get("set") or {}
    return {
        "cardId": raw["id"],
        "name": raw["name"],
        "setCode": str(card_set.get("id") or raw["id"].split("-")[0]),
        "setName": str(card_set.get("name") or "Unknown set"),
        "number": str(raw.get("number", "")),
        "rarity": rarity,
        "rawRarity": raw_rarity,
        "imageUrl": image if isinstance(image, str) and image.startswith("https://") else "",
        "finishType": card_finish(raw_rarity, list(((raw.get("tcgplayer") or {}).get("prices") or {}).keys())),
        "pointValue": POINT_VALUES[rarity],
        "source": "pokemontcg.io",
    }
