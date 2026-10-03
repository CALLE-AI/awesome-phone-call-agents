"""Fake payment rail — preview by default, no network.

Real providers (Paystack, Flutterwave, …) can implement the same submit
contract later. Tests and demos must use this module only.

Refs #38 (P10).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import store

DEFAULT_MAX_AMOUNT_NGN = 500_000.0
FAKE_PROVIDER = "fake"


class PaymentAdapterError(Exception):
    """Refuse a payout without contacting any bank API."""


@dataclass(frozen=True)
class SubmitFlags:
    """Mirror CALL-E dual consent: both must be true for a live submit."""

    execute: bool = False
    confirm_owner_payment: bool = False

    @property
    def live(self) -> bool:
        return bool(self.execute and self.confirm_owner_payment)


def preview_payment(conn, *, intent_id: str, now: str) -> dict[str, Any]:
    """Describe what would be paid without moving money."""
    intent = store.get_payment_intent(conn, intent_id=intent_id)
    if intent is None:
        raise PaymentAdapterError(f"unknown intent_id: {intent_id}")
    vendor = conn.execute(
        "SELECT * FROM vendors WHERE vendor_id = ?", (intent["vendor_id"],)
    ).fetchone()
    payee = (vendor["payee_ref"] if vendor else None) or intent["payee_ref"]
    plan = {
        "mode": "preview",
        "intent_id": intent_id,
        "order_id": intent["order_id"],
        "shop_id": intent["shop_id"],
        "vendor_id": intent["vendor_id"],
        "amount": intent["amount"],
        "currency": intent["currency"],
        "status": intent["status"],
        "owner_approved": bool(intent["owner_approved"]),
        "payee_ref_masked": store.mask_payee_ref(payee),
        "provider": FAKE_PROVIDER,
        "would_submit": bool(
            intent["owner_approved"]
            and payee
            and float(intent["amount"]) > 0
            and intent["status"] not in ("paid", "cancelled")
        ),
    }
    store.record_payment_event(
        conn,
        intent_id=intent_id,
        event_type="preview",
        detail="dry-run",
        created_at=now,
    )
    return plan


def submit_payment(
    conn,
    *,
    intent_id: str,
    flags: SubmitFlags,
    now: str,
    max_amount: float | None = DEFAULT_MAX_AMOUNT_NGN,
    force_fail: bool = False,
) -> dict[str, Any]:
    """Submit one transfer for an approved intent.

    Without both live flags, returns a preview plan and does not mark paid.
    Duplicate submits for an already-paid intent return the existing result
    (idempotent).
    """
    intent = store.get_payment_intent(conn, intent_id=intent_id)
    if intent is None:
        raise PaymentAdapterError(f"unknown intent_id: {intent_id}")

    if intent["status"] == "paid" and intent["provider_transfer_id"]:
        return {
            "mode": "idempotent",
            "intent_id": intent_id,
            "status": "paid",
            "provider_transfer_id": intent["provider_transfer_id"],
            "provider": intent["provider"] or FAKE_PROVIDER,
        }

    if intent["status"] == "cancelled":
        raise PaymentAdapterError("payment intent is cancelled")

    if not intent["owner_approved"] or intent["status"] not in (
        "owner_approved",
        "submitted",
        "failed",
    ):
        store.record_payment_event(
            conn,
            intent_id=intent_id,
            event_type="refused",
            detail="owner_approval_required",
            created_at=now,
        )
        raise PaymentAdapterError(
            "owner must approve this exact amount before payout"
        )

    vendor = conn.execute(
        "SELECT * FROM vendors WHERE vendor_id = ?", (intent["vendor_id"],)
    ).fetchone()
    if vendor is None:
        raise PaymentAdapterError(f"unknown vendor_id: {intent['vendor_id']}")
    payee_ref = vendor["payee_ref"]
    payee_provider = vendor["payee_provider"] or FAKE_PROVIDER
    if not payee_ref:
        store.record_payment_event(
            conn,
            intent_id=intent_id,
            event_type="refused",
            detail="payee_not_linked",
            created_at=now,
        )
        raise PaymentAdapterError(
            "vendor has no offline payee_ref; link payee outside the voice path"
        )

    amount = float(intent["amount"])
    if amount <= 0:
        raise PaymentAdapterError("payment amount must be > 0")
    if max_amount is not None and amount > float(max_amount):
        store.record_payment_event(
            conn,
            intent_id=intent_id,
            event_type="refused",
            detail=f"above_cap:{max_amount}",
            created_at=now,
        )
        raise PaymentAdapterError(
            f"amount {amount} exceeds max_amount {max_amount}"
        )

    if not flags.live:
        return preview_payment(conn, intent_id=intent_id, now=now)

    # Fake live path — still no network; stamps a local transfer id.
    transfer_id = f"fake-xfer-{intent_id}"
    if force_fail:
        conn.execute(
            "UPDATE payment_intents SET status = 'failed', payee_ref = ?,"
            " provider = ?, provider_transfer_id = NULL, updated_at = ?"
            " WHERE intent_id = ?",
            (payee_ref, payee_provider, now, intent_id),
        )
        store.record_payment_event(
            conn,
            intent_id=intent_id,
            event_type="failed",
            detail="forced_failure",
            created_at=now,
        )
        return {
            "mode": "execute",
            "intent_id": intent_id,
            "status": "failed",
            "provider": payee_provider,
            "payee_ref_masked": store.mask_payee_ref(payee_ref),
        }

    conn.execute(
        "UPDATE payment_intents SET status = 'paid', payee_ref = ?,"
        " provider = ?, provider_transfer_id = ?, updated_at = ?"
        " WHERE intent_id = ?",
        (payee_ref, FAKE_PROVIDER, transfer_id, now, intent_id),
    )
    store.record_payment_event(
        conn,
        intent_id=intent_id,
        event_type="paid",
        detail=transfer_id,
        created_at=now,
    )
    return {
        "mode": "execute",
        "intent_id": intent_id,
        "status": "paid",
        "provider": FAKE_PROVIDER,
        "provider_transfer_id": transfer_id,
        "payee_ref_masked": store.mask_payee_ref(payee_ref),
        "amount": amount,
        "currency": intent["currency"],
    }
