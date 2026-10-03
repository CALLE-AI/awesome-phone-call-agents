"""Phase 2 procurement loop: reorder offer, vendor capture, vendor call,
owner status callback, and new-shop onboarding. No network, no live calls.

Refs #34 (P2), #35 (P3), #29 (P4), #36 (P5), #30 (P6), #31 (P7).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

import ingest  # noqa: E402
import store  # noqa: E402

SHOP = "demo-lagos-corner-shop"
NOW = "2026-08-12T07:20:00+01:00"


@pytest.fixture
def conn(tmp_path):
    c = store.connect(tmp_path / "procurement.db")
    store.initialize(c)
    with c:
        store.upsert_shop(
            c,
            {
                "shop_id": SHOP,
                "display_name": "Ada Corner Shop",
                "phone": "+2348000000000",
                "region": "NG",
                "locale": "en",
                "currency": "NGN",
                "consent_timestamp": NOW,
            },
        )
    yield c
    c.close()


def _fixture(name: str) -> dict:
    return json.loads((APP_ROOT / "fixtures" / "procurement" / name).read_text(encoding="utf-8"))


# ------------------------------------------------------------------ P2 / P3


def test_reorder_offer_yes_creates_restock_request_and_vendor(conn):
    result = ingest.ingest_call(conn, _fixture("reorder-offer-yes.json"))
    assert result.accepted
    assert result.rows_written == 2  # restock request + one new vendor

    request = store.get_restock_request(conn, request_id="restock-call-reorder-20260812")
    assert request is not None
    assert request["owner_consented"] == 1
    items = json.loads(request["items_json"])
    assert items[0]["name"] == "Fish"

    vendor = store.find_vendor_by_name(conn, shop_id=SHOP, name="Mama Sikiru")
    assert vendor is not None
    assert vendor["phone_e164"] == "+2348111111111"
    assert json.loads(vendor["goods_json"]) == ["fish"]


def test_reorder_offer_no_writes_restock_request_but_no_vendor(conn):
    call = _fixture("reorder-offer-yes.json")
    call["call_id"] = "call-reorder-no-20260813"
    call["idempotency_key"] = "shopvoice-demo-lagos-corner-shop-reorder_offer-2026-08-13"
    call["metadata"]["call_date"] = "2026-08-13"
    call["structured_result"] = {
        "reorder_offer_completed": True,
        "owner_wants_to_order": False,
        "items": [],
    }
    result = ingest.ingest_call(conn, call)
    assert result.accepted
    assert result.rows_written == 1  # a declined restock request row, no vendor

    request = store.get_restock_request(conn, request_id="restock-call-reorder-no-20260813")
    assert request["status"] == "declined"
    assert store.find_vendor_by_name(conn, shop_id=SHOP, name="Mama Sikiru") is None


def test_reingesting_reorder_offer_does_not_duplicate_the_request(conn):
    call = _fixture("reorder-offer-yes.json")
    ingest.ingest_call(conn, call)
    ingest.ingest_call(conn, call)
    count = conn.execute(
        "SELECT COUNT(*) c FROM restock_requests WHERE request_id = ?",
        ("restock-call-reorder-20260812",),
    ).fetchone()["c"]
    assert count == 1


def test_reusing_a_known_vendor_by_name_does_not_re_collect_goods(conn):
    with conn:
        store.upsert_vendor(
            conn, shop_id=SHOP, display_name="Mama Sikiru",
            goods=["fish", "prawns"], phone_e164="+2348111111111", now=NOW,
        )
    call = _fixture("reorder-offer-yes.json")
    # Owner just names the saved vendor; no need to re-describe what she sells.
    del call["structured_result"]["items"][0]["vendor_goods"]
    ingest.ingest_call(conn, call)
    vendor = store.find_vendor_by_name(conn, shop_id=SHOP, name="Mama Sikiru")
    assert json.loads(vendor["goods_json"]) == ["fish", "prawns"]


# ------------------------------------------------------------------ P4 / P5


def _seed_order(conn) -> str:
    ingest.ingest_call(conn, _fixture("reorder-offer-yes.json"))
    vendor = store.find_vendor_by_name(conn, shop_id=SHOP, name="Mama Sikiru")
    with conn:
        order_id = store.create_order(
            conn, request_id="restock-call-reorder-20260812",
            shop_id=SHOP, vendor_id=vendor["vendor_id"], now=NOW,
        )
    return order_id


def test_create_order_is_idempotent_per_request_and_vendor(conn):
    first = _seed_order(conn)
    with conn:
        second = store.create_order(
            conn, request_id="restock-call-reorder-20260812",
            shop_id=SHOP,
            vendor_id=store.find_vendor_by_name(conn, shop_id=SHOP, name="Mama Sikiru")["vendor_id"],
            now=NOW,
        )
    assert first == second
    count = conn.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]
    assert count == 1


def test_vendor_order_call_updates_amount_and_eta(conn):
    order_id = _seed_order(conn)
    call = _fixture("vendor-order-result.json")
    assert call["metadata"]["order_id"] == order_id
    result = ingest.ingest_call(conn, call)
    assert result.accepted

    order = store.get_order(conn, order_id=order_id)
    assert order["status"] == "placed"
    assert order["amount"] == 45000
    assert order["eta_text"] == "around 4pm today"
    assert order["vendor_call_id"] == "call-vendor-order-20260812"


def test_vendor_order_call_with_unknown_order_id_is_rejected(conn):
    call = _fixture("vendor-order-result.json")
    call["metadata"]["order_id"] = "order-does-not-exist"
    result = ingest.ingest_call(conn, call)
    assert not result.accepted
    assert "unknown order_id" in result.reason


def test_order_status_callback_updates_order_and_is_distinct_call(conn):
    order_id = _seed_order(conn)
    ingest.ingest_call(conn, _fixture("vendor-order-result.json"))
    call = _fixture("order-status-result.json")
    assert call["structured_result"]["order_id"] == order_id
    result = ingest.ingest_call(conn, call)
    assert result.accepted

    order = store.get_order(conn, order_id=order_id)
    assert order["callback_call_id"] == "call-order-status-20260812"
    assert order["callback_call_id"] != order["vendor_call_id"]
    assert order["status"] == "placed"


def test_order_status_with_unknown_order_id_is_rejected(conn):
    call = _fixture("order-status-result.json")
    call["structured_result"]["order_id"] = "order-does-not-exist"
    result = ingest.ingest_call(conn, call)
    assert not result.accepted
    assert "unknown order_id" in result.reason


# ------------------------------------------------------------------ P6


def test_onboarding_new_shop_creates_shop_and_products(conn):
    result = ingest.ingest_call(conn, _fixture("onboarding-new-shop.json"))
    assert result.accepted

    shop = store.find_shop_by_phone(conn, "+919000000000")
    assert shop is not None
    assert shop["id"] == "demo-pune-corner-shop"
    assert shop["region"] == "IN"
    assert shop["consent_source"] == "voice_onboarding_call"
    assert shop["timezone"] == "Asia/Kolkata"

    product = conn.execute(
        "SELECT * FROM products WHERE shop_id = ? AND name_normalized = 'rice'",
        ("demo-pune-corner-shop",),
    ).fetchone()
    assert product["last_cost"] == 60

    vendor = store.find_vendor_by_name(conn, shop_id="demo-pune-corner-shop", name="Sharma Ji")
    assert vendor is not None


def test_onboarding_returning_shop_does_not_duplicate(conn):
    before = conn.execute("SELECT COUNT(*) c FROM shops").fetchone()["c"]
    result = ingest.ingest_call(conn, _fixture("onboarding-returning-shop.json"))
    assert result.accepted
    after = conn.execute("SELECT COUNT(*) c FROM shops").fetchone()["c"]
    assert after == before  # same shop_id as the fixture in `conn`, no new row

    shop = store.find_shop_by_phone(conn, "+2348000000000")
    assert shop["id"] == SHOP


def test_find_shop_by_phone_returns_none_for_unknown_number(conn):
    assert store.find_shop_by_phone(conn, "+2348099999999") is None


# ------------------------------------------------------------------ P7 chain


def test_full_procurement_chain_reflects_in_the_final_order(conn):
    """Reorder yes -> vendor capture -> vendor order -> owner callback."""
    r1 = ingest.ingest_call(conn, _fixture("reorder-offer-yes.json"))
    assert r1.accepted

    vendor = store.find_vendor_by_name(conn, shop_id=SHOP, name="Mama Sikiru")
    with conn:
        order_id = store.create_order(
            conn, request_id="restock-call-reorder-20260812",
            shop_id=SHOP, vendor_id=vendor["vendor_id"], now=NOW,
        )

    r2 = ingest.ingest_call(conn, _fixture("vendor-order-result.json"))
    assert r2.accepted
    r3 = ingest.ingest_call(conn, _fixture("order-status-result.json"))
    assert r3.accepted

    order = store.get_order(conn, order_id=order_id)
    assert order["status"] == "placed"
    assert order["amount"] == 45000
    assert order["vendor_call_id"] == "call-vendor-order-20260812"
    assert order["callback_call_id"] == "call-order-status-20260812"

    receipts = {
        row["call_id"]: row["call_type"]
        for row in conn.execute("SELECT call_id, call_type FROM call_receipts")
    }
    assert receipts == {
        "call-reorder-20260812": "reorder_offer",
        "call-vendor-order-20260812": "vendor_order",
        "call-order-status-20260812": "order_status",
    }
