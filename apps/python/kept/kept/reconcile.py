"""Apply a payments feed to invoices without ever spending a payment twice.

Cash arrives as bank lines, not as answers to invoices. Matching the two is the
step that decides whether a promise was kept, so it is done here explicitly and
deterministically rather than inferred from a call.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from kept.models import Allocation, Invoice, Payment


@dataclass(frozen=True, slots=True)
class Settlement:
    """The result of applying payments to invoices, plus the queries built on it."""

    allocations: tuple[Allocation, ...]

    def allocated_minor(self, invoice_id: str) -> int:
        return sum(a.amount_minor for a in self.allocations if a.invoice_id == invoice_id)

    def outstanding_minor(self, invoice: Invoice) -> int:
        return max(0, invoice.amount_minor - self.allocated_minor(invoice.id))

    def is_settled(self, invoice: Invoice) -> bool:
        return self.outstanding_minor(invoice) == 0

    def allocated_between(self, invoice_id: str, start: date, end: date) -> int:
        return sum(
            allocation.amount_minor
            for allocation in self.allocations
            if allocation.invoice_id == invoice_id and start <= allocation.value_date <= end
        )


def apply_payments(payments: list[Payment], invoices: list[Invoice]) -> Settlement:
    """Allocate every payment, referenced lines first, then oldest invoice first."""
    remaining_on_payment = {payment.id: payment.amount_minor for payment in payments}
    remaining_on_invoice = {invoice.id: invoice.amount_minor for invoice in invoices}
    allocations: list[Allocation] = []
    ordered = sorted(payments, key=lambda payment: (payment.value_date, payment.id))
    for payment in ordered:
        for invoice in _candidate_invoices(payment, invoices):
            amount = min(remaining_on_payment[payment.id], remaining_on_invoice[invoice.id])
            if amount <= 0:
                continue
            allocations.append(_allocate(payment, invoice, amount))
            remaining_on_payment[payment.id] -= amount
            remaining_on_invoice[invoice.id] -= amount
    return Settlement(allocations=tuple(allocations))


def _allocate(payment: Payment, invoice: Invoice, amount_minor: int) -> Allocation:
    return Allocation(
        payment_id=payment.id,
        invoice_id=invoice.id,
        amount_minor=amount_minor,
        value_date=payment.value_date,
    )


def _candidate_invoices(payment: Payment, invoices: list[Invoice]) -> list[Invoice]:
    """Referenced invoice first; then the customer's oldest unsettled invoices."""
    owned = [invoice for invoice in invoices if invoice.customer_id == payment.customer_id]
    referenced = [invoice for invoice in owned if invoice.id == payment.reference]
    by_age = sorted(
        (invoice for invoice in owned if invoice.id != payment.reference),
        key=lambda invoice: (invoice.due_date, invoice.id),
    )
    return referenced + by_age
