"""Tests for the Phase 2 procurement auto-chain in web/server.py.

Server-side decision logic only: no HTTP, no thread execution, no CALL-E.
This is what the 2026-09-10 decision changed — one human trigger on the
console, and inventory -> reorder offer -> vendor order -> order status
fires itself from there, capped at CHAIN_CAP total calls per chain (see
CLAUDE.md and the auto-chain comment above CHAIN_CAP in server.py).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))
sys.path.insert(0, str(APP_ROOT / "web"))

import store  # noqa: E402

import server  # noqa: E402

SHOP = {
    "id": "demo-lagos-corner-shop", "phone_e164": "+2348000000000",
    "region": "NG", "locale": "en", "currency": "NGN",
    "language_style": "pidgin-english",
}
NOW = "2026-08-12T07:00:00+01:00"


@pytest.fixture
def conn(tmp_path):
    c = store.connect(tmp_path / "chain.db")
    store.initialize(c)
    with c:
        store.upsert_shop(c, {
            "shop_id": SHOP["id"], "display_name": "Ada Corner Shop",
            "phone": SHOP["phone_e164"], "region": SHOP["region"],
            "locale": SHOP["locale"], "currency": SHOP["currency"],
            "consent_timestamp": NOW,
        })
    yield c
    c.close()


# --------------------------------------------------------------- inventory

def test_low_stock_inventory_chains_to_a_reorder_offer(conn):
    request = {"call_type": "inventory", "shop_id": SHOP["id"]}
    result = {"structured_result": {"products": [
        {"name": "Fish", "running_low": True},
        {"name": "Rice", "running_low": False},
    ]}}
    out = server._next_chain_requests(request, result, SHOP, conn)
    assert len(out) == 1
    assert out[0]["call_type"] == "reorder_offer"
    assert out[0]["low_stock_items"] == ["Fish"]
    assert out[0]["phone"] == SHOP["phone_e164"]
    assert "recipient_consented" not in out[0]


def test_inventory_with_nothing_low_does_not_chain(conn):
    request = {"call_type": "inventory", "shop_id": SHOP["id"]}
    result = {"structured_result": {"products": [{"name": "Rice", "running_low": False}]}}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


# ------------------------------------------------------------ reorder offer

def test_reorder_offer_no_does_not_chain(conn):
    request = {"call_type": "reorder_offer", "shop_id": SHOP["id"]}
    result = {"call_id": "call-1",
             "structured_result": {"owner_wants_to_order": False, "items": []}}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


def test_reorder_offer_yes_chains_to_the_named_vendor(conn):
    with conn:
        store.upsert_vendor(conn, shop_id=SHOP["id"], display_name="Mama Sikiru",
                            goods=["fish"], phone_e164="+2348111111111", now=NOW)
    request = {"call_type": "reorder_offer", "shop_id": SHOP["id"]}
    result = {"call_id": "call-reorder-1", "structured_result": {
        "owner_wants_to_order": True,
        "items": [{"name": "Fish", "quantity_needed": 2, "unit": "cooler boxes",
                   "vendor_name": "Mama Sikiru"}],
    }}
    out = server._next_chain_requests(request, result, SHOP, conn)
    assert len(out) == 1
    leg = out[0]
    assert leg["call_type"] == "vendor_order"
    assert leg["phone"] == "+2348111111111"
    assert leg["vendor_display_name"] == "Mama Sikiru"
    assert leg["order_items"] == ["2 cooler boxes Fish"]
    assert "recipient_consented" not in leg
    assert "vendor_contact_authorized" not in leg

    order = store.get_order(conn, order_id=leg["request_id"])
    assert order is not None
    assert order["request_id"] == "restock-call-reorder-1"
    vendor = store.find_vendor_by_name(conn, shop_id=SHOP["id"], name="Mama Sikiru")
    assert order["vendor_id"] == vendor["vendor_id"]

    # Re-deriving from the same reorder call reuses the same order row —
    # this is what makes the auto-chain safe to re-evaluate, not just to run
    # once: store.create_order is idempotent per (request_id, vendor_id).
    again = server._next_chain_requests(request, result, SHOP, conn)
    assert again[0]["request_id"] == leg["request_id"]


def test_reorder_offer_names_a_vendor_with_no_saved_phone_is_skipped(conn):
    """Never invent a vendor phone number — if the vendor isn't on file with
    one, the chain must not dial anybody."""
    request = {"call_type": "reorder_offer", "shop_id": SHOP["id"]}
    result = {"call_id": "call-reorder-2", "structured_result": {
        "owner_wants_to_order": True,
        "items": [{"name": "Fish", "quantity_needed": 2, "unit": "cooler boxes",
                   "vendor_name": "Unknown Vendor"}],
    }}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


def test_reorder_offer_with_two_vendors_chains_to_both(conn):
    with conn:
        store.upsert_vendor(conn, shop_id=SHOP["id"], display_name="Mama Sikiru",
                            goods=["fish"], phone_e164="+2348111111111", now=NOW)
        store.upsert_vendor(conn, shop_id=SHOP["id"], display_name="Rice Man",
                            goods=["rice"], phone_e164="+2348000000000", now=NOW)
    request = {"call_type": "reorder_offer", "shop_id": SHOP["id"]}
    result = {"call_id": "call-reorder-3", "structured_result": {
        "owner_wants_to_order": True,
        "items": [
            {"name": "Fish", "quantity_needed": 2, "unit": "cooler boxes", "vendor_name": "Mama Sikiru"},
            {"name": "Rice", "quantity_needed": 3, "unit": "bags", "vendor_name": "Rice Man"},
        ],
    }}
    out = server._next_chain_requests(request, result, SHOP, conn)
    assert {leg["vendor_display_name"] for leg in out} == {"Mama Sikiru", "Rice Man"}
    assert len({leg["request_id"] for leg in out}) == 2  # distinct orders


# --------------------------------------------------------------- vendor order

def _seed_placed_order(conn) -> str:
    """An order as it looks right after the vendor-call ingest updated it —
    what _next_chain_requests actually reads from, not `structured` again."""
    with conn:
        store.upsert_vendor(conn, shop_id=SHOP["id"], display_name="Mama Sikiru",
                            phone_e164="+2348111111111", now=NOW)
        vendor = store.find_vendor_by_name(conn, shop_id=SHOP["id"], name="Mama Sikiru")
        order_id = store.create_order(conn, request_id="restock-1", shop_id=SHOP["id"],
                                      vendor_id=vendor["vendor_id"], now=NOW)
        store.record_vendor_call(conn, order_id=order_id, vendor_call_id="call-vendor-1",
                                 available=True, amount=45000, eta_text="around 4pm today")
    return order_id


def test_vendor_order_chains_to_the_owner_status_callback(conn):
    order_id = _seed_placed_order(conn)
    request = {"call_type": "vendor_order", "shop_id": SHOP["id"]}
    result = {"metadata": {"order_id": order_id}, "structured_result": {}}
    out = server._next_chain_requests(request, result, SHOP, conn)
    assert len(out) == 1
    leg = out[0]
    assert leg["call_type"] == "order_status"
    assert leg["request_id"] == order_id
    assert leg["phone"] == SHOP["phone_e164"]
    # The owner callback must carry the real outcome — CALL-E rejects a task
    # that asks it to invent one (this is exactly what broke live: the task
    # said "state whether it was placed... if known" with no known value).
    assert leg["order_status_known"] == "placed"
    assert leg["order_amount"] == 45000
    assert leg["order_eta_text"] == "around 4pm today"


def test_vendor_order_without_an_order_id_does_not_chain(conn):
    """metadata.order_id missing means the live path never attached one —
    the chain must stop rather than guess which order this was."""
    request = {"call_type": "vendor_order", "shop_id": SHOP["id"]}
    result = {"metadata": {}, "structured_result": {}}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


def test_vendor_order_with_an_order_id_not_on_file_does_not_chain(conn):
    """The order_id came back from CALL-E but doesn't match anything we
    opened — report nothing rather than guess an outcome."""
    request = {"call_type": "vendor_order", "shop_id": SHOP["id"]}
    result = {"metadata": {"order_id": "order-does-not-exist"}, "structured_result": {}}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


# ------------------------------------------------------------------ terminal

def test_order_status_is_terminal(conn):
    request = {"call_type": "order_status", "shop_id": SHOP["id"]}
    result = {"structured_result": {"status_reported": "placed"}}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


def test_sales_never_chains(conn):
    request = {"call_type": "sales", "shop_id": SHOP["id"]}
    result = {"structured_result": {"estimated_revenue": 1000}}
    assert server._next_chain_requests(request, result, SHOP, conn) == []


# ------------------------------------------------------------------------ cap

def test_launch_refuses_once_the_chain_cap_is_reached(monkeypatch):
    """CHAIN_CAP is the only brake left on a runaway chain once a single
    trigger can fire the rest of itself with no further confirmation."""
    monkeypatch.setattr(server, "DEMO", True)
    monkeypatch.setattr(server, "_demo_run", lambda *a, **k: None)
    request = {"shop_id": SHOP["id"], "phone": SHOP["phone_e164"],
              "call_type": "order_status", "request_id": "order-x"}

    root = None
    for _ in range(server.CHAIN_CAP):
        key = server._launch(request, "2026-09-10", None, chain_id=root)
        assert key is not None
        root = root or key

    refused = server._launch(request, "2026-09-10", None, chain_id=root)
    assert refused is None
    assert server.CHAIN_COUNTS[root] == server.CHAIN_CAP


# --------------------------------------------------------- shop phone safety

def test_persisting_a_vendor_order_call_does_not_overwrite_the_shops_phone(
    conn, tmp_path, monkeypatch
):
    """Regression for 2026-09-11: a vendor_order result's request["phone"] is
    the vendor's number. _persist used to upsert_shop with it unconditionally,
    which overwrote shops.phone_e164 — so every callback placed after a
    vendor call dialed the vendor instead of the owner."""
    db_path = tmp_path / "persist.db"
    monkeypatch.setattr(server, "DB_PATH", db_path)
    monkeypatch.setattr(server, "RESULTS_DIR", tmp_path / "call-results")
    real_conn = store.connect(db_path)
    store.initialize(real_conn)
    with real_conn:
        store.upsert_shop(real_conn, {
            "shop_id": SHOP["id"], "display_name": "Ada Corner Shop",
            "phone": SHOP["phone_e164"], "region": "NG", "locale": "en",
            "currency": "NGN", "consent_timestamp": NOW,
        })
    real_conn.close()

    request = {
        "shop_id": SHOP["id"], "call_type": "vendor_order",
        "phone": "+2348111111111",  # the vendor's number, not the shop's
        "region": "NG", "locale": "en", "currency": "NGN",
    }
    result = {
        "call_id": "call-vendor-1", "status": "completed", "task_completed": True,
        "completion_confidence": {"score": 0.9},
        "structured_result": {"vendor_order_completed": True, "available": True, "items": []},
        "metadata": {"shop_id": SHOP["id"], "call_type": "vendor_order",
                     "call_date": "2026-09-11", "order_id": "order-x"},
    }
    server._persist("unused-key", result, request)

    check_conn = store.connect(db_path)
    shop = check_conn.execute("SELECT phone_e164 FROM shops WHERE id = ?",
                              (SHOP["id"],)).fetchone()
    check_conn.close()
    assert shop["phone_e164"] == SHOP["phone_e164"], (
        "the shop's own phone was overwritten with the vendor's number")


def test_live_chain_is_advisory_only(monkeypatch, tmp_path):
    """Live mode must not auto-dial vendor/callback legs without approval."""
    monkeypatch.setattr(server, "DEMO", False)
    db_path = tmp_path / "advisory.db"
    monkeypatch.setattr(server, "DB_PATH", db_path)
    real = store.connect(db_path)
    store.initialize(real)
    with real:
        store.upsert_shop(real, {
            "shop_id": SHOP["id"], "display_name": "Ada",
            "phone": SHOP["phone_e164"], "region": "NG", "locale": "en",
            "currency": "NGN", "consent_timestamp": NOW,
        })
    real.close()

    launched = []
    monkeypatch.setattr(
        server, "_launch",
        lambda *a, **k: launched.append(a) or "launched")

    request = {"call_type": "inventory", "shop_id": SHOP["id"]}
    result = {
        "call_id": "call-inv-1",
        "structured_result": {"products": [{"name": "Fish", "running_low": True}]},
    }
    with server.RUNS_LOCK:
        server.RUNS["parent"] = {"key": "parent", "chain_id": "parent"}

    server._maybe_continue_chain(
        "parent", request, result, "2026-09-10", "key", accepted=True)

    assert launched == []
    with server.RUNS_LOCK:
        pending = server.RUNS["parent"].get("pending_next") or []
        assert len(pending) == 1
        assert pending[0]["call_type"] == "reorder_offer"
        assert pending[0]["requires_authorization"] is True
        assert "phone" not in pending[0]
        assert pending[0]["phone_masked"]


def test_approve_next_requires_vendor_authorization(monkeypatch):
    monkeypatch.setattr(server, "DEMO", False)
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    launched = []
    monkeypatch.setattr(
        server, "_launch",
        lambda req, *a, **k: launched.append(req) or "new-key")

    leg = {
        "call_type": "vendor_order", "phone": "+2348111111111",
        "shop_id": SHOP["id"], "region": "NG", "locale": "en",
        "currency": "NGN", "request_id": "order-1",
    }
    with server.RUNS_LOCK:
        server.RUNS["parent"] = {
            "key": "parent", "chain_id": "parent",
            "pending_requests": [leg],
            "pending_next": [server._pending_leg_public(leg)],
        }

    with pytest.raises(server.ApiError, match="boolean true"):
        server.approve_next({
            "parent_key": "parent", "leg_index": 0,
            "consent": True, "vendor_contact_authorized": "yes",
        })

    with pytest.raises(server.ApiError, match="boolean true"):
        server.approve_next({"parent_key": "parent", "leg_index": 0, "consent": True})

    out = server.approve_next({
        "parent_key": "parent", "leg_index": 0,
        "consent": True, "vendor_contact_authorized": True,
    })
    assert out["key"] == "new-key"
    assert launched[0]["recipient_consented"] is True
    assert launched[0]["vendor_contact_authorized"] is True


def test_truthy_consent_string_is_rejected():
    with pytest.raises(server.ApiError, match="boolean true"):
        server._require_true({"consent": "true"}, "consent")
    with pytest.raises(server.ApiError, match="boolean true"):
        server._require_true({"consent": 1}, "consent")
    server._require_true({"consent": True}, "consent")


def test_public_shop_masks_phone():
    shop = {**SHOP, "display_name": "Ada"}
    public = server._public_shop(shop)
    assert "phone_e164" not in public
    assert public["phone_masked"].startswith("+")
    assert "*" in public["phone_masked"]
    assert "0000" in public["phone_masked"] or public["phone_masked"].endswith("0000")
