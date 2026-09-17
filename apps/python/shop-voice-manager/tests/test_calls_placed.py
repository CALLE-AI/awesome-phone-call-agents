"""The committed call record must never carry a number or the account hash.

`calls_placed.py` exists so `.call-state/` can stay out of the repo while the
evidence that real calls happened stays in it.
"""

from __future__ import annotations

import json

import calls_placed


def test_slot_survives_a_shop_id_containing_dashes():
    assert calls_placed.slot(
        "shopvoice-demo-lagos-corner-shop-inventory-2026-09-10"
    ) == ("demo-lagos-corner-shop", "inventory", "2026-09-10")


def test_slot_ignores_a_repeat_suffix():
    assert calls_placed.slot(
        "shopvoice-olabode-stores-sales-2026-09-08-r2"
    ) == ("olabode-stores", "sales", "2026-09-08")


def test_slot_refuses_to_guess():
    assert calls_placed.slot(None) == ("?", "?", "?")
    assert calls_placed.slot("garbage") == ("?", "?", "?")


def test_an_attempt_that_never_created_a_call_is_not_reported():
    """A reserved checkpoint means CALL-E never made the call."""
    records = [
        {"idempotency_key": "shopvoice-a-inventory-2026-09-08", "phase": "reserved"},
        {"idempotency_key": "shopvoice-a-inventory-2026-09-09", "phase": "finished",
         "call_id": "call_real", "status": "completed"},
    ]
    assert [r["call_id"] for r in calls_placed.placed(records)] == ["call_real"]


def test_the_record_carries_no_phone_number_and_no_account_hash(tmp_path, monkeypatch):
    state = tmp_path / ".call-state" / "abc123hash"
    state.mkdir(parents=True)
    (state / "one.json").write_text(json.dumps({
        "call_id": "call_x",
        "idempotency_key": "shopvoice-a-inventory-2026-09-08",
        "masked_phone": "+23481****00",
        "provider_account_hash": "abc123hash",
        "phase": "finished",
        "status": "completed",
    }), encoding="utf-8")
    monkeypatch.setattr(calls_placed, "STATE", tmp_path / ".call-state")

    text = calls_placed.render(calls_placed.checkpoints())
    assert "call_x" in text
    assert "abc123hash" not in text
    assert "23481" not in text
    assert "****" not in text
