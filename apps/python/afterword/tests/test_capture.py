"""The grading engine.

Every branch, and the order between them. The order is the design: silence
establishes nothing, a contradiction outranks a referral because dropping the
contradiction is the expensive error, and a captured requirement is only ever
the last thing left. A test that checked grades alone would miss that, so each
case asserts the named reason too -- the reason is what the family reads.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from afterword.calle import DryRunClient
from afterword.capture import capture
from afterword.extract import observations
from afterword.models import (
    CaptureResult,
    DirectDebits,
    Grade,
    Institution,
    Observations,
    PriorCall,
    Reached,
    Requirement,
    Ternary,
)
from afterword.runner import plan_call, run_institution
from tests.builders import (
    POLICY,
    PRIOR,
    RUN_ID,
    make_estate,
    make_institution,
    make_observations,
)

FIXED_NOW = datetime(2026, 9, 9, 10, 15, tzinfo=timezone.utc)


def grade_call(
    observed: Observations,
    institution: Institution | None = None,
    priors: tuple[PriorCall, ...] = (),
) -> CaptureResult:
    return capture(
        estate=make_estate(),
        institution=institution or make_institution(),
        observed=observed,
        run_id=RUN_ID,
        priors=priors,
        call_id="call-live-1",
        now=FIXED_NOW,
    )


# --------------------------------------------------------------------------
# UNREACHED
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "reached",
    [
        Reached.IVR_DEAD_END,
        Reached.VOICEMAIL,
        Reached.NO_ANSWER,
        Reached.QUEUE_ABANDONED,
        Reached.UNKNOWN,
    ],
)
def test_a_call_that_reached_no_person_establishes_nothing(reached: Reached) -> None:
    result = grade_call(make_observations(reached=reached))
    assert result.grade is Grade.UNREACHED
    assert result.reasons == (f"not_reached_{reached.value}",)


def test_an_unreached_call_carries_no_requirement() -> None:
    """A phone menu did not tell anybody what documents it wants, whatever the
    extractor guessed from the hold music."""
    result = grade_call(make_observations(reached=Reached.NO_ANSWER))
    assert result.requirement is None
    assert result.conflicts == ()


def test_unreached_outranks_everything_a_result_might_still_contain() -> None:
    result = grade_call(
        make_observations(
            reached=Reached.IVR_DEAD_END,
            certified_copy_accepted=Ternary.NO,
            executor_only=Ternary.YES,
        )
    )
    assert result.grade is Grade.UNREACHED


# --------------------------------------------------------------------------
# DISPUTED
# --------------------------------------------------------------------------


def test_a_statement_contradicting_the_published_policy_is_disputed() -> None:
    result = grade_call(make_observations(certified_copy_accepted=Ternary.NO))
    assert result.grade is Grade.DISPUTED
    assert result.reasons == ("conflict_certified_copy_accepted",)
    assert len(result.conflicts) == 1
    conflict = result.conflicts[0]
    assert conflict.stated == "no"
    assert conflict.counter == "yes"
    assert POLICY.source in conflict.counter_source


def test_a_statement_contradicting_an_earlier_call_is_disputed() -> None:
    """Two advisers at the same institution, two answers. Neither is preferred."""
    result = grade_call(
        make_observations(),
        institution=make_institution(policy=None),
        priors=(PRIOR,),
    )
    assert result.grade is Grade.DISPUTED
    assert set(result.reasons) == {
        "conflict_documents_needed",
        "conflict_certified_copy_accepted",
    }
    assert all(PRIOR.call_id in c.counter_source for c in result.conflicts)


def test_a_disputed_call_keeps_what_was_actually_said() -> None:
    """The pack shows both answers, so the family can ring back and quote one."""
    result = grade_call(make_observations(certified_copy_accepted=Ternary.NO))
    assert result.requirement is not None
    assert result.requirement.certified_copy_accepted is Ternary.NO


def test_disputed_outranks_referred() -> None:
    """An institution can refuse to talk to us and still have contradicted
    itself on the way. Dropping the contradiction is the expensive error."""
    result = grade_call(
        make_observations(
            certified_copy_accepted=Ternary.NO, executor_only=Ternary.YES
        )
    )
    assert result.grade is Grade.DISPUTED


def test_disputed_outranks_a_missing_field() -> None:
    result = grade_call(
        make_observations(
            certified_copy_accepted=Ternary.NO, direct_debits_action=DirectDebits.UNKNOWN
        )
    )
    assert result.grade is Grade.DISPUTED


def test_reasons_are_deduplicated_and_ordered() -> None:
    """Two sources contradicting the same field is one reason, not two, and the
    conflicts behind it are both kept."""
    result = grade_call(
        make_observations(certified_copy_accepted=Ternary.NO), priors=(PRIOR,)
    )
    assert result.reasons == (
        "conflict_certified_copy_accepted",
        "conflict_documents_needed",
    )
    assert len(result.conflicts) == 2


def test_an_institution_with_nothing_on_file_cannot_be_disputed() -> None:
    """A first call to an institution that publishes nothing has no other side."""
    result = grade_call(
        make_observations(certified_copy_accepted=Ternary.NO),
        institution=make_institution(policy=None),
    )
    assert result.grade is Grade.REQUIREMENTS_CAPTURED
    assert result.conflicts == ()


def test_a_silent_policy_contradicts_nothing() -> None:
    """A published page that does not mention direct debits is not a disagreement."""
    silent = make_institution(
        policy=POLICY.__class__(
            department=POLICY.department,
            documents_needed=POLICY.documents_needed,
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            source="a page that says very little",
        )
    )
    result = grade_call(make_observations(certified_copy_accepted=Ternary.NO), silent)
    assert result.grade is Grade.REQUIREMENTS_CAPTURED


def test_an_unanswered_question_is_a_gap_not_a_contradiction() -> None:
    result = grade_call(make_observations(certified_copy_accepted=Ternary.UNKNOWN))
    assert result.grade is Grade.PARTIAL
    assert result.conflicts == ()


# --------------------------------------------------------------------------
# REFERRED
# --------------------------------------------------------------------------


def test_an_executor_only_institution_is_referred_not_failed() -> None:
    """A correct refusal. The design note says so in as many words."""
    result = grade_call(
        make_observations(
            executor_only=Ternary.YES,
            department_named="",
            documents_named=(),
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            reference_opened="",
        )
    )
    assert result.grade is Grade.REFERRED
    assert result.reasons == ("institution_will_speak_only_to_named_executor",)
    assert result.needs_executor is True


def test_a_referral_that_said_nothing_records_no_requirement() -> None:
    result = grade_call(
        make_observations(
            executor_only=Ternary.YES,
            department_named="",
            documents_named=(),
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            reference_opened="",
        )
    )
    assert result.requirement is None


def test_a_referral_that_named_a_department_keeps_it() -> None:
    """Half an answer is still worth putting in front of the executor."""
    result = grade_call(
        make_observations(
            executor_only=Ternary.YES,
            documents_named=(),
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            reference_opened="",
        )
    )
    assert result.grade is Grade.REFERRED
    assert result.requirement is not None
    assert result.requirement.department == "Bereavement Team"


def test_executor_only_unknown_is_not_a_referral() -> None:
    result = grade_call(make_observations(executor_only=Ternary.UNKNOWN))
    assert result.grade is Grade.REQUIREMENTS_CAPTURED


# --------------------------------------------------------------------------
# PARTIAL
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "override, gap",
    [
        ({"department_named": ""}, "department"),
        ({"department_named": "   "}, "department"),
        ({"documents_named": ()}, "documents_needed"),
        ({"certified_copy_accepted": Ternary.UNKNOWN}, "certified_copy_accepted"),
        ({"direct_debits_action": DirectDebits.UNKNOWN}, "direct_debits_action"),
    ],
)
def test_one_unanswered_question_makes_the_capture_partial(
    override: dict, gap: str
) -> None:
    result = grade_call(make_observations(**override))
    assert result.grade is Grade.PARTIAL
    assert result.reasons[0] == "reached_a_person"
    assert f"unanswered_{gap}" in result.reasons


def test_a_partial_capture_still_records_what_was_said() -> None:
    result = grade_call(make_observations(direct_debits_action=DirectDebits.UNKNOWN))
    assert result.requirement is not None
    assert result.requirement.department == "Bereavement Team"
    assert result.goes_in_pack is False


def test_a_person_who_answered_nothing_at_all_is_still_partial() -> None:
    """Reaching a person is a different fact from reaching an answering machine,
    and the family needs to know the line works."""
    result = grade_call(
        make_observations(
            department_named="",
            documents_named=(),
            certified_copy_accepted=Ternary.UNKNOWN,
            direct_debits_action=DirectDebits.UNKNOWN,
            reference_opened="",
            executor_only=Ternary.NO,
        )
    )
    assert result.grade is Grade.PARTIAL
    assert len(result.reasons) == 5


# --------------------------------------------------------------------------
# REQUIREMENTS_CAPTURED
# --------------------------------------------------------------------------


def test_a_complete_uncontradicted_answer_is_captured() -> None:
    result = grade_call(make_observations())
    assert result.grade is Grade.REQUIREMENTS_CAPTURED
    assert result.reasons == (
        "department_named",
        "documents_named_2",
        "certified_copy_answered",
        "direct_debits_answered",
    )
    assert result.goes_in_pack is True


def test_a_capture_without_a_reference_still_counts() -> None:
    """Most institutions open a case only when the paperwork lands. A family
    cannot chase a reference that does not exist yet."""
    result = grade_call(make_observations(reference_opened=""))
    assert result.grade is Grade.REQUIREMENTS_CAPTURED
    assert result.requirement is not None
    assert result.requirement.reference_opened == ""


def test_a_capture_carries_the_quotes_that_justify_it() -> None:
    result = grade_call(make_observations())
    assert result.evidence_quotes == ("A certified copy is fine.",)


def test_a_capture_records_when_and_which_call_produced_it() -> None:
    result = grade_call(make_observations())
    assert result.captured_at == FIXED_NOW
    assert result.call_id == "call-live-1"
    assert result.run_id == RUN_ID


# --------------------------------------------------------------------------
# The commitment boundary
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "observed",
    [
        make_observations(),
        make_observations(certified_copy_accepted=Ternary.NO),
        make_observations(executor_only=Ternary.YES),
        make_observations(reached=Reached.NO_ANSWER),
    ],
)
def test_no_capture_ever_closes_an_account_or_accepts_terms(
    observed: Observations,
) -> None:
    result = grade_call(observed)
    assert result.closes_account is False
    assert result.accepts_terms is False
    assert result.binding is False


def test_only_a_clean_capture_goes_into_the_pack_unread() -> None:
    for observed, expected in (
        (make_observations(), True),
        (make_observations(certified_copy_accepted=Ternary.NO), False),
        (make_observations(executor_only=Ternary.YES), False),
        (make_observations(direct_debits_action=DirectDebits.UNKNOWN), False),
        (make_observations(reached=Reached.VOICEMAIL), False),
    ):
        assert grade_call(observed).goes_in_pack is expected


def test_grading_is_a_pure_function_of_its_inputs() -> None:
    observed = make_observations(certified_copy_accepted=Ternary.NO)
    first = grade_call(observed)
    second = grade_call(observed)
    assert (first.grade, first.reasons, first.conflicts) == (
        second.grade,
        second.reasons,
        second.conflicts,
    )


def test_the_requirement_reports_its_own_gaps() -> None:
    assert Requirement().missing == (
        "department",
        "documents_needed",
        "certified_copy_accepted",
        "direct_debits_action",
    )
    assert Requirement().empty is True
    assert make_observations().as_requirement().complete is True


# --------------------------------------------------------------------------
# The no-call default
# --------------------------------------------------------------------------


def test_a_dry_run_places_no_call_and_establishes_nothing() -> None:
    """The default transport dials nobody, so the default result has to be
    UNREACHED rather than a silently empty requirement."""
    client = DryRunClient()
    plan, result = run_institution(make_estate(), make_institution(), client=client)
    assert client.last_payload is not None
    assert client.last_payload["recipients"] == [
        {"phones": [plan.institution.phone_e164]}
    ]
    assert client.last_idempotency_key == plan.idempotency_key
    assert result.grade is Grade.UNREACHED
    assert result.reasons == ("not_reached_unknown",)


def test_the_idempotency_key_is_derived_from_the_estate_and_institution() -> None:
    """Not from the attempt, so a retry cannot ring a bereavement team twice."""
    estate, institution = make_estate(), make_institution()
    first = plan_call(estate, institution)
    second = plan_call(estate, institution)
    assert first.idempotency_key == second.idempotency_key
    assert estate.estate_id in first.idempotency_key
    assert institution.institution_id in first.idempotency_key


def test_a_null_structured_result_reads_as_unknown_and_not_as_no() -> None:
    """CALL-E returns null when it could not produce a schema-valid result. An
    absent field must never read as the institution saying no."""
    observed = observations({"id": "c", "status": "completed", "structured_result": None})
    assert observed.reached is Reached.UNKNOWN
    assert observed.certified_copy_accepted is Ternary.UNKNOWN
    assert observed.direct_debits_action is DirectDebits.UNKNOWN
    assert observed.documents_named == ()


def test_an_unrecognised_value_reads_as_unknown() -> None:
    observed = observations(
        {
            "structured_result": {
                "reached": "put through to a person maybe",
                "certified_copy_accepted": "probably",
                "direct_debits_action": "we will see",
                "documents_named": "not a list",
            }
        }
    )
    assert observed.reached is Reached.UNKNOWN
    assert observed.certified_copy_accepted is Ternary.UNKNOWN
    assert observed.direct_debits_action is DirectDebits.UNKNOWN
    assert observed.documents_named == ()
