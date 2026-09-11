from __future__ import annotations

from datetime import date

from tests.conftest import make_invoice, make_payment, make_promise

from kept.config import Policy
from kept.models import CallCycle, PromiseStatus
from kept.promises import PromiseLedger, broken_promises, choose_cycle, open_promise
from kept.reconcile import apply_payments


def _settlement(payments: list | None = None):
    return apply_payments(payments or [], [make_invoice(amount_minor=100_000)])


def test_promise_is_open_until_its_grace_period_closes(policy: Policy) -> None:
    promise = make_promise(due="2026-08-15")
    ledger = PromiseLedger(policy=policy)

    assert ledger.status(promise, _settlement(), date(2026, 8, 17)) is PromiseStatus.OPEN


def test_promise_breaks_the_day_after_its_grace_period(policy: Policy) -> None:
    promise = make_promise(due="2026-08-15")
    ledger = PromiseLedger(policy=policy)

    assert ledger.status(promise, _settlement(), date(2026, 8, 18)) is PromiseStatus.BROKEN


def test_payment_inside_the_window_keeps_the_promise(policy: Policy) -> None:
    promise = make_promise(due="2026-08-15", captured="2026-08-05")
    settlement = _settlement([make_payment(amount_minor=100_000, value_date="2026-08-14")])

    assert PromiseLedger(policy=policy).status(promise, settlement, date(2026, 8, 20)) is PromiseStatus.KEPT


def test_payment_that_predates_the_call_cannot_keep_the_promise(policy: Policy) -> None:
    """Cash that arrived before the conversation is not evidence of follow-through."""
    promise = make_promise(due="2026-08-15", captured="2026-08-05")
    settlement = _settlement([make_payment(amount_minor=100_000, value_date="2026-08-01")])

    assert PromiseLedger(policy=policy).status(promise, settlement, date(2026, 8, 20)) is PromiseStatus.BROKEN


def test_part_payment_is_partial_not_kept_and_not_broken(policy: Policy) -> None:
    promise = make_promise(due="2026-08-15", captured="2026-08-05")
    settlement = _settlement([make_payment(amount_minor=40_000, value_date="2026-08-14")])

    assert PromiseLedger(policy=policy).status(promise, settlement, date(2026, 8, 20)) is PromiseStatus.PARTIAL


def test_a_later_promise_replaces_the_earlier_one(policy: Policy) -> None:
    first = make_promise("PRM-1", due="2026-08-15", captured="2026-08-05")
    second = make_promise("PRM-2", due="2026-08-25", captured="2026-08-18")

    statuses = PromiseLedger(policy=policy).statuses([first, second], _settlement(), date(2026, 8, 20))

    assert statuses["PRM-1"] is PromiseStatus.SUPERSEDED
    assert statuses["PRM-2"] is PromiseStatus.OPEN


def test_open_promise_suppresses_further_chasing(policy: Policy) -> None:
    promise = make_promise(due="2026-08-25", captured="2026-08-05")
    statuses = PromiseLedger(policy=policy).statuses([promise], _settlement(), date(2026, 8, 20))

    assert open_promise([promise], statuses, "INV-1001") is promise
    assert open_promise([promise], statuses, "INV-9999") is None


def test_escalation_follows_broken_promises_not_invoice_age() -> None:
    kept = make_promise("PRM-K")
    broken_one = make_promise("PRM-B1")
    broken_two = make_promise("PRM-B2")

    assert choose_cycle([], {}) is CallCycle.FIRST_CONTACT
    assert choose_cycle([kept], {"PRM-K": PromiseStatus.KEPT}) is CallCycle.REMINDER
    assert choose_cycle([broken_one], {"PRM-B1": PromiseStatus.BROKEN}) is CallCycle.BROKEN_PROMISE
    assert (
        choose_cycle(
            [broken_one, broken_two],
            {"PRM-B1": PromiseStatus.BROKEN, "PRM-B2": PromiseStatus.PARTIAL},
        )
        is CallCycle.FINAL_NOTICE
    )


def test_broken_promises_are_returned_oldest_first() -> None:
    older = make_promise("PRM-1", captured="2026-07-01")
    newer = make_promise("PRM-2", captured="2026-08-01")
    statuses = {"PRM-1": PromiseStatus.BROKEN, "PRM-2": PromiseStatus.BROKEN}

    assert [p.id for p in broken_promises([newer, older], statuses, "CUS-01")] == ["PRM-1", "PRM-2"]
