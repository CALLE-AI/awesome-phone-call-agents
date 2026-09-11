"""Reading a death register in both directions.

Death data is used aggressively to stop paying people and lazily to start
paying them again. So the interesting case here is not the fraudster: it is the
person the register has wrongly recorded as dead, who answers the phone and
passes a challenge minted seconds earlier. Muster calls that a contradiction
and hands the correction to the register.

Every combination of register status and grade is swept below, and the sweep
carries the invariant that matters: no reconciliation, on any input, stops a
payment. Not even a register entry.
"""

from __future__ import annotations

import itertools
from datetime import date, datetime, timezone

import pytest

from muster.models import Attestation, Grade
from muster.register import (
    Reconciled,
    Reconciliation,
    RegisterEntry,
    RegisterStatus,
    reconcile,
)

FIXED_NOW = datetime(2026, 9, 8, 9, 30, tzinfo=timezone.utc)

#: Grades that, set against a recorded death, do not argue with it.
DOES_NOT_CONTRADICT: tuple[Grade, ...] = (
    Grade.CONTRA,
    Grade.THIRD_PARTY_CLAIM,
    Grade.UNPROVEN,
)

#: Grades that neither confirm life nor line up with the register.
NEITHER_WAY: tuple[Grade, ...] = (
    Grade.PRESUMED_LIVE_WEAK,
    Grade.NEEDS_HUMAN,
)


def attested(grade: Grade) -> Attestation:
    """An attestation cut down to what reconciliation reads: the grade.

    Built directly rather than graded from a fabricated call, because the
    register never sees the call, only its verdict.
    """
    return Attestation(
        subject_id="subj-0001",
        run_id="run-0001",
        graded_at=FIXED_NOW,
        grade=grade,
        reasons=("fixture",),
    )


def entry_for(status: RegisterStatus) -> RegisterEntry:
    return RegisterEntry(
        subject_id="subj-0001",
        status=status,
        recorded_on=date(2026, 3, 1),
    )


ENTRIES: tuple[RegisterEntry | None, ...] = (
    None,
    *(entry_for(status) for status in RegisterStatus),
)


# --------------------------------------------------------------------------
# The wrongly-declared-dead person
# --------------------------------------------------------------------------


def test_a_register_death_against_a_live_pass_is_a_contradiction() -> None:
    """The person the register killed off. They answered, identified themselves
    and repeated three words minted seconds earlier. The register is wrong, and
    saying so is the whole point of reading it in both directions."""
    result = reconcile(attested(Grade.CONFIRMED_LIVE), entry_for(RegisterStatus.DECEASED))
    assert result.outcome is Reconciliation.REGISTER_CONTRADICTED
    assert result.opens_correction_case is True


def test_the_contradiction_names_who_owns_the_correction() -> None:
    """A person with no channel to argue is the failure mode here, so the
    reasons a caseworker reads must put the work on the register, not on them."""
    result = reconcile(attested(Grade.CONFIRMED_LIVE), entry_for(RegisterStatus.DECEASED))
    assert result.reasons == (
        "register_records_death",
        "live_challenge_passed_after_that_date",
        "correction_belongs_to_the_register_not_the_person",
    )


def test_a_correction_case_is_opened_for_nothing_else() -> None:
    """Only a live pass may open one. A weak call must not put a living person
    through a correction process on a guess."""
    for entry, grade in itertools.product(ENTRIES, Grade):
        result = reconcile(attested(grade), entry)
        expected = (
            entry is not None
            and entry.status is RegisterStatus.DECEASED
            and grade is Grade.CONFIRMED_LIVE
        )
        assert result.opens_correction_case is expected


# --------------------------------------------------------------------------
# The register says deceased
# --------------------------------------------------------------------------


@pytest.mark.parametrize("grade", DOES_NOT_CONTRADICT)
def test_a_call_that_did_not_contradict_a_recorded_death_says_so(grade: Grade) -> None:
    """Supporting the register is not agreeing with it. The reason names the
    grade so a caseworker can see how thin the support is."""
    result = reconcile(attested(grade), entry_for(RegisterStatus.DECEASED))
    assert result.outcome is Reconciliation.CALL_SUPPORTS_REGISTER
    assert result.reasons == (
        "register_records_death",
        f"call_did_not_contradict_{grade.value.lower()}",
    )
    assert result.opens_correction_case is False


@pytest.mark.parametrize("grade", NEITHER_WAY)
def test_a_recorded_death_with_an_inconclusive_call_is_uncorroborated(grade: Grade) -> None:
    """A weak pass and a human referral both leave the register unchecked, which
    is a different thing from supporting it."""
    result = reconcile(attested(grade), entry_for(RegisterStatus.DECEASED))
    assert result.outcome is Reconciliation.REGISTER_UNCORROBORATED
    assert result.reasons == (
        "register_records_death",
        "call_neither_confirmed_nor_contradicted",
    )


def test_no_reconciliation_concludes_that_anybody_has_died() -> None:
    """The register asserts a death. Muster reports what the register says and
    what the call found, and never adds a verdict of its own to the pile.

    Checked over the vocabulary rather than one call, because a new outcome
    named `CONFIRMED_DECEASED` is exactly the change this file exists to stop.
    """
    for outcome in Reconciliation:
        lowered = f"{outcome.name} {outcome.value}".lower()
        for word in ("dead", "deceased", "died", "expired"):
            assert word not in lowered
    for grade in Grade:
        result = reconcile(attested(grade), entry_for(RegisterStatus.DECEASED))
        assert result.outcome in set(Reconciliation)


# --------------------------------------------------------------------------
# The register says alive
# --------------------------------------------------------------------------


def test_an_alive_register_and_a_live_pass_agree() -> None:
    result = reconcile(attested(Grade.CONFIRMED_LIVE), entry_for(RegisterStatus.ALIVE))
    assert result.outcome is Reconciliation.AGREED_ALIVE
    assert result.reasons == ("register_alive_call_confirmed",)


@pytest.mark.parametrize("grade", [g for g in Grade if g is not Grade.CONFIRMED_LIVE])
def test_an_alive_register_plus_an_inconclusive_call_is_no_signal(grade: Grade) -> None:
    """The register saying alive is not evidence: it is the absence of a death
    record. It cannot upgrade a call that established nothing."""
    result = reconcile(attested(grade), entry_for(RegisterStatus.ALIVE))
    assert result.outcome is Reconciliation.NO_SIGNAL
    assert result.reasons == ("register_alive_call_inconclusive",)


# --------------------------------------------------------------------------
# The register says nothing
# --------------------------------------------------------------------------


@pytest.mark.parametrize("entry", [None, entry_for(RegisterStatus.UNKNOWN)])
def test_a_silent_register_leaves_the_call_to_speak_for_itself(
    entry: RegisterEntry | None,
) -> None:
    """No entry and an explicitly unknown entry are the same fact: the register
    has nothing to say."""
    confirmed = reconcile(attested(Grade.CONFIRMED_LIVE), entry)
    assert confirmed.outcome is Reconciliation.AGREED_ALIVE
    assert confirmed.reasons == ("register_silent_call_confirmed",)

    weak = reconcile(attested(Grade.UNPROVEN), entry)
    assert weak.outcome is Reconciliation.NO_SIGNAL
    assert weak.reasons == ("register_silent_call_inconclusive",)


@pytest.mark.parametrize("grade", [g for g in Grade if g is not Grade.CONFIRMED_LIVE])
def test_a_missing_entry_never_manufactures_a_signal(grade: Grade) -> None:
    assert reconcile(attested(grade), None).outcome is Reconciliation.NO_SIGNAL


def test_a_missing_entry_and_an_unknown_entry_reconcile_identically() -> None:
    """If these ever diverge, one of them is being read as evidence."""
    for grade in Grade:
        assert reconcile(attested(grade), None) == reconcile(
            attested(grade), entry_for(RegisterStatus.UNKNOWN)
        )


# --------------------------------------------------------------------------
# The whole cross-product
# --------------------------------------------------------------------------


def test_every_status_and_grade_combination_reconciles() -> None:
    """No combination falls through to an exception or a None outcome."""
    combinations = list(itertools.product(ENTRIES, Grade))
    assert len(combinations) == (len(RegisterStatus) + 1) * len(Grade)
    for entry, grade in combinations:
        result = reconcile(attested(grade), entry)
        assert isinstance(result, Reconciled)
        assert result.outcome in set(Reconciliation)
        assert result.reasons
        assert all(isinstance(r, str) and r.strip() for r in result.reasons)


def test_no_reconciliation_ever_stops_a_payment() -> None:
    """The invariant, swept over every combination there is.

    One more month of overpayment is a cheaper error than cutting off a
    pensioner's only income on the word of a register that has already been
    shown, in this very module, to be capable of being wrong about them.
    """
    for entry, grade in itertools.product(ENTRIES, Grade):
        assert reconcile(attested(grade), entry).stops_payment is False


def test_stops_payment_is_false_even_if_somebody_constructs_it_by_hand() -> None:
    """The property is not a field, so it cannot be set to True by a caller who
    builds a Reconciled directly."""
    for outcome in Reconciliation:
        assert Reconciled(outcome, ("fixture",), opens_correction_case=True).stops_payment is False


def test_a_register_entry_records_where_it_came_from() -> None:
    """Provenance, because the register is treated as a claim and a claim needs
    a claimant."""
    entry = entry_for(RegisterStatus.DECEASED)
    assert entry.source.strip()
    assert entry.recorded_on == date(2026, 3, 1)
