"""Tests for client.build_task — the exact text CALL-E receives.

These lock in two live findings from 2026-09-10: a single low-stock item
must agree grammatically ("is" not "are"), and the order-status callback
must state the vendor call's known outcome rather than leaving CALL-E to
invent one (it rejects that task outright).
"""

from __future__ import annotations

import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

import client  # noqa: E402

BASE = {"shop_id": "demo-lagos-corner-shop", "language_style": "pidgin-english", "max_minutes": 4}


def test_reorder_offer_agrees_with_a_single_low_item():
    task = client.build_task({**BASE, "call_type": "reorder_offer", "low_stock_items": ["Fish"]})
    assert "Fish is running low" in task
    assert "Fish are running low" not in task


def test_reorder_offer_agrees_with_multiple_low_items():
    task = client.build_task({**BASE, "call_type": "reorder_offer",
                              "low_stock_items": ["Fish", "Rice"]})
    assert "Fish, Rice are running low" in task


def test_reorder_offer_asks_for_the_vendor_phone_number_explicitly():
    task = client.build_task({**BASE, "call_type": "reorder_offer", "low_stock_items": ["Fish"]})
    assert "phone number" in task
    assert "do not skip the phone number" in task


def test_order_status_states_the_known_outcome_placed():
    task = client.build_task({**BASE, "call_type": "order_status",
                              "order_status_known": "placed",
                              "order_amount": 45000, "order_eta_text": "around 4pm today"})
    assert "placed with the vendor" in task
    assert "around 4pm today" in task
    assert "45000" in task


def test_order_status_states_the_known_outcome_unavailable():
    task = client.build_task({**BASE, "call_type": "order_status",
                              "order_status_known": "unavailable"})
    assert "could not fulfill" in task


def test_order_status_never_asks_the_model_to_guess():
    """The bug this fixes: the old task said 'state whether it was placed...
    if known' with nothing in the request supplying that fact. CALL-E
    correctly refused to create a task like that."""
    task = client.build_task({**BASE, "call_type": "order_status"})
    assert "if known" not in task
    assert "Tell them exactly this" in task
