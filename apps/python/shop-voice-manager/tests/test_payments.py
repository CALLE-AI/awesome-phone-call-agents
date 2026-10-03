"""Phase 3 payment ledger + fake adapter tests. No network, no bank APIs.

Refs #37, #38, #40.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

import store  # noqa: E402
from payments import (  # noqa: E402
    PaymentAdapterError,
    SubmitFlags,
    preview_payment,
    submit_payment,
)

SHOP = "demo-lagos-corner-shop"
NOW = "2026-09-07T12:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = store.connect(tmp_path / "pay.db")
    store.initialize(c)
    with c:
        store.upsert_shop(
            c,
            {
                "shop_id": SHOP,
                "display_name": "Corner Shop",
                "phone": "+2348000000000",
                "region": "NG",
                "locale": "en",
                "currency": "NGN",
                "consent_timestamp": NOW,
            },
        )
        vid = store.upsert_vendor(
            c,
            shop_id=SHOP,
            display_name="Mama Sikiru",
            goods=["fish"],
            phone_e164="+2348000000099",
            now=NOW,
        )
        c.execute(
            "INSERT INTO orders"
            " (order_id, request_id, shop_id, vendor_id, status, eta_text,"
            "  amount, vendor_call_id, callback_call_id, created_at)"
            " VALUES (?, ?, ?, ?, 'placed', 'around 4pm', 45000, NULL, NULL, ?)",
            ("ord-fish-1", "req-1", SHOP, vid, NOW),
        )
    yield c
    c.close()


def _vendor_id(conn) -> str:
    return conn.execute(
        "SELECT vendor_id FROM vendors WHERE shop_id = ?", (SHOP,)
    ).fetchone()["vendor_id"]


def test_fresh_ledger_is_schema_v3(tmp_path):
    c = store.connect(tmp_path / "v3.db")
    store.initialize(c)
    assert store.schema_version(c) == 3
    store.check_compatible(c)
    tables = {
        r["name"]
        for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert {"payment_intents", "payment_events"} <= tables
    c.close()


def test_v2_ledger_upgrades_to_v3(tmp_path):
    path = tmp_path / "v2.db"
    c = store.connect(path)
    store.initialize(c)
    with c:
        c.execute("UPDATE schema_meta SET value = '2' WHERE key = 'version'")
        c.execute("DROP TABLE IF EXISTS payment_intents")
        c.execute("DROP TABLE IF EXISTS payment_events")
        # Simulate v2 vendors without payee columns.
        c.execute("DROP TABLE IF EXISTS vendors")
        c.execute(
            "CREATE TABLE vendors ("
            " vendor_id TEXT PRIMARY KEY, shop_id TEXT NOT NULL,"
            " display_name TEXT NOT NULL, name_normalized TEXT NOT NULL,"
            " phone_e164 TEXT, goods_json TEXT NOT NULL DEFAULT '[]',"
            " notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,"
            " UNIQUE (shop_id, name_normalized))"
        )
    store.initialize(c)
    assert store.schema_version(c) == 3
    cols = {row[1] for row in c.execute("PRAGMA table_info(vendors)")}
    assert {"payee_ref", "payee_provider"} <= cols
    store.check_compatible(c)
    c.close()


def test_intent_lifecycle_preview_then_pay(conn):
    vid = _vendor_id(conn)
    with conn:
        store.link_vendor_payee(
            conn,
            vendor_id=vid,
            payee_ref="RCP_DEMO_SIKIRU_8899",
            payee_provider="fake",
            now=NOW,
        )
        intent_id = store.create_payment_intent(
            conn,
            order_id="ord-fish-1",
            shop_id=SHOP,
            vendor_id=vid,
            amount=45000,
            currency="NGN",
            idempotency_key=f"shopvoice-{SHOP}-vendor_pay-ord-fish-1",
            now=NOW,
        )
        store.approve_payment_intent(conn, intent_id=intent_id, now=NOW)

    preview = preview_payment(conn, intent_id=intent_id, now=NOW)
    assert preview["mode"] == "preview"
    assert preview["would_submit"] is True
    assert preview["payee_ref_masked"].endswith("8899")
    assert "*" in preview["payee_ref_masked"]

    dry = submit_payment(
        conn, intent_id=intent_id, flags=SubmitFlags(), now=NOW,
    )
    assert dry["mode"] == "preview"
    assert store.get_payment_intent(conn, intent_id=intent_id)["status"] == (
        "owner_approved"
    )

    with conn:
        paid = submit_payment(
            conn,
            intent_id=intent_id,
            flags=SubmitFlags(execute=True, confirm_owner_payment=True),
            now=NOW,
        )
    assert paid["status"] == "paid"
    assert paid["provider_transfer_id"].startswith("fake-xfer-")
    row = store.get_payment_intent(conn, intent_id=intent_id)
    assert row["status"] == "paid"
    events = [e["event_type"] for e in store.list_payment_events(conn, intent_id=intent_id)]
    assert "created" in events
    assert "approved" in events
    assert "paid" in events


def test_submit_refuses_without_owner_approval(conn):
    vid = _vendor_id(conn)
    with conn:
        store.link_vendor_payee(
            conn, vendor_id=vid, payee_ref="RCP_X", payee_provider="fake", now=NOW,
        )
        intent_id = store.create_payment_intent(
            conn,
            order_id="ord-fish-1",
            shop_id=SHOP,
            vendor_id=vid,
            amount=1000,
            currency="NGN",
            idempotency_key="key-no-approve",
            now=NOW,
        )
    with pytest.raises(PaymentAdapterError, match="approve"):
        submit_payment(
            conn,
            intent_id=intent_id,
            flags=SubmitFlags(execute=True, confirm_owner_payment=True),
            now=NOW,
        )


def test_submit_refuses_without_payee_link(conn):
    vid = _vendor_id(conn)
    with conn:
        intent_id = store.create_payment_intent(
            conn,
            order_id="ord-fish-1",
            shop_id=SHOP,
            vendor_id=vid,
            amount=1000,
            currency="NGN",
            idempotency_key="key-no-payee",
            now=NOW,
        )
        store.approve_payment_intent(conn, intent_id=intent_id, now=NOW)
    with pytest.raises(PaymentAdapterError, match="payee_ref"):
        submit_payment(
            conn,
            intent_id=intent_id,
            flags=SubmitFlags(execute=True, confirm_owner_payment=True),
            now=NOW,
        )


def test_idempotent_create_and_submit(conn):
    vid = _vendor_id(conn)
    key = "shopvoice-demo-vendor_pay-once"
    with conn:
        store.link_vendor_payee(
            conn, vendor_id=vid, payee_ref="RCP_Y", payee_provider="fake", now=NOW,
        )
        a = store.create_payment_intent(
            conn,
            order_id="ord-fish-1",
            shop_id=SHOP,
            vendor_id=vid,
            amount=2000,
            currency="NGN",
            idempotency_key=key,
            now=NOW,
        )
        b = store.create_payment_intent(
            conn,
            order_id="ord-fish-1",
            shop_id=SHOP,
            vendor_id=vid,
            amount=2000,
            currency="NGN",
            idempotency_key=key,
            now=NOW,
        )
        assert a == b
        store.approve_payment_intent(conn, intent_id=a, now=NOW)
        first = submit_payment(
            conn,
            intent_id=a,
            flags=SubmitFlags(execute=True, confirm_owner_payment=True),
            now=NOW,
        )
        second = submit_payment(
            conn,
            intent_id=a,
            flags=SubmitFlags(execute=True, confirm_owner_payment=True),
            now=NOW,
        )
    assert first["status"] == "paid"
    assert second["mode"] == "idempotent"
    assert second["provider_transfer_id"] == first["provider_transfer_id"]
    assert conn.execute(
        "SELECT COUNT(*) c FROM payment_intents WHERE idempotency_key = ?", (key,)
    ).fetchone()["c"] == 1


def test_amount_cap_refuses_oversize(conn):
    vid = _vendor_id(conn)
    with conn:
        store.link_vendor_payee(
            conn, vendor_id=vid, payee_ref="RCP_Z", payee_provider="fake", now=NOW,
        )
        intent_id = store.create_payment_intent(
            conn,
            order_id="ord-fish-1",
            shop_id=SHOP,
            vendor_id=vid,
            amount=900_000,
            currency="NGN",
            idempotency_key="key-cap",
            now=NOW,
        )
        store.approve_payment_intent(conn, intent_id=intent_id, now=NOW)
    with pytest.raises(PaymentAdapterError, match="max_amount"):
        submit_payment(
            conn,
            intent_id=intent_id,
            flags=SubmitFlags(execute=True, confirm_owner_payment=True),
            now=NOW,
            max_amount=500_000,
        )


def test_payment_consent_fixture_matches_schema():
    import jsonschema

    schema = json.loads(
        (APP_ROOT.parents[2] / "skills" / "shop-voice-checkin" / "references"
         / "result-schema-payment-consent.json").read_text(encoding="utf-8")
    )
    fixture = json.loads(
        (APP_ROOT / "fixtures" / "payment-consent-yes.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(fixture["structured_result"], schema)


def test_no_test_imports_live_payment_sdk():
    """Guard: tests must not pull a real payment provider client."""
    banned = ("paystack", "flutterwave", "stripe.Charge", "requests.post")
    offenders = []
    for path in (APP_ROOT / "tests").glob("*.py"):
        text = path.read_text(encoding="utf-8").lower()
        for token in banned:
            if token in text and path.name != Path(__file__).name:
                offenders.append(f"{path.name}: {token}")
    # This file names banned tokens in the list itself; only fail on other files.
    assert not offenders
