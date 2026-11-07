import json
import os
import sys
import threading
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))

import economy_rules as rules  # noqa: E402
from catalog import card_finish, card_rarity, normalize_tcg_card  # noqa: E402
from ledger import EconomyError, exchange_duplicates, init_wallet  # noqa: E402
from store import MemoryStore  # noqa: E402

UID = "user-1"
RID = lambda n: f"req-{n:08d}"  # noqa: E731


def seeded():
    s = MemoryStore()
    s.docs["users/user-1"] = {"uid": UID, "points": 0}
    s.docs["cards/test-001"] = {"cardId": "test-001", "pointValue": 60, "rarity": "holo-rare"}
    s.docs["cards/test-002"] = {"cardId": "test-002", "pointValue": 1, "rarity": "common"}
    return s


def give(store, card_id, count):
    store.docs[f"users/{UID}/cardInventory/{card_id}"] = {"count": count, "acquiredAt": 1, "finishType": "normal"}


def _cases():
    with open(os.path.join(HERE, "rarity_cases.json")) as f:
        return json.load(f)


class Catalog(unittest.TestCase):
    def test_rarity_cases(self):
        for raw, want in _cases()["rarity"]:
            self.assertEqual(card_rarity(raw), want, raw)

    def test_finish_cases(self):
        for raw, keys, want in _cases()["finish"]:
            self.assertEqual(card_finish(raw, keys), want, (raw, keys))

    def test_normalize(self):
        card = normalize_tcg_card({"id": "test-9", "name": "Testmon", "number": "9", "rarity": "Rare Holo",
                                   "set": {"id": "test", "name": "Test Set"},
                                   "images": {"large": "https://example.com/l.png"}, "tcgplayer": {"prices": {"holofoil": {}}}})
        self.assertEqual((card["rarity"], card["pointValue"], card["finishType"], card["setCode"]), ("holo-rare", 60, "holo", "test"))
        self.assertEqual(card["imageUrl"], "https://example.com/l.png")
        self.assertEqual(normalize_tcg_card({"id": "x", "name": "N", "images": {"large": "javascript:alert(1)"}})["imageUrl"], "")
        self.assertIsNone(normalize_tcg_card({"name": "no id"}))
        self.assertIsNone(normalize_tcg_card(None))

    def test_values_cover_every_tier(self):
        from catalog import RARITY_KEYS
        self.assertEqual(sorted(rules.POINT_VALUES), sorted(RARITY_KEYS))
        vals = [rules.POINT_VALUES[k] for k in RARITY_KEYS]
        self.assertEqual(vals, sorted(vals))


class Wallet(unittest.TestCase):
    def test_starter(self):
        s = seeded()
        r = init_wallet(s, UID, RID(1))
        self.assertEqual((r["balance"], r["origin"], r["created"]), (1000, "starter", True))
        self.assertEqual(s.docs[f"users/{UID}/wallet/main"]["points"], 1000)
        self.assertEqual(s.docs[f"users/{UID}"]["points"], 1000)  # public mirror
        t = s.docs[f"users/{UID}/pointTransactions/{RID(1)}"]
        self.assertEqual((t["type"], t["amount"], t["balanceAfter"]), ("wallet-init", 1000, 1000))

    def test_legacy_migration_under_cap(self):
        s = seeded()
        r = init_wallet(s, UID, RID(1), 2300)
        self.assertEqual((r["balance"], r["credited"], r["capped"]), (2300, 2300, False))
        self.assertEqual(s.docs[f"users/{UID}/wallet/main"]["legacyMigration"]["claimed"], 2300)

    def test_legacy_migration_is_capped_and_recorded(self):
        s = seeded()
        r = init_wallet(s, UID, RID(1), 9_999_999)
        self.assertEqual((r["balance"], r["capped"]), (rules.LEGACY_MIGRATION_CAP, True))
        m = s.docs[f"users/{UID}/wallet/main"]["legacyMigration"]
        self.assertEqual((m["claimed"], m["credited"]), (9_999_999, rules.LEGACY_MIGRATION_CAP))

    def test_zero_claim_is_honoured_not_replaced_by_starter(self):
        self.assertEqual(init_wallet(seeded(), UID, RID(1), 0)["balance"], 0)

    def test_cannot_reinitialise_or_remigrate(self):
        s = seeded()
        init_wallet(s, UID, RID(1), 100)
        r = init_wallet(s, UID, RID(2), 5000)  # a second try with a bigger claim
        self.assertEqual((r["created"], r["balance"]), (False, 100))
        self.assertEqual(s.docs[f"users/{UID}/wallet/main"]["points"], 100)
        self.assertNotIn(f"users/{UID}/pointTransactions/{RID(2)}", s.docs)

    def test_retry_with_same_request_id_returns_first_result(self):
        s = seeded()
        a = init_wallet(s, UID, RID(1), 700)
        b = init_wallet(s, UID, RID(1), 700)
        self.assertEqual((b["balance"], b["repeated"]), (700, True))
        self.assertEqual(a["balance"], 700)
        with self.assertRaises(EconomyError):  # same id, different claim: refused, nothing changes
            init_wallet(s, UID, RID(1), 4000)
        self.assertEqual(s.docs[f"users/{UID}/wallet/main"]["points"], 700)

    def test_bad_input(self):
        s = seeded()
        for bad in (-1, 1.5, "100", True, 10**9):
            with self.assertRaises(EconomyError, msg=repr(bad)) as cm:
                init_wallet(s, UID, RID(1), bad)
            self.assertEqual(cm.exception.code, "invalid-argument")
        for rid in (None, "", "short", "has space!!", "x" * 65, 12345678):
            with self.assertRaises(EconomyError):
                init_wallet(s, UID, rid)
        self.assertEqual(s.docs.get(f"users/{UID}/wallet/main"), None)

    def test_missing_profile_does_not_break(self):
        s = MemoryStore()
        self.assertEqual(init_wallet(s, "other", RID(1))["balance"], 1000)
        self.assertNotIn("users/other", s.docs)


class Exchange(unittest.TestCase):
    def setUp(self):
        self.s = seeded()
        init_wallet(self.s, UID, RID(100))  # 1000 points
        give(self.s, "test-001", 4)

    def test_exchange_pays_from_the_catalog_and_keeps_one(self):
        r = exchange_duplicates(self.s, UID, RID(1), "test-001", 3)
        self.assertEqual((r["credited"], r["balance"], r["count"]), (90, 1090, 1))  # 60*0.5 = 30 each
        self.assertEqual(self.s.docs[f"users/{UID}/cardInventory/test-001"]["count"], 1)
        self.assertEqual(self.s.docs[f"users/{UID}/wallet/main"]["points"], 1090)
        self.assertEqual(self.s.docs[f"users/{UID}"]["points"], 1090)
        t = self.s.docs[f"users/{UID}/pointTransactions/{RID(1)}"]
        self.assertEqual((t["type"], t["amount"], t["balanceAfter"], t["meta"]["unitValue"]), ("exchange-duplicates", 90, 1090, 60))

    def test_cannot_sell_the_last_copy_or_more_than_owned(self):
        for q in (4, 5, 100):
            with self.assertRaises(EconomyError) as cm:
                exchange_duplicates(self.s, UID, RID(500 + q), "test-001", q)
            self.assertEqual(cm.exception.code, "failed-precondition")
        self.assertEqual(self.s.docs[f"users/{UID}/wallet/main"]["points"], 1000)
        self.assertEqual(self.s.docs[f"users/{UID}/cardInventory/test-001"]["count"], 4)

    def test_not_owned_and_unknown_card(self):
        with self.assertRaises(EconomyError) as cm:
            exchange_duplicates(self.s, UID, RID(1), "test-002", 1)
        self.assertEqual(cm.exception.code, "failed-precondition")
        with self.assertRaises(EconomyError) as cm:
            exchange_duplicates(self.s, UID, RID(2), "nope-000", 1)
        self.assertEqual(cm.exception.code, "not-found")

    def test_minimum_one_point_per_copy(self):
        give(self.s, "test-002", 3)
        self.assertEqual(exchange_duplicates(self.s, UID, RID(1), "test-002", 2)["credited"], 2)  # value 1 * 0.5 -> 1 each

    def test_needs_a_wallet(self):
        s = seeded()
        give(s, "test-001", 3)
        with self.assertRaises(EconomyError) as cm:
            exchange_duplicates(s, UID, RID(1), "test-001", 1)
        self.assertEqual(cm.exception.code, "failed-precondition")

    def test_repeat_request_id_pays_once(self):
        a = exchange_duplicates(self.s, UID, RID(1), "test-001", 1)
        b = exchange_duplicates(self.s, UID, RID(1), "test-001", 1)
        self.assertEqual((a["credited"], b["credited"], b["repeated"]), (30, 30, True))
        self.assertEqual(self.s.docs[f"users/{UID}/wallet/main"]["points"], 1030)
        self.assertEqual(self.s.docs[f"users/{UID}/cardInventory/test-001"]["count"], 3)

    def test_parallel_duplicate_requests_apply_once(self):
        results, errors = [], []

        def go():
            try:
                results.append(exchange_duplicates(self.s, UID, RID(7), "test-001", 3))
            except EconomyError as e:
                errors.append(e)

        threads = [threading.Thread(target=go) for _ in range(12)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(len(results), 12)
        self.assertEqual(self.s.docs[f"users/{UID}/wallet/main"]["points"], 1090)  # paid once
        self.assertEqual(self.s.docs[f"users/{UID}/cardInventory/test-001"]["count"], 1)

    def test_parallel_different_requests_cannot_oversell(self):
        outcomes = []

        def go(n):
            try:
                outcomes.append(exchange_duplicates(self.s, UID, RID(200 + n), "test-001", 2)["ok"])
            except EconomyError:
                outcomes.append(False)

        threads = [threading.Thread(target=go, args=(n,)) for n in range(10)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(outcomes.count(True), 1)  # 4 copies: only one batch of 2 fits if one copy is always kept... 
        # (4 - 2 = 2 left, a second batch of 2 would leave 0, which is refused)
        self.assertEqual(self.s.docs[f"users/{UID}/cardInventory/test-001"]["count"], 2)
        self.assertEqual(self.s.docs[f"users/{UID}/wallet/main"]["points"], 1060)

    def test_request_id_cannot_be_reused_for_another_operation(self):
        exchange_duplicates(self.s, UID, RID(1), "test-001", 1)
        with self.assertRaises(EconomyError):
            exchange_duplicates(self.s, UID, RID(1), "test-001", 2)   # different quantity
        with self.assertRaises(EconomyError):
            init_wallet(self.s, UID, RID(1))                           # different operation
        self.assertEqual(self.s.docs[f"users/{UID}/wallet/main"]["points"], 1030)

    def test_bad_arguments(self):
        for q in (0, -1, 1.5, "2", True, None, 10**6):
            with self.assertRaises(EconomyError, msg=repr(q)) as cm:
                exchange_duplicates(self.s, UID, RID(1), "test-001", q)
            self.assertEqual(cm.exception.code, "invalid-argument")
        for cid in (None, "", "a/b", "../x", "x" * 41, 5):
            with self.assertRaises(EconomyError, msg=repr(cid)):
                exchange_duplicates(self.s, UID, RID(1), cid, 1)

    def test_one_player_cannot_touch_another(self):
        init_wallet(self.s, "user-2", RID(300))
        with self.assertRaises(EconomyError):  # user-2 owns nothing
            exchange_duplicates(self.s, "user-2", RID(302), "test-001", 1)
        self.assertEqual(self.s.docs[f"users/{UID}/cardInventory/test-001"]["count"], 4)

    def test_failed_operation_writes_nothing(self):
        before = dict(self.s.docs)
        with self.assertRaises(EconomyError):
            exchange_duplicates(self.s, UID, RID(9), "test-001", 4)
        self.assertEqual(before, self.s.docs)


if __name__ == "__main__":
    unittest.main()
