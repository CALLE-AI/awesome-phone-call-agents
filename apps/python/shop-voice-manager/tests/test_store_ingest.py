"""Tests for the ledger and the ingest policy. No credentials, no calls.

Refs #14, #16, #26.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = APP_ROOT / "fixtures"

import ingest  # noqa: E402
import store  # noqa: E402
import summarize  # noqa: E402
from demo_ledger import build  # noqa: E402

SHOP = "demo-lagos-corner-shop"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def conn(tmp_path):
    c = store.connect(tmp_path / "t.db")
    store.initialize(c)
    with c:
        profile = load("shop-profile.json")
        store.upsert_shop(c, profile)
        store.seed_products(c, profile)
    yield c
    c.close()


def count(conn, table: str) -> int:
    return conn.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]


# ---------------------------------------------------------------- schema

def test_initialize_is_idempotent(tmp_path):
    path = tmp_path / "x.db"
    c = store.connect(path)
    store.initialize(c)
    store.initialize(c)
    assert store.schema_version(c) == store.SCHEMA_VERSION
    store.check_compatible(c)
    c.close()


def test_incompatible_schema_is_refused(tmp_path):
    c = store.connect(tmp_path / "y.db")
    store.initialize(c)
    with c:
        c.execute("UPDATE schema_meta SET value = '99' WHERE key = 'version'")
    with pytest.raises(store.StoreError):
        store.check_compatible(c)
    c.close()


def test_missing_ledger_is_an_error(tmp_path):
    with pytest.raises(store.StoreError):
        store.connect(tmp_path / "nope.db", read_only=True)


def test_product_names_normalize_for_joining():
    assert store.normalize("  Cooking   Oil ") == "cooking oil"
    assert store.normalize("Rice") == store.normalize("rice")


# ---------------------------------------------------------------- policy

@pytest.mark.parametrize("fixture,reason_contains", [
    ("edge-cases/no-answer.json", "no_answer"),
    ("edge-cases/voicemail.json", "voicemail"),
    ("edge-cases/consent-refused.json", "did not complete"),
    ("edge-cases/low-confidence.json", "confidence"),
])
def test_bad_outcomes_write_a_receipt_and_nothing_else(conn, fixture, reason_contains):
    before = count(conn, "inventory_readings") + count(conn, "daily_sales")
    result = ingest.ingest_call(conn, load(fixture))

    assert result.accepted is False
    assert reason_contains in result.reason
    assert result.rows_written == 0
    assert count(conn, "inventory_readings") + count(conn, "daily_sales") == before

    receipt = conn.execute(
        "SELECT * FROM call_receipts WHERE call_id = ?", (result.call_id,)
    ).fetchone()
    assert receipt["accepted"] == 0
    assert receipt["reason"] == result.reason


def test_low_confidence_claims_success_and_is_still_rejected(conn):
    """The trap: task_completed is true. Only the score says otherwise."""
    call = load("edge-cases/low-confidence.json")
    assert call["task_completed"] is True

    result = ingest.ingest_call(conn, call)
    assert result.accepted is False
    assert count(conn, "daily_sales") == 0


def test_threshold_is_configurable(conn):
    call = load("edge-cases/low-confidence.json")
    assert ingest.ingest_call(conn, call, threshold=0.3).accepted is True


def test_partial_check_in_keeps_what_we_already_knew(conn):
    ingest.ingest_call(conn, load("calls/2026-08-16-inventory.json"))
    milo_before = conn.execute(
        "SELECT quantity_estimate q FROM products WHERE name_normalized = 'milo'"
    ).fetchone()["q"]

    result = ingest.ingest_call(conn, load("edge-cases/partial-inventory.json"))
    assert result.accepted and result.rows_written == 2

    milo_after = conn.execute(
        "SELECT quantity_estimate q FROM products WHERE name_normalized = 'milo'"
    ).fetchone()["q"]
    assert milo_after == milo_before, "a partial call must not erase untouched products"


def test_unknown_call_type_is_rejected(conn):
    call = load("calls/2026-08-10-sales.json")
    call["metadata"]["call_type"] = "gossip"
    assert ingest.ingest_call(conn, call).accepted is False


def test_malformed_call_raises_rather_than_writing_junk(conn):
    call = load("calls/2026-08-10-sales.json")
    del call["metadata"]["shop_id"]
    with pytest.raises(ValueError):
        ingest.ingest_call(conn, call)


# ---------------------------------------------------------------- idempotency

def test_reingesting_the_same_call_changes_nothing(conn):
    call = load("calls/2026-08-14-sales.json")
    ingest.ingest_call(conn, call)
    snapshot = (count(conn, "daily_sales"), count(conn, "procurement_items"),
                count(conn, "call_receipts"))

    for _ in range(3):
        ingest.ingest_call(conn, call)

    assert (count(conn, "daily_sales"), count(conn, "procurement_items"),
            count(conn, "call_receipts")) == snapshot


def test_corrected_call_does_not_leave_stale_line_items(conn):
    """A re-ingest with fewer items must drop the ones no longer reported."""
    call = load("calls/2026-08-14-sales.json")
    ingest.ingest_call(conn, call)
    assert count(conn, "procurement_items") == 3

    corrected = copy.deepcopy(call)
    corrected["structured_result"]["procurement_items"] = [
        {"name": "Rice", "amount": 45000, "supplier": "Alhaji Musa Stores"}
    ]
    corrected["structured_result"]["procurement_spend"] = 45000
    ingest.ingest_call(conn, corrected)

    assert count(conn, "procurement_items") == 1
    assert conn.execute(
        "SELECT procurement_spend s FROM daily_sales WHERE sales_date = '2026-08-14'"
    ).fetchone()["s"] == 45000


def test_every_call_leaves_a_receipt(tmp_path):
    path = build(tmp_path / "all.db", include_edge_cases=True)
    conn = store.connect(path, read_only=True)
    fixtures = len(list((FIXTURES / "calls").glob("*.json"))) + \
        len(list((FIXTURES / "edge-cases").glob("*.json")))
    assert count(conn, "call_receipts") == fixtures
    conn.close()


# ---------------------------------------------------------------- end to end

def test_ingest_then_summarize_matches_the_golden_file(tmp_path):
    """The contract test. Fixtures -> real store -> real ingest -> summary."""
    path = build(tmp_path / "e2e.db")
    conn = store.connect(path, read_only=True)
    summary = summarize.build_summary(conn, SHOP, "2026-08-10", "2026-08-16")
    conn.close()

    expected = json.loads(
        (FIXTURES / "expected" / "summary-turnover.json").read_text(encoding="utf-8"))
    assert summary == expected


def test_rejected_calls_do_not_shift_the_totals(tmp_path):
    clean = build(tmp_path / "clean.db")
    dirty = build(tmp_path / "dirty.db", include_edge_cases=True)

    def summarise(p):
        c = store.connect(p, read_only=True)
        try:
            return summarize.build_summary(c, SHOP, "2026-08-10", "2026-08-16")
        finally:
            c.close()

    a, b = summarise(clean), summarise(dirty)
    assert a["estimated_revenue"] == b["estimated_revenue"]
    assert a["slow_moving_capital"] == b["slow_moving_capital"]


# ---------------------------------------------------------------- Phase 2 vendors (P1) + new goods


def test_v1_ledger_upgrades_to_current(tmp_path):
    path = tmp_path / "old.db"
    c = store.connect(path)
    # Simulate a v1 stamp with only core tables present, then re-init.
    store.initialize(c)
    with c:
        c.execute("UPDATE schema_meta SET value = '1' WHERE key = 'version'")
        c.execute("DROP TABLE IF EXISTS vendors")
        c.execute("DROP TABLE IF EXISTS restock_requests")
        c.execute("DROP TABLE IF EXISTS orders")
        c.execute("DROP TABLE IF EXISTS payment_intents")
        c.execute("DROP TABLE IF EXISTS payment_events")
    store.initialize(c)
    assert store.schema_version(c) == store.SCHEMA_VERSION
    store.check_compatible(c)
    tables = {
        r["name"]
        for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert {"vendors", "restock_requests", "orders",
            "payment_intents", "payment_events"} <= tables
    c.close()


def test_upsert_and_find_vendor_by_spoken_name(conn):
    with conn:
        vid = store.upsert_vendor(
            conn,
            shop_id=SHOP,
            display_name="Mama Sikiru",
            goods=["fish"],
            phone_e164="+2348000000099",
            now="2026-09-07T10:00:00Z",
        )
    row = store.find_vendor_by_name(conn, shop_id=SHOP, name="mama sikiru")
    assert row is not None
    assert row["vendor_id"] == vid
    assert "fish" in json.loads(row["goods_json"])
    listed = store.list_vendors(conn, shop_id=SHOP)
    assert listed[0]["phone_masked"].endswith("0099")
    assert "*" in listed[0]["phone_masked"]
    assert listed[0]["goods"] == ["fish"]


def test_vendor_upsert_does_not_erase_phone_when_omitted(conn):
    with conn:
        store.upsert_vendor(
            conn, shop_id=SHOP, display_name="Rice Man",
            goods=["rice"], phone_e164="+2348111111111", now="2026-09-07",
        )
        store.upsert_vendor(
            conn, shop_id=SHOP, display_name="Rice Man",
            goods=["rice", "beans"], phone_e164=None, now="2026-09-08",
        )
    row = store.find_vendor_by_name(conn, shop_id=SHOP, name="Rice Man")
    assert row["phone_e164"] == "+2348111111111"
    assert json.loads(row["goods_json"]) == ["rice", "beans"]


def test_new_goods_mentioned_on_inventory_call_are_added(conn):
    """Owners can introduce SKUs that were never in the seed profile."""
    before = {
        r["name_normalized"]
        for r in conn.execute(
            "SELECT name_normalized FROM products WHERE shop_id = ?", (SHOP,)
        )
    }
    assert "fresh fish" not in before

    call = load("calls/2026-08-10-inventory.json")
    call = copy.deepcopy(call)
    call["call_id"] = "call-new-goods-fish"
    call["structured_result"]["products"].append({
        "name": "Fresh Fish",
        "quantity_estimate": 2,
        "unit": "cooler boxes",
        "running_low": False,
        "is_new_item": True,
    })
    result = ingest.ingest_call(conn, call)
    assert result.accepted

    row = conn.execute(
        "SELECT display_name, quantity_estimate, unit FROM products"
        " WHERE shop_id = ? AND name_normalized = ?",
        (SHOP, "fresh fish"),
    ).fetchone()
    assert row is not None
    assert row["display_name"] == "Fresh Fish"
    assert row["quantity_estimate"] == 2
    assert row["unit"] == "cooler boxes"


def test_mask_phone_hides_middle_digits():
    assert store.mask_phone("+2348000000000").endswith("0000")
    assert store.mask_phone(None) == ""
    assert store.mask_phone("12") == "***"
