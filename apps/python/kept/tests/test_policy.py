from __future__ import annotations

from tests.conftest import at, make_customer, make_invoice, make_payment, make_promise

from kept.config import Policy
from kept.models import CallCycle, ContactEvent, Dispute, SuppressionReason
from kept.policy import CallPlanner
from kept.store import AccountBook


def _book(**overrides) -> AccountBook:
    defaults = {
        "customers": {"CUS-01": make_customer()},
        "invoices": [make_invoice(due="2026-08-01")],
        "payments": [],
    }
    return AccountBook(**{**defaults, **overrides})


def _reasons(plan) -> set[SuppressionReason]:
    return {suppression.reason for suppression in plan.suppressions}


def test_overdue_invoice_past_its_grace_period_is_called(policy: Policy) -> None:
    plan = CallPlanner(policy=policy).plan(_book(), at("2026-08-10"), budget=5)

    assert [t.invoice.id for t in plan.targets] == ["INV-1001"]
    assert plan.targets[0].cycle is CallCycle.FIRST_CONTACT


def test_invoice_inside_its_grace_period_is_not_yet_chased(policy: Policy) -> None:
    plan = CallPlanner(policy=policy).plan(_book(), at("2026-08-02"), budget=5)

    assert plan.calls_required == 0
    assert _reasons(plan) == {SuppressionReason.NOT_YET_DUE}


def test_do_not_call_customers_are_never_dialled(policy: Policy) -> None:
    book = _book(customers={"CUS-01": make_customer(do_not_call=True)})

    plan = CallPlanner(policy=policy).plan(book, at("2026-08-10"), budget=5)

    assert _reasons(plan) == {SuppressionReason.DO_NOT_CALL}


def test_customer_without_a_number_is_not_dialled(policy: Policy) -> None:
    book = _book(customers={"CUS-01": make_customer(phones=())})

    plan = CallPlanner(policy=policy).plan(book, at("2026-08-10"), budget=5)

    assert _reasons(plan) == {SuppressionReason.NO_PHONE}


def test_settled_invoice_is_not_chased(policy: Policy) -> None:
    book = _book(payments=[make_payment(amount_minor=100_000)])

    plan = CallPlanner(policy=policy).plan(book, at("2026-08-15"), budget=5)

    assert _reasons(plan) == {SuppressionReason.ALREADY_SETTLED}


def test_open_dispute_hands_the_invoice_to_a_human(policy: Policy) -> None:
    dispute = Dispute(
        invoice_id="INV-1001",
        customer_id="CUS-01",
        call_id="call_1",
        reason="Billed twice.",
        raised_at=at("2026-08-05"),
    )
    plan = CallPlanner(policy=policy).plan(_book(disputes=[dispute]), at("2026-08-10"), budget=5)

    assert _reasons(plan) == {SuppressionReason.DISPUTE_OPEN}


def test_live_promise_removes_the_call_entirely(policy: Policy) -> None:
    promise = make_promise(due="2026-08-25", captured="2026-08-06")

    plan = CallPlanner(policy=policy).plan(_book(promises=[promise]), at("2026-08-10"), budget=5)

    assert _reasons(plan) == {SuppressionReason.PROMISE_OPEN}


def test_customer_called_this_week_is_left_alone(policy: Policy) -> None:
    contact = ContactEvent(
        invoice_id="INV-1001",
        customer_id="CUS-01",
        call_id="call_1",
        cycle=CallCycle.FIRST_CONTACT,
        occurred_at=at("2026-08-09"),
        outcome=None,
    )
    plan = CallPlanner(policy=policy).plan(_book(contacts=[contact]), at("2026-08-12"), budget=5)

    assert _reasons(plan) == {SuppressionReason.CONTACT_FREQUENCY_EXCEEDED}


def test_customer_asleep_in_their_own_timezone_is_not_dialled(policy: Policy) -> None:
    book = _book(customers={"CUS-01": make_customer(timezone_name="Pacific/Honolulu")})

    plan = CallPlanner(policy=policy).plan(book, at("2026-08-10", hour=17), budget=5)

    assert _reasons(plan) == {SuppressionReason.QUIET_HOURS}


def test_budget_cuts_the_lowest_ranked_targets_and_says_so(policy: Policy) -> None:
    book = _book(
        customers={"CUS-01": make_customer(), "CUS-02": make_customer("CUS-02", phones=("+12025550102",))},
        invoices=[
            make_invoice("INV-SMALL", due="2026-08-01", amount_minor=10_000),
            make_invoice("INV-LARGE", customer_id="CUS-02", due="2026-08-01", amount_minor=90_000),
        ],
    )

    plan = CallPlanner(policy=policy).plan(book, at("2026-08-10"), budget=1)

    assert [t.invoice.id for t in plan.targets] == ["INV-LARGE"]
    assert plan.suppressions[0].reason is SuppressionReason.CALL_BUDGET_EXHAUSTED


def test_a_broken_promise_outranks_a_larger_untouched_invoice(policy: Policy) -> None:
    book = _book(
        customers={"CUS-01": make_customer(), "CUS-02": make_customer("CUS-02", phones=("+12025550102",))},
        invoices=[
            make_invoice("INV-BROKEN", due="2026-08-01", amount_minor=10_000),
            make_invoice("INV-BIG", customer_id="CUS-02", due="2026-08-01", amount_minor=90_000),
        ],
        promises=[make_promise("PRM-1", invoice_id="INV-BROKEN", amount_minor=10_000, due="2026-08-05", captured="2026-08-02")],
    )

    plan = CallPlanner(policy=policy).plan(book, at("2026-08-20"), budget=1)

    assert plan.targets[0].invoice.id == "INV-BROKEN"
    assert plan.targets[0].cycle is CallCycle.BROKEN_PROMISE


def test_zero_budget_places_nothing_but_still_explains_every_account(policy: Policy) -> None:
    plan = CallPlanner(policy=policy).plan(_book(), at("2026-08-10"), budget=0)

    assert plan.calls_required == 0
    assert _reasons(plan) == {SuppressionReason.CALL_BUDGET_EXHAUSTED}
