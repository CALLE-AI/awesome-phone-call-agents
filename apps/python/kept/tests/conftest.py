from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from kept.config import Organisation, Policy
from kept.models import Customer, Invoice, Payment, Promise


@pytest.fixture
def policy() -> Policy:
    return Policy()


@pytest.fixture
def organisation() -> Organisation:
    return Organisation(name="Northwind Supply Co", callback_number="+12025550199")


def at(day: str, hour: int = 17) -> datetime:
    return datetime.combine(date.fromisoformat(day), datetime.min.time(), tzinfo=timezone.utc).replace(
        hour=hour
    )


def make_customer(
    customer_id: str = "CUS-01",
    *,
    phones: tuple[str, ...] = ("+12025550101",),
    timezone_name: str = "America/New_York",
    locale: str = "en-US",
    do_not_call: bool = False,
) -> Customer:
    return Customer(
        id=customer_id,
        name=f"Customer {customer_id}",
        phones=phones,
        region="US",
        locale=locale,
        timezone=timezone_name,
        do_not_call=do_not_call,
    )


def make_invoice(
    invoice_id: str = "INV-1001",
    *,
    customer_id: str = "CUS-01",
    amount_minor: int = 100_000,
    due: str = "2026-08-01",
) -> Invoice:
    return Invoice(
        id=invoice_id,
        customer_id=customer_id,
        currency="USD",
        amount_minor=amount_minor,
        due_date=date.fromisoformat(due),
    )


def make_payment(
    payment_id: str = "PAY-1",
    *,
    customer_id: str = "CUS-01",
    amount_minor: int = 100_000,
    value_date: str = "2026-08-10",
    reference: str = "",
) -> Payment:
    return Payment(
        id=payment_id,
        customer_id=customer_id,
        amount_minor=amount_minor,
        value_date=date.fromisoformat(value_date),
        reference=reference,
    )


def make_promise(
    promise_id: str = "PRM-1",
    *,
    invoice_id: str = "INV-1001",
    customer_id: str = "CUS-01",
    amount_minor: int = 100_000,
    due: str = "2026-08-15",
    captured: str = "2026-08-05",
) -> Promise:
    return Promise(
        id=promise_id,
        invoice_id=invoice_id,
        customer_id=customer_id,
        call_id=f"call_{promise_id}",
        amount_minor=amount_minor,
        due_date=date.fromisoformat(due),
        method="bank_transfer",
        captured_at=at(captured),
        confidence=0.9,
        evidence="We will pay it.",
    )
