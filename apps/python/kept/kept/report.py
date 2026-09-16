"""Build the one view an AR controller actually needs, free of rendering.

Two numbers decide whether this system is working: how much of the ledger is
covered by a promise that is still alive, and what share of promises this
customer base actually keeps. Everything below assembles those from the same
replayed state the run used, so the report can never disagree with the ledger.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from kept.config import Policy
from kept.models import Customer, Invoice, Promise, PromiseStatus, SuppressionReason
from kept.promises import PromiseLedger
from kept.reconcile import Settlement, apply_payments
from kept.store import EVENT_CALL_SUPPRESSED, AccountBook
from kept.ledger import Ledger

_SETTLED_STATUSES = {PromiseStatus.KEPT}
_FAILED_STATUSES = {PromiseStatus.BROKEN, PromiseStatus.PARTIAL}
_DECIDED_STATUSES = _SETTLED_STATUSES | _FAILED_STATUSES


@dataclass(frozen=True, slots=True)
class InvoiceLine:
    invoice: Invoice
    customer: Customer | None
    outstanding_minor: int
    promise_status: PromiseStatus | None
    is_disputed: bool

    @property
    def next_action(self) -> str:
        if self.outstanding_minor == 0:
            return "settled"
        if self.is_disputed:
            return "human review"
        if self.customer is None or self.customer.primary_phone is None:
            return "no contact route"
        if self.customer.do_not_call:
            return "do-not-call"
        if self.promise_status is PromiseStatus.OPEN:
            return "awaiting payment"
        if self.promise_status in _FAILED_STATUSES:
            return "re-call"
        return "chase"


@dataclass(frozen=True, slots=True)
class PromiseLine:
    promise: Promise
    customer_name: str
    status: PromiseStatus
    paid_minor: int


@dataclass(frozen=True, slots=True)
class Portfolio:
    as_of: date
    currency: str
    invoices: tuple[InvoiceLine, ...]
    promises: tuple[PromiseLine, ...]
    suppressions: tuple[tuple[str, int], ...]

    @property
    def outstanding_minor(self) -> int:
        return sum(line.outstanding_minor for line in self.invoices)

    @property
    def covered_by_open_promise_minor(self) -> int:
        return sum(p.promise.amount_minor for p in self.promises if p.status is PromiseStatus.OPEN)

    @property
    def kept_minor(self) -> int:
        return sum(p.paid_minor for p in self.promises if p.status in _SETTLED_STATUSES)

    @property
    def broken_minor(self) -> int:
        return sum(
            p.promise.amount_minor - p.paid_minor
            for p in self.promises
            if p.status in _FAILED_STATUSES
        )

    @property
    def keep_rate(self) -> float | None:
        """Share of promises that ran to a verdict and were paid.

        A promise replaced by a later one is excluded: the customer renegotiated
        rather than defaulted, and counting it as a break would overstate risk.
        """
        decided = [p for p in self.promises if p.status in _DECIDED_STATUSES]
        if not decided:
            return None
        return len([p for p in decided if p.status in _SETTLED_STATUSES]) / len(decided)

    @property
    def calls_avoided(self) -> int:
        return sum(count for _, count in self.suppressions)


def build_portfolio(book: AccountBook, ledger: Ledger, policy: Policy, today: date) -> Portfolio:
    settlement = apply_payments(book.payments, book.invoices)
    statuses = PromiseLedger(policy=policy).statuses(book.promises, settlement, today)
    disputed = book.disputed_invoice_ids()
    return Portfolio(
        as_of=today,
        currency=_currency(book),
        invoices=tuple(_invoice_lines(book, settlement, statuses, disputed)),
        promises=tuple(_promise_lines(book, settlement, statuses, policy)),
        suppressions=_suppression_counts(ledger),
    )


def _invoice_lines(
    book: AccountBook, settlement: Settlement, statuses: dict, disputed: set[str]
) -> list[InvoiceLine]:
    latest = _latest_status_by_invoice(book.promises, statuses)
    return [
        InvoiceLine(
            invoice=invoice,
            customer=book.customer_for(invoice),
            outstanding_minor=settlement.outstanding_minor(invoice),
            promise_status=latest.get(invoice.id),
            is_disputed=invoice.id in disputed,
        )
        for invoice in sorted(book.invoices, key=lambda i: (i.due_date, i.id))
    ]


def _promise_lines(
    book: AccountBook, settlement: Settlement, statuses: dict, policy: Policy
) -> list[PromiseLine]:
    ledger = PromiseLedger(policy=policy)
    return [
        PromiseLine(
            promise=promise,
            customer_name=_customer_name(book, promise.customer_id),
            status=statuses[promise.id],
            paid_minor=settlement.allocated_between(
                promise.invoice_id, promise.captured_at.date(), ledger.deadline(promise)
            ),
        )
        for promise in sorted(book.promises, key=lambda p: p.captured_at)
    ]


def _latest_status_by_invoice(promises: list[Promise], statuses: dict) -> dict[str, PromiseStatus]:
    latest: dict[str, Promise] = {}
    for promise in promises:
        current = latest.get(promise.invoice_id)
        if current is None or promise.captured_at > current.captured_at:
            latest[promise.invoice_id] = promise
    return {invoice_id: statuses[p.id] for invoice_id, p in latest.items()}


def _suppression_counts(ledger: Ledger) -> tuple[tuple[str, int], ...]:
    counts: dict[str, int] = {}
    for payload in ledger.of_type(EVENT_CALL_SUPPRESSED):
        reason = str(payload.get("reason", SuppressionReason.NO_PHONE.value))
        counts[reason] = counts.get(reason, 0) + 1
    return tuple(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _customer_name(book: AccountBook, customer_id: str) -> str:
    customer = book.customers.get(customer_id)
    return customer.name if customer else customer_id


def _currency(book: AccountBook) -> str:
    return book.invoices[0].currency if book.invoices else "USD"
