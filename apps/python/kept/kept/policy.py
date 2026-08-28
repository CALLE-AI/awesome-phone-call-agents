"""Decide which overdue invoices earn a call today, and name every refusal.

The cheapest collections call is the one you did not have to place. Most gates
here exist to remove calls: an unexpired promise already covers the invoice, the
customer is asleep, the account is in dispute, or someone called last Tuesday.
What survives is ranked, and only then does the call budget cut the list.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from kept.config import Policy
from kept.models import (
    CallPlan,
    CallTarget,
    Customer,
    Invoice,
    SuppressionReason,
    Suppression,
)
from kept.promises import PromiseLedger, broken_promises, choose_cycle, open_promise
from kept.reconcile import Settlement, apply_payments
from kept.store import AccountBook


class CallPlanner:
    def __init__(
        self, *, policy: Policy, authorized_phones: frozenset[str] | None = None
    ) -> None:
        self._policy = policy
        self._ledger = PromiseLedger(policy=policy)
        self._authorized_phones = authorized_phones

    def plan(self, book: AccountBook, now: datetime, budget: int) -> CallPlan:
        settlement = apply_payments(book.payments, book.invoices)
        statuses = self._ledger.statuses(book.promises, settlement, now.date())
        candidates: list[CallTarget] = []
        suppressions: list[Suppression] = []
        for invoice in sorted(book.invoices, key=lambda i: (i.due_date, i.id)):
            refusal = self._refuse(invoice, book, settlement, now, statuses)
            if refusal is not None:
                suppressions.append(refusal)
                continue
            candidates.append(self._target(invoice, book, settlement, statuses))
        chosen, over_budget = _apply_budget(_rank(candidates), budget)
        return CallPlan(targets=tuple(chosen), suppressions=tuple(suppressions + over_budget))

    def _refuse(
        self,
        invoice: Invoice,
        book: AccountBook,
        settlement: Settlement,
        now: datetime,
        statuses: dict,
    ) -> Suppression | None:
        reason, detail = self._first_blocking_reason(invoice, book, settlement, now, statuses)
        if reason is None:
            return None
        return Suppression(
            invoice_id=invoice.id, customer_id=invoice.customer_id, reason=reason, detail=detail
        )

    def _first_blocking_reason(
        self,
        invoice: Invoice,
        book: AccountBook,
        settlement: Settlement,
        now: datetime,
        statuses: dict,
    ) -> tuple[SuppressionReason | None, str]:
        customer = book.customer_for(invoice)
        if settlement.is_settled(invoice):
            return SuppressionReason.ALREADY_SETTLED, "Invoice is paid in full."
        if customer is None or customer.primary_phone is None:
            return SuppressionReason.NO_PHONE, "No callable number on file."
        if customer.do_not_call:
            return SuppressionReason.DO_NOT_CALL, "Customer is flagged do-not-call."
        if not self._is_authorized(customer):
            return SuppressionReason.NOT_AUTHORIZED, "This exact number is not on the authorized list."
        if invoice.id in book.disputed_invoice_ids():
            return SuppressionReason.DISPUTE_OPEN, "Dispute is open and owned by a human."
        return self._timing_reason(invoice, book, now, statuses, customer)

    def _timing_reason(
        self,
        invoice: Invoice,
        book: AccountBook,
        now: datetime,
        statuses: dict,
        customer: Customer,
    ) -> tuple[SuppressionReason | None, str]:
        if now.date() < self._chase_from(invoice):
            return SuppressionReason.NOT_YET_DUE, f"Chase opens {self._chase_from(invoice)}."
        pending = open_promise(book.promises, statuses, invoice.id)
        if pending is not None:
            return SuppressionReason.PROMISE_OPEN, f"Promise runs to {pending.due_date}."
        blocked_until = self._contactable_from(book, customer)
        if blocked_until is not None and now < blocked_until:
            return SuppressionReason.CONTACT_FREQUENCY_EXCEEDED, f"Callable from {blocked_until.date()}."
        if self._is_quiet_hours(customer, now):
            return SuppressionReason.QUIET_HOURS, f"Local time is outside calling hours in {customer.timezone}."
        return None, ""

    def _is_authorized(self, customer: Customer) -> bool:
        """Whether a human has signed off on dialling this exact number.

        Absent a list, no live call is possible, so the check is skipped rather
        than suppressing every invoice in a simulated run.
        """
        if self._authorized_phones is None:
            return True
        return customer.primary_phone in self._authorized_phones

    def _chase_from(self, invoice: Invoice) -> date:
        return invoice.due_date + timedelta(days=self._policy.grace_days_after_due)

    def _contactable_from(self, book: AccountBook, customer: Customer) -> datetime | None:
        last = book.last_contact_at(customer.id)
        if last is None:
            return None
        return last + timedelta(days=self._policy.min_days_between_calls)

    def _is_quiet_hours(self, customer: Customer, now: datetime) -> bool:
        hour = _local_hour(customer.timezone, now)
        start, end = self._policy.quiet_hours_start, self._policy.quiet_hours_end
        if start == end:
            return False
        if start > end:
            return hour >= start or hour < end
        return start <= hour < end

    def _target(
        self, invoice: Invoice, book: AccountBook, settlement: Settlement, statuses: dict
    ) -> CallTarget:
        history = [p for p in book.promises if p.customer_id == invoice.customer_id]
        broken = broken_promises(book.promises, statuses, invoice.customer_id)
        return CallTarget(
            invoice=invoice,
            customer=book.customers[invoice.customer_id],
            cycle=choose_cycle(history, statuses),
            outstanding_minor=settlement.outstanding_minor(invoice),
            broken_promise_count=len(broken),
            last_broken_promise=broken[-1] if broken else None,
        )


def _local_hour(timezone_name: str, moment: datetime) -> int:
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"Unknown timezone {timezone_name!r} on customer record.") from exc
    return moment.astimezone(zone).hour


def _rank(candidates: list[CallTarget]) -> list[CallTarget]:
    """Broken promises first, then largest exposure, then oldest invoice."""
    return sorted(
        candidates,
        key=lambda t: (-t.broken_promise_count, -t.outstanding_minor, t.invoice.due_date, t.invoice.id),
    )


def _apply_budget(ranked: list[CallTarget], budget: int) -> tuple[list[CallTarget], list[Suppression]]:
    allowed = max(0, budget)
    dropped = [
        Suppression(
            invoice_id=target.invoice.id,
            customer_id=target.customer.id,
            reason=SuppressionReason.CALL_BUDGET_EXHAUSTED,
            detail=f"Run budget of {allowed} call(s) was already spent.",
        )
        for target in ranked[allowed:]
    ]
    return ranked[:allowed], dropped
