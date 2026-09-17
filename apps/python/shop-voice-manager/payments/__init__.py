"""Vendor payout adapters for Voice Shop Manager (Phase 3).

Voice collects consent and amount. This package moves money — or, for demos,
simulates a transfer — behind explicit opt-in flags. Default is preview only.
"""

from .adapter import (
    DEFAULT_MAX_AMOUNT_NGN,
    PaymentAdapterError,
    SubmitFlags,
    preview_payment,
    submit_payment,
)

__all__ = [
    "DEFAULT_MAX_AMOUNT_NGN",
    "PaymentAdapterError",
    "SubmitFlags",
    "preview_payment",
    "submit_payment",
]
