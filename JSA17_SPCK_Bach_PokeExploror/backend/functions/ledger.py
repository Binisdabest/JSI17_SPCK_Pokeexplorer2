"""PokéPoints and card-inventory operations, written against the tiny store interface in store.py.

Rules every operation follows:
  * the caller's uid comes from the verified auth token (main.py), never from the request body;
  * amounts and card values are looked up here on the server, never taken from the client;
  * each change is ONE atomic transaction touching wallet + inventory + a transaction record;
  * the client sends a requestId; the transaction record is stored under that id, so repeating a request (a retry
    after a dropped connection) returns the first result and changes nothing.
Reads happen before writes in every transaction (Firestore requires it).
"""
import re

import economy_rules as rules

REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CARD_ID = re.compile(r"^[A-Za-z0-9._-]{1,40}$")


class EconomyError(Exception):
    """An expected refusal. `code` matches a Firebase callable error code (invalid-argument, not-found, ...)."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _check_request_id(request_id):
    if not isinstance(request_id, str) or not REQUEST_ID.match(request_id):
        raise EconomyError("invalid-argument", "requestId must be 8-64 letters, digits, - or _.")


def _same_request(done, ttype, expect):
    """A repeated requestId must be the SAME request. Reusing an id for something else is refused, not answered."""
    meta = done.get("meta", {})
    if done.get("type") != ttype or any(meta.get(k) != v for k, v in (expect or {}).items()):
        raise EconomyError("invalid-argument", "That requestId was already used for a different request.")


def _paths(uid, request_id=None, card_id=None):
    base = f"users/{uid}"
    return {
        "profile": base,
        "wallet": f"{base}/wallet/main",
        "txn": f"{base}/pointTransactions/{request_id}" if request_id else None,
        "inv": f"{base}/cardInventory/{card_id}" if card_id else None,
    }


def _post(tx, p, wallet_doc, new_points, ttype, amount, meta, request_id, result, profile_exists, extra_wallet=None):
    """Write the new balance, the transaction record (holding the result for idempotency) and the profile mirror."""
    if not (0 <= new_points <= rules.MAX_POINTS):
        raise EconomyError("failed-precondition", "That would take the balance out of range.")
    wallet = dict(wallet_doc or {"createdAt": tx.now, "version": 1})
    wallet.update(extra_wallet or {})
    wallet.update({"points": new_points, "updatedAt": tx.now})
    tx.set(p["wallet"], wallet)
    tx.set(p["txn"], {
        "type": ttype, "amount": amount, "balanceAfter": new_points, "createdAt": tx.now,
        "meta": meta, "requestId": request_id, "result": result,
    })
    if profile_exists:  # public display copy only; the wallet document is the real balance
        tx.update(p["profile"], {"points": new_points, "updatedAt": tx.now})


def init_wallet(store, uid, request_id, claimed_points=None):
    """Create the wallet once. With a legacy claim it starts at min(claim, cap); otherwise at STARTER_POINTS."""
    _check_request_id(request_id)
    if claimed_points is not None and (not _is_int(claimed_points) or not 0 <= claimed_points <= rules.MAX_POINTS):
        raise EconomyError("invalid-argument", "claimedPoints must be a whole number or null.")
    p = _paths(uid, request_id)

    def work(tx):
        done = tx.get(p["txn"])
        wallet = tx.get(p["wallet"])
        profile = tx.get(p["profile"])
        if done is not None:
            _same_request(done, "wallet-init", {"claimed": claimed_points} if claimed_points is not None else None)
            return {**done["result"], "repeated": True}
        if wallet is not None:  # never overwrite an existing wallet
            return {"ok": True, "created": False, "balance": wallet["points"], "repeated": False}
        if claimed_points is None:
            start, origin, extra, meta = rules.STARTER_POINTS, "starter", {}, {"origin": "starter"}
        else:
            start = min(claimed_points, rules.LEGACY_MIGRATION_CAP)
            origin = "legacy"
            migration = {"status": "done", "claimed": claimed_points, "credited": start,
                         "cap": rules.LEGACY_MIGRATION_CAP, "capped": claimed_points > start, "at": tx.now}
            extra, meta = {"legacyMigration": migration}, {"origin": "legacy", "claimed": claimed_points, "cap": rules.LEGACY_MIGRATION_CAP}
        result = {"ok": True, "created": True, "balance": start, "origin": origin, "repeated": False}
        if claimed_points is not None:
            result.update(claimed=claimed_points, credited=start, capped=claimed_points > start)
        _post(tx, p, {"createdAt": tx.now, "version": 1, "origin": origin}, start, "wallet-init", start, meta,
              request_id, result, profile is not None, extra)
        return result

    return store.run(work)


def exchange_duplicates(store, uid, request_id, card_id, quantity):
    """Sell extra copies of a card (the first copy is always kept) for points, priced from the catalog."""
    _check_request_id(request_id)
    if not isinstance(card_id, str) or not CARD_ID.match(card_id):
        raise EconomyError("invalid-argument", "Unknown card id.")
    if not _is_int(quantity) or not 1 <= quantity <= rules.MAX_EXCHANGE_QUANTITY:
        raise EconomyError("invalid-argument", f"quantity must be a whole number from 1 to {rules.MAX_EXCHANGE_QUANTITY}.")
    p = _paths(uid, request_id, card_id)

    def work(tx):
        done = tx.get(p["txn"])
        wallet = tx.get(p["wallet"])
        card = tx.get(f"cards/{card_id}")
        inv = tx.get(p["inv"])
        profile = tx.get(p["profile"])
        if done is not None:
            _same_request(done, "exchange-duplicates", {"cardId": card_id, "quantity": quantity})
            return {**done["result"], "repeated": True}
        if wallet is None:
            raise EconomyError("failed-precondition", "Set up your wallet first.")
        value = card.get("pointValue") if card else None
        if not _is_int(value) or not 1 <= value <= rules.MAX_CARD_VALUE:
            raise EconomyError("not-found", "That card is not in the catalog.")
        have = inv["count"] if inv else 0
        if quantity > have - 1:
            raise EconomyError("failed-precondition", "You can only exchange copies beyond the first." if have else "You don't own that card.")
        credit = max(1, int(value * rules.EXCHANGE_RATE)) * quantity
        remaining = have - quantity
        result = {"ok": True, "credited": credit, "balance": wallet["points"] + credit, "count": remaining, "repeated": False}
        # the inventory row is written BEFORE _post only for readability; all writes are one transaction
        tx.set(p["inv"], {**inv, "count": remaining, "updatedAt": tx.now})
        _post(tx, p, wallet, wallet["points"] + credit, "exchange-duplicates", credit,
              {"cardId": card_id, "quantity": quantity, "unitValue": value}, request_id, result, profile is not None)
        return result

    return store.run(work)
