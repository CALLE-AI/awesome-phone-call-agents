"""Read the operator's ledgers and replay ours into one queryable book.

Customers, invoices and payments belong to the accounting system and are read
only. Promises, disputes and contact history are ours, and are rebuilt from the
audit ledger every run so there is never a second copy to fall out of step.
"""

from __future__ import annotations

import csv
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

from kept.ledger import Ledger
from kept.models import (
    CallCycle,
    CallOutcome,
    ContactEvent,
    Customer,
    Dispute,
    Invoice,
    Payment,
    Promise,
)
from kept.money import parse_amount_to_minor

EVENT_CALL_DISPATCHED = "call_dispatched"
EVENT_CALL_PLACED = "call_placed"
EVENT_PROMISE_RECORDED = "promise_recorded"
EVENT_DISPUTE_RECORDED = "dispute_recorded"
EVENT_CALL_SUPPRESSED = "call_suppressed"
EVENT_RUN_STARTED = "run_started"
EVENT_CAPTURE_REJECTED = "capture_rejected"
EVENT_CALL_FAILED = "call_failed"


class DataError(ValueError):
    """Raised when an input file cannot be read as the book it claims to be."""


@dataclass(frozen=True, slots=True)
class AccountBook:
    customers: dict[str, Customer]
    invoices: list[Invoice]
    payments: list[Payment]
    promises: list[Promise] = field(default_factory=list)
    disputes: list[Dispute] = field(default_factory=list)
    contacts: list[ContactEvent] = field(default_factory=list)

    def customer_for(self, invoice: Invoice) -> Customer | None:
        return self.customers.get(invoice.customer_id)

    def disputed_invoice_ids(self) -> set[str]:
        return {dispute.invoice_id for dispute in self.disputes}

    def last_contact_at(self, customer_id: str) -> datetime | None:
        moments = [c.occurred_at for c in self.contacts if c.customer_id == customer_id]
        return max(moments) if moments else None


def load_book(data_dir: Path, ledger: Ledger) -> AccountBook:
    customers = {customer.id: customer for customer in _read_customers(data_dir / "customers.csv")}
    invoices = _read_invoices(data_dir / "invoices.csv", customers)
    payments = _read_payments(data_dir, customers)
    return AccountBook(
        customers=customers,
        invoices=invoices,
        payments=payments,
        promises=_replay_promises(ledger),
        disputes=_replay_disputes(ledger),
        contacts=_replay_contacts(ledger),
    )


def _read_customers(path: Path) -> list[Customer]:
    return [
        Customer(
            id=row["id"],
            name=row["name"],
            phones=tuple(p.strip() for p in row["phones"].split("|") if p.strip()),
            region=row["region"],
            locale=row["locale"],
            timezone=row["timezone"],
            do_not_call=_read_flag(row.get("do_not_call")),
        )
        for row in _rows(path, required={"id", "name", "phones", "region", "locale", "timezone"})
    ]


def _read_invoices(path: Path, customers: dict[str, Customer]) -> list[Invoice]:
    invoices = [
        Invoice(
            id=row["id"],
            customer_id=row["customer_id"],
            currency=row["currency"].upper(),
            amount_minor=parse_amount_to_minor(row["amount"]),
            due_date=date.fromisoformat(row["due_date"]),
        )
        for row in _rows(path, required={"id", "customer_id", "currency", "amount", "due_date"})
    ]
    _require_known_customers(invoices, customers, path)
    return invoices


def _read_payments(data_dir: Path, customers: dict[str, Customer]) -> list[Payment]:
    """Read every bank feed dropped into the data directory, newest file last."""
    payments: list[Payment] = []
    for path in _payment_files(data_dir):
        batch = [
            Payment(
                id=row["id"],
                customer_id=row["customer_id"],
                amount_minor=parse_amount_to_minor(row["amount"]),
                value_date=date.fromisoformat(row["value_date"]),
                reference=(row.get("reference") or "").strip(),
            )
            for row in _rows(path, required={"id", "customer_id", "amount", "value_date"})
        ]
        _require_known_customers(batch, customers, path)
        payments.extend(batch)
    _require_unique_payment_ids(payments)
    return payments


def _payment_files(data_dir: Path) -> list[Path]:
    single = data_dir / "payments.csv"
    feed = sorted((data_dir / "payments").glob("*.csv"))
    return ([single] if single.exists() else []) + feed


def _require_unique_payment_ids(payments: list[Payment]) -> None:
    counts = Counter(payment.id for payment in payments)
    duplicates = sorted(payment_id for payment_id, count in counts.items() if count > 1)
    if duplicates:
        raise DataError(f"Payment ids appear more than once: {', '.join(duplicates)}")


def _require_known_customers(
    records: Iterable[Any], customers: dict[str, Customer], path: Path
) -> None:
    unknown = sorted({r.customer_id for r in records if r.customer_id not in customers})
    if unknown:
        raise DataError(f"{path.name} references unknown customers: {', '.join(unknown)}")


def _rows(path: Path, *, required: set[str]) -> list[dict[str, str]]:
    if not path.exists():
        raise DataError(f"Missing required input file {path}.")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise DataError(f"{path.name} is missing columns: {', '.join(sorted(missing))}")
        return [row for row in reader if any((value or "").strip() for value in row.values())]


def _read_flag(raw: str | None) -> bool:
    return (raw or "").strip().lower() in {"1", "true", "yes", "y"}


def _replay_promises(ledger: Ledger) -> list[Promise]:
    return [
        Promise(
            id=p["id"],
            invoice_id=p["invoice_id"],
            customer_id=p["customer_id"],
            call_id=p["call_id"],
            amount_minor=int(p["amount_minor"]),
            due_date=date.fromisoformat(p["due_date"]),
            method=p["method"],
            captured_at=datetime.fromisoformat(p["captured_at"]),
            confidence=float(p["confidence"]),
            evidence=p["evidence"],
        )
        for p in ledger.of_type(EVENT_PROMISE_RECORDED)
    ]


def _replay_disputes(ledger: Ledger) -> list[Dispute]:
    return [
        Dispute(
            invoice_id=d["invoice_id"],
            customer_id=d["customer_id"],
            call_id=d["call_id"],
            reason=d["reason"],
            raised_at=datetime.fromisoformat(d["raised_at"]),
        )
        for d in ledger.of_type(EVENT_DISPUTE_RECORDED)
    ]


def _replay_contacts(ledger: Ledger) -> list[ContactEvent]:
    return [
        ContactEvent(
            invoice_id=c["invoice_id"],
            customer_id=c["customer_id"],
            call_id=c["call_id"],
            cycle=CallCycle(c["cycle"]),
            occurred_at=datetime.fromisoformat(c["occurred_at"]),
            outcome=CallOutcome(c["outcome"]) if c.get("outcome") else None,
        )
        for c in ledger.of_type(EVENT_CALL_PLACED)
    ]
