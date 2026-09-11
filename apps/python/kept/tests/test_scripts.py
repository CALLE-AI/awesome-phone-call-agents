from __future__ import annotations

from datetime import date

import pytest
from tests.conftest import make_customer, make_invoice, make_promise

from kept.calls.scripts import ScriptWriter, spoken_reference
from kept.config import Organisation
from kept.models import CallCycle, CallTarget

TODAY = date(2026, 8, 24)


@pytest.mark.parametrize(
    ("identifier", "spoken"),
    [
        ("INV-1001", "I N V one zero zero one"),
        ("INV1002", "I N V one zero zero two"),
        ("AR/2026/0044", "A R two zero two six zero zero four four"),
        ("X9", "X nine"),
    ],
)
def test_identifiers_are_rendered_the_way_a_person_reads_them(identifier: str, spoken: str) -> None:
    """Text-to-speech narrates punctuation and casing in a raw identifier."""
    assert spoken_reference(identifier) == spoken


def _target(cycle: CallCycle = CallCycle.FIRST_CONTACT, **extra) -> CallTarget:
    return CallTarget(
        invoice=make_invoice(amount_minor=125_000),
        customer=make_customer(),
        cycle=cycle,
        outstanding_minor=125_000,
        broken_promise_count=extra.get("broken_promise_count", 0),
        last_broken_promise=extra.get("last_broken_promise"),
    )


def _write(target: CallTarget, organisation: Organisation) -> str:
    return ScriptWriter(organisation=organisation).write(target, TODAY)


def test_the_invoice_is_given_in_a_speakable_form(organisation: Organisation) -> None:
    task = _write(_target(), organisation)

    assert "I N V one zero zero one" in task
    assert "Never read punctuation aloud" in task


def test_every_cycle_produces_a_task_that_names_the_creditor(organisation: Organisation) -> None:
    for cycle in CallCycle:
        target = _target(
            cycle,
            broken_promise_count=2,
            last_broken_promise=make_promise(amount_minor=50_000, due="2026-08-15"),
        )

        task = _write(target, organisation)

        assert organisation.name in task
        assert "automated assistant" in task


def test_the_broken_promise_call_states_the_previous_commitment(organisation: Organisation) -> None:
    broken = make_promise(amount_minor=50_000, due="2026-08-15")

    task = _write(_target(CallCycle.BROKEN_PROMISE, last_broken_promise=broken), organisation)

    assert "USD 500.00" in task
    assert "2026-08-15" in task


def test_the_final_notice_states_no_consequence_beyond_a_handover(organisation: Organisation) -> None:
    task = _write(_target(CallCycle.FINAL_NOTICE, broken_promise_count=2), organisation)

    assert "colleague will take the account over" in task
    assert "Never threaten legal action" in task


def test_the_call_language_is_named_so_it_cannot_drift(organisation: Organisation) -> None:
    """The region subtag alone does not hold the spoken language."""
    task = _write(_target(), organisation)

    assert "Speak English for the entire call" in task
    assert "Never switch language" in task


def test_a_vague_amount_may_not_be_accepted(organisation: Organisation) -> None:
    """A vague quantity is not an amount and may not advance the call to the date."""
    task = _write(_target(), organisation)

    assert "Never accept a vague amount" in task
    assert "A date alone is not a commitment" in task


def test_the_agent_may_not_propose_values_the_customer_did_not_say(organisation: Organisation) -> None:
    """A read-back may contain only values the customer actually stated."""
    task = _write(_target(), organisation)

    assert "Never propose an amount or a date the customer has not said" in task
    assert "A read-back may only contain values they stated" in task


def test_the_agent_is_told_it_knows_todays_date(organisation: Organisation) -> None:
    """The date is in the prompt, so the agent may never claim not to have it."""
    task = _write(_target(), organisation)

    assert "Today is 2026-08-24" in task
    assert "Never say you cannot access the date" in task


def test_the_voicemail_rule_withholds_the_amount(organisation: Organisation) -> None:
    task = _write(_target(), organisation)

    assert "no invoice or amount details" in task
    assert organisation.callback_number in task
