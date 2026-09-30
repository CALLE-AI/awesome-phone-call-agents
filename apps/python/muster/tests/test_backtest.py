"""The two cases, and the schedule modelled against them.

This is a model of a schedule, not a measurement of a scheme, and the tests are
written to keep that distinction visible. The arithmetic is checked against
`cadence` and `ladder` rather than against a copied number, so that changing an
interval changes the claim instead of breaking a magic constant.

Both cases carry a citation and a note because they are cited facts. A figure
without a source in this file would be an estimate dressed up as evidence.
"""

from __future__ import annotations

import pytest

from muster import cadence, ladder
from muster.backtest import CASES, Case, Modelled, model, model_all
from muster.models import Grade


def default_modelled_days() -> int:
    """What the schedule in `cadence` plus the ladder in `ladder` come to."""
    return cadence.worst_case_detection_days(ladder.days_to_human())


# --------------------------------------------------------------------------
# The cases are cited, not estimated
# --------------------------------------------------------------------------


def test_there_are_two_cases_and_they_are_distinct() -> None:
    assert len(CASES) == 2
    assert len({case.key for case in CASES}) == 2


@pytest.mark.parametrize("case", CASES, ids=[c.key for c in CASES])
def test_every_case_carries_a_citation_and_a_note(case: Case) -> None:
    """A number in a pitch deck needs a source next to it or it is a guess.

    The citation says where the figure comes from; the note says what the source
    actually recorded, in its own terms.
    """
    assert isinstance(case, Case)
    assert case.citation.strip()
    assert case.note.strip()
    assert len(case.note) > 40, "a note this short is a label, not a source"


@pytest.mark.parametrize("case", CASES, ids=[c.key for c in CASES])
def test_every_case_names_the_years_and_a_span_in_days(case: Case) -> None:
    assert case.title.strip()
    assert case.died.strip()
    assert case.detected.strip()
    assert case.actual_days > 0
    assert int(case.detected) > int(case.died)


def test_the_cases_are_the_two_the_documentation_argues_from() -> None:
    """Suchowolski is the fraud case, Kato is the failure-to-check case. They
    are different failures and the argument needs both."""
    keys = {case.key for case in CASES}
    assert keys == {"suchowolski", "kato"}


def test_the_kato_note_records_the_scale_of_the_audit_that_followed() -> None:
    """The 234,354 unconfirmed centenarians are the reason this is a systems
    problem and not one household's crime."""
    kato = next(case for case in CASES if case.key == "kato")
    assert "234,354" in kato.note


# --------------------------------------------------------------------------
# The model
# --------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=[c.key for c in CASES])
def test_modelled_days_is_the_interval_plus_the_ladder(case: Case) -> None:
    """The whole model, stated as arithmetic: one full cycle can pass before the
    next attempt, and then the ladder has to climb to a person."""
    modelled = model(case)
    assert modelled.interval_days == cadence.INTERVAL_DAYS[Grade.CONFIRMED_LIVE]
    assert modelled.ladder_days == ladder.days_to_human()
    assert modelled.modelled_days == modelled.interval_days + modelled.ladder_days
    assert modelled.modelled_days == default_modelled_days()


@pytest.mark.parametrize("case", CASES, ids=[c.key for c in CASES])
def test_the_model_keeps_the_case_and_its_actual_span(case: Case) -> None:
    modelled = model(case)
    assert isinstance(modelled, Modelled)
    assert modelled.case is case
    assert modelled.actual_days == case.actual_days


def test_a_scheme_can_model_its_own_interval() -> None:
    """An annual attestation cycle is the status quo this argues against, so the
    model has to be able to express it."""
    annual = model(CASES[0], interval_days=365)
    assert annual.interval_days == 365
    assert annual.modelled_days == 365 + ladder.days_to_human()


def test_model_all_covers_every_case() -> None:
    results = model_all()
    assert len(results) == len(CASES)
    assert tuple(m.case for m in results) == CASES
    for modelled in results:
        assert modelled.modelled_days == default_modelled_days()


def test_model_all_passes_the_chosen_interval_through() -> None:
    results = model_all(interval_days=90)
    assert all(m.interval_days == 90 for m in results)
    assert all(m.modelled_days == 90 + ladder.days_to_human() for m in results)


# --------------------------------------------------------------------------
# The reduction
# --------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=[c.key for c in CASES])
def test_reduction_factor_is_actual_over_modelled(case: Case) -> None:
    modelled = model(case)
    assert modelled.reduction_factor == pytest.approx(
        modelled.actual_days / modelled.modelled_days
    )


@pytest.mark.parametrize("case", CASES, ids=[c.key for c in CASES])
def test_the_modelled_span_is_dramatically_shorter_than_what_happened(case: Case) -> None:
    """Decades against weeks. The point is not that the check is clever, it is
    that the check happens at all: neither of these people was ever asked."""
    modelled = model(case)
    assert modelled.modelled_days < modelled.actual_days
    assert modelled.modelled_days < 60
    assert modelled.actual_days > 9000
    assert modelled.reduction_factor > 100


def test_a_zero_length_model_reports_no_reduction_rather_than_dividing_by_zero() -> None:
    """Guard against a nonsense schedule producing an infinite headline."""
    impossible = Modelled(
        case=CASES[0], interval_days=0, ladder_days=0, modelled_days=0, actual_days=9125
    )
    assert impossible.reduction_factor == 0.0
