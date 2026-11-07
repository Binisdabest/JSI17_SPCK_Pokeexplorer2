"""Storage adapters. The economy logic (ledger.py) only talks to the tiny interface below, so it can be tested
against MemoryStore here and run on FirestoreStore in production.

    store.run(fn)       run fn(tx) atomically (retried on contention); returns fn's result
    tx.get(path)        dict or None.  ALL reads must happen before the first write (a Firestore rule).
    tx.set(path, data)  create/replace      tx.update(path, data)  merge fields into an existing document
    tx.now              a timestamp value to store (server time on Firestore)
"""
import copy
import threading
import time


class MemoryStore:
    """In-memory stand-in for Firestore used by the tests. One lock makes each run() atomic, like a transaction."""

    def __init__(self):
        self.docs = {}
        self._lock = threading.Lock()

    def run(self, fn):
        with self._lock:
            tx = _MemoryTx(self.docs)
            result = fn(tx)          # if fn raises, nothing below runs and nothing was written
            self.docs.update(tx.pending)
            return result


class _MemoryTx:
    def __init__(self, docs):
        self._docs, self.pending, self._wrote = docs, {}, False

    @property
    def now(self):
        return int(time.time() * 1000)

    def get(self, path):
        if self._wrote:
            raise RuntimeError("reads must come before writes in a transaction")
        doc = self._docs.get(path)
        return copy.deepcopy(doc) if doc is not None else None

    def set(self, path, data):
        self._wrote = True
        self.pending[path] = copy.deepcopy(data)

    def update(self, path, data):
        self._wrote = True
        base = self.pending.get(path, self._docs.get(path))
        if base is None:
            raise KeyError("update of a missing document: " + path)
        merged = copy.deepcopy(base)
        merged.update(copy.deepcopy(data))
        self.pending[path] = merged


class FirestoreStore:
    """Real adapter (firebase_admin). NOT exercised against a live Firestore in this repo's tests."""

    def __init__(self, client):
        from firebase_admin import firestore
        self._firestore = firestore
        self._client = client

    def run(self, fn):
        firestore = self._firestore

        @firestore.transactional
        def txn(transaction):
            return fn(_FirestoreTx(self._client, transaction, firestore.SERVER_TIMESTAMP))

        return txn(self._client.transaction())


class _FirestoreTx:
    def __init__(self, client, transaction, server_ts):
        self._client, self._t, self.now = client, transaction, server_ts

    def _ref(self, path):
        return self._client.document(path)

    def get(self, path):
        snap = self._ref(path).get(transaction=self._t)
        return snap.to_dict() if snap.exists else None

    def set(self, path, data):
        self._t.set(self._ref(path), data)

    def update(self, path, data):
        self._t.update(self._ref(path), data)
