from __future__ import annotations

from datetime import date

from tests.conftest import make_invoice, make_payment

from kept.reconcile import apply_payments


def test_referenced_invoice_is_paid_before_older_ones() -> None:
    old = make_invoice("INV-OLD", due="2026-07-01", amount_minor=50_000)
    referenced = make_invoice("INV-REF", due="2026-08-01", amount_minor=50_000)
    payment = make_payment(amount_minor=50_000, reference="INV-REF")

    settlement = apply_payments([payment], [old, referenced])

    assert settlement.is_settled(referenced)
    assert settlement.outstanding_minor(old) == 50_000


def test_unreferenced_payment_clears_the_oldest_invoice_first() -> None:
    old = make_invoice("INV-OLD", due="2026-07-01", amount_minor=30_000)
    newer = make_invoice("INV-NEW", due="2026-08-01", amount_minor=30_000)

    settlement = apply_payments([make_payment(amount_minor=30_000)], [old, newer])

    assert settlement.is_settled(old)
    assert settlement.outstanding_minor(newer) == 30_000


def test_one_payment_is_never_spent_twice() -> None:
    invoices = [
        make_invoice("INV-A", due="2026-07-01", amount_minor=40_000),
        make_invoice("INV-B", due="2026-08-01", amount_minor=40_000),
    ]
    payment = make_payment(amount_minor=50_000)

    settlement = apply_payments([payment], invoices)

    allocated = sum(a.amount_minor for a in settlement.allocations if a.payment_id == payment.id)
    assert allocated == payment.amount_minor
    assert settlement.outstanding_minor(invoices[1]) == 30_000


def test_an_invoice_never_absorbs_more_than_it_is_worth() -> None:
    invoice = make_invoice(amount_minor=10_000)
    payments = [make_payment("PAY-1", amount_minor=10_000), make_payment("PAY-2", amount_minor=10_000)]

    settlement = apply_payments(payments, [invoice])

    assert settlement.allocated_minor(invoice.id) == 10_000
    assert settlement.outstanding_minor(invoice) == 0


def test_payments_are_only_matched_within_their_own_customer() -> None:
    invoice = make_invoice(customer_id="CUS-01")
    stranger = make_payment(customer_id="CUS-99")

    settlement = apply_payments([stranger], [invoice])

    assert settlement.allocations == ()
    assert settlement.outstanding_minor(invoice) == invoice.amount_minor


def test_allocation_window_only_counts_cash_inside_the_promise_period() -> None:
    invoice = make_invoice(amount_minor=20_000)
    early = make_payment("PAY-EARLY", amount_minor=20_000, value_date="2026-08-02")

    settlement = apply_payments([early], [invoice])

    assert settlement.allocated_between(invoice.id, date(2026, 8, 5), date(2026, 8, 20)) == 0
    assert settlement.allocated_between(invoice.id, date(2026, 8, 1), date(2026, 8, 20)) == 20_000
