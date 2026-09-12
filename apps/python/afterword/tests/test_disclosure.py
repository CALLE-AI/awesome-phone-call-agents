"""The disclosure budget, and the script it guards.

A bereaved family tells its solicitor everything; an institution on the phone
gets three things. These tests fail the build if a script could say a cause of
death, a date of birth or a balance, and they fail it if the script stops
disclosing what it is or starts trying to do something.

The estate used here holds real-looking private values, so a leak is caught by
the same mechanism that would catch it in production rather than by a
placeholder that could never have leaked.
"""

from __future__ import annotations

import re

import pytest

from afterword import registry
from afterword.disclosure import DisclosureError, budget, check, violations
from afterword.models import Estate
from afterword.task import build_task
from tests.builders import make_estate, make_institution

ESTATE = make_estate()
INSTITUTION = make_institution()
SCRIPT = build_task(ESTATE, INSTITUTION)


# --------------------------------------------------------------------------
# The budget
# --------------------------------------------------------------------------


def test_the_budget_is_exactly_three_things() -> None:
    assert budget(ESTATE) == (
        ESTATE.deceased_name,
        ESTATE.executor_name,
        ESTATE.reference,
    )


def test_everything_else_on_the_record_is_marked_withheld() -> None:
    withheld = ESTATE.withheld
    assert ESTATE.cause_of_death in withheld
    assert ESTATE.estimated_balance in withheld
    assert "1941-07-03" in withheld
    assert not any(value in withheld for value in ESTATE.disclosable)


def test_an_estate_with_nothing_private_still_has_a_budget() -> None:
    bare = Estate(
        estate_id="est-0002",
        deceased_name="R. Fenn",
        executor_name="P. Fenn",
        reference="PRB-0002",
    )
    assert budget(bare) == ("R. Fenn", "P. Fenn", "PRB-0002")
    assert bare.withheld == ()


# --------------------------------------------------------------------------
# What may never be said
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "leak",
    [
        "The cause of death was pneumonia.",
        "She died of heart failure last month.",
        "He passed away from a long illness.",
        "She had been in palliative care.",
        "The post-mortem is not finished.",
    ],
)
def test_a_cause_of_death_is_refused(leak: str) -> None:
    assert "forbidden_cause_of_death" in violations(leak, ESTATE)


@pytest.mark.parametrize(
    "leak",
    [
        "Her date of birth was in the summer.",
        "She was born on a Tuesday.",
        "The DOB we hold is on the form.",
        "Reference 1941-07-03.",
        "Reference 03/07/1941.",
    ],
)
def test_a_date_of_birth_is_refused(leak: str) -> None:
    assert "forbidden_date_of_birth" in violations(leak, ESTATE)


@pytest.mark.parametrize(
    "leak",
    [
        "The balance is not in dispute.",
        "There is $2,140.55 in the account.",
        "The account holds 2,140.55.",
        "About four thousand pounds remain.",
    ],
)
def test_a_balance_is_refused(leak: str) -> None:
    assert "forbidden_balance" in violations(leak, ESTATE)


def test_a_withheld_value_repeated_verbatim_is_refused() -> None:
    leak = f"Some background: {ESTATE.notes}."
    assert "withheld_estate_value_present" in violations(leak, ESTATE)


def test_the_violation_does_not_repeat_the_thing_it_caught() -> None:
    """A failure report that quotes the secret has leaked it into the log."""
    found = violations(f"Background: {ESTATE.notes}.", ESTATE)
    assert all(ESTATE.notes not in reason for reason in found)


def test_check_returns_clean_text_and_refuses_the_rest() -> None:
    assert check("Nothing untoward here.", ESTATE) == "Nothing untoward here."
    with pytest.raises(DisclosureError) as raised:
        check("The cause of death was recorded yesterday.", ESTATE)
    assert raised.value.violations == ("forbidden_cause_of_death",)


# --------------------------------------------------------------------------
# The script itself
# --------------------------------------------------------------------------


def test_the_script_survives_the_budget_for_every_demo_institution() -> None:
    for institution in registry.INSTITUTIONS:
        text = build_task(registry.ESTATE, institution)
        assert violations(text, registry.ESTATE) == ()


def test_a_leak_through_a_permitted_field_is_still_caught() -> None:
    """The budget is a whitelist of values, not of fields. A reference that
    happens to be a date of birth is still a date of birth."""
    with pytest.raises(DisclosureError):
        build_task(make_estate(reference="1941-07-03"), INSTITUTION)


def test_the_script_discloses_that_it_is_automated_and_who_it_is_for() -> None:
    assert "automated call" in SCRIPT
    assert ESTATE.executor_name in SCRIPT
    assert "executor" in SCRIPT


def test_the_script_reports_the_death_rather_than_asserting_it() -> None:
    """The agent is not a registrar. It says an executor has reported a death
    and asks what is required."""
    assert "the executor has reported a death" in SCRIPT
    assert "has died" not in SCRIPT
    assert "is deceased" not in SCRIPT


def test_the_script_asks_and_never_acts() -> None:
    assert "Do not ask them to close an account" in SCRIPT
    assert "Do not agree to terms, waive anything, or accept a settlement." in SCRIPT
    assert "cannot accept anything on the family's behalf" in SCRIPT


@pytest.mark.parametrize(
    "instruction",
    [
        "close the account",
        "cancel the direct debit",
        "transfer the balance",
        "redirect the post",
    ],
)
def test_the_script_never_instructs_the_agent_to_do_anything(instruction: str) -> None:
    assert instruction not in SCRIPT.lower()


def test_the_script_names_the_five_questions_it_is_there_to_ask() -> None:
    for question in ("Question 1:", "Question 2:", "Question 3:", "Question 4:", "Question 5:"):
        assert question in SCRIPT


def test_the_script_refuses_to_hand_over_anything_else_about_the_estate() -> None:
    assert "you do not hold it" in SCRIPT


# --------------------------------------------------------------------------
# Numbers
# --------------------------------------------------------------------------


def test_a_masked_number_hides_the_middle_and_is_not_the_real_thing() -> None:
    masked = INSTITUTION.masked_phone()
    assert masked != INSTITUTION.phone_e164
    assert INSTITUTION.phone_e164 not in masked
    assert masked.endswith(INSTITUTION.phone_e164[-3:])
    assert masked.count("*") == 6


#: Ofcom's drama block, and the North American 555-01xx block.
FICTIONAL_RANGES = (
    re.compile(r"^\+447700900\d{3}$"),
    re.compile(r"^\+1\d{3}55501\d{2}$"),
)


def test_every_demo_number_comes_from_a_range_reserved_for_fiction() -> None:
    """Nothing in this package can ring a real bereavement team."""
    for institution in registry.INSTITUTIONS:
        number = institution.phone_e164
        assert any(pattern.match(number) for pattern in FICTIONAL_RANGES), number


@pytest.mark.parametrize(
    "leak",
    [
        "Call +44 7700 900161 and ask for the team.",
        "Their number is +447700900161.",
        "Ring 07700900161 instead.",
    ],
)
def test_a_telephone_number_in_the_script_is_refused(leak: str) -> None:
    """A number in the script is a number in every preview and log of it. The
    line being dialled belongs in the call payload."""
    assert "forbidden_phone_number" in violations(leak, ESTATE)


def test_the_script_never_names_the_number_it_is_calling() -> None:
    assert INSTITUTION.phone_e164 not in SCRIPT
    assert "+44" not in SCRIPT
