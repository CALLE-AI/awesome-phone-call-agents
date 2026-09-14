"""Hard call cap + number allowlist, enforced in code for every real provider.

A test suite, a stray click, or a bug in candidate ranking physically cannot dial a stranger:
the number must be in DIALABLE_NUMBERS and the real-call count must be under CALL_BUDGET_MAX.
"""
from __future__ import annotations

from sqlalchemy import func
from sqlmodel import Session, select

from app.calls.provider import CallBudgetExhausted, NumberNotAllowlisted
from app.config import Settings
from app.models import SpentCall


def record_spent_call(session: Session, *, provider: str, provider_call_id: str | None) -> None:
    """Write the ledger row the moment the provider accepts a call, before we know how it went.

    Idempotent on provider_call_id, so a retry or a duplicate webhook cannot double-spend, and a
    call with no provider_call_id never reached CALL-E and is not billed.
    """
    if provider == "mock" or not provider_call_id:
        return
    if session.get(SpentCall, provider_call_id) is None:
        session.add(SpentCall(provider_call_id=provider_call_id, provider=provider))


def count_real_calls(session: Session) -> int:
    """Calls the provider actually accepted, which is what the free tier bills.

    Counted from the SpentCall ledger rather than from CheckCall: a record with no
    `provider_call_id` never reached CALL-E (the request was rejected before a call task existed —
    bad schema, auth, blocked recipient), so no phone rang and no credit was spent, and counting
    those would silently shrink the budget on a bad deploy. Just as importantly, the ledger is not
    demo data, so wiping the demo does not hand the free tier back.
    """
    return int(session.exec(select(func.count()).select_from(SpentCall)).one())


class CallBudget:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def reserve(self, session: Session, *, phone: str, provider: str) -> None:
        """Raise before any dial if the number is not allowlisted or the budget is spent.
        Mock calls are never counted and never gated."""
        if provider == "mock":
            return
        s = self.settings
        if s.CALL_BUDGET_ENFORCE and phone not in s.dialable_numbers:
            raise NumberNotAllowlisted(f"{_mask(phone)} is not in DIALABLE_NUMBERS")
        used = count_real_calls(session)
        if used >= s.CALL_BUDGET_MAX:
            raise CallBudgetExhausted(f"{used}/{s.CALL_BUDGET_MAX} real calls already used")

    def remaining(self, session: Session) -> int:
        return max(0, self.settings.CALL_BUDGET_MAX - count_real_calls(session))


def _mask(phone: str) -> str:
    return ("*" * max(0, len(phone) - 4)) + phone[-4:] if len(phone) > 4 else "***"
