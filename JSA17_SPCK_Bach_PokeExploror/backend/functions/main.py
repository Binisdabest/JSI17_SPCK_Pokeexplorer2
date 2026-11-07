"""Cloud Functions for Firebase (Python, 2nd gen) for the PokéExplorer economy.

Deploy: see "Trusted economy" in the project README. NOT deployed or run against live Firebase from this repo's tests.
The caller's identity is req.auth.uid (set by Firebase from the ID token); nothing in req.data can change it.
"""
import firebase_admin
from firebase_admin import firestore
from firebase_functions import https_fn, options

import ledger
from store import FirestoreStore

options.set_global_options(max_instances=5, region="us-central1")  # keep in step with FUNCTIONS_REGION in js/economy/config.js

_app = firebase_admin.initialize_app()
_store = None


def _get_store():
    global _store
    if _store is None:
        _store = FirestoreStore(firestore.client())
    return _store


def _uid(req):
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "Log in first.")
    return req.auth.uid


def _run(fn):
    try:
        return fn()
    except ledger.EconomyError as err:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode(err.code), err.message)


@https_fn.on_call()
def initWallet(req: https_fn.CallableRequest):
    data = req.data or {}
    uid = _uid(req)
    return _run(lambda: ledger.init_wallet(_get_store(), uid, data.get("requestId"), data.get("claimedPoints")))


@https_fn.on_call()
def exchangeDuplicates(req: https_fn.CallableRequest):
    data = req.data or {}
    uid = _uid(req)
    return _run(lambda: ledger.exchange_duplicates(_get_store(), uid, data.get("requestId"), data.get("cardId"), data.get("quantity")))
