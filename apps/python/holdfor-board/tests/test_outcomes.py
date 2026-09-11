from __future__ import annotations

import pytest

from holdfor.models import CallKind, ReviewStatus
from holdfor.outcomes import may_redial, review_status_for


@pytest.mark.parametrize(
    "outcome, expected",
    [
        ("COMPLETED", ReviewStatus.NEEDS_REVIEW),
        (None, ReviewStatus.NEEDS_REVIEW),
        ("DECLINED", ReviewStatus.DECLINED),
        ("NO_ANSWER", ReviewStatus.NOT_REACHED),
        ("VOICEMAIL", ReviewStatus.NOT_REACHED),
        ("BUSY", ReviewStatus.NOT_REACHED),
        ("EXPIRED", ReviewStatus.NOT_REACHED),
    ],
)
def test_platform_outcomes_map_to_a_board_status(outcome, expected):
    assert review_status_for(outcome, CallKind.CHECKIN) is expected


def test_a_refusal_is_not_filed_as_an_unanswered_call():
    assert review_status_for("DECLINED", CallKind.CHECKIN) is not review_status_for(
        "NO_ANSWER", CallKind.CHECKIN
    )


def test_an_unrecognised_outcome_reaches_a_human_rather_than_being_dropped():
    assert (
        review_status_for("SOMETHING_NEW", CallKind.CHECKIN)
        is ReviewStatus.NEEDS_REVIEW
    )


def test_a_switchboard_rejecting_us_is_not_the_patient_declining():
    """ADR 0010. DECLINED on the second call is the practice line, never Margaret.

    Filing it as `declined` would put "she does not want these calls" on the board
    about a call she was never on.
    """
    assert review_status_for("DECLINED", CallKind.REBOOKING) is ReviewStatus.NOT_REACHED
    assert review_status_for("DECLINED", CallKind.CHECKIN) is ReviewStatus.DECLINED


@pytest.mark.parametrize("kind", [CallKind.CHECKIN, CallKind.REBOOKING])
def test_an_unknown_outcome_reaches_a_human_on_either_call(kind):
    assert review_status_for("WHAT_IS_THIS", kind) is ReviewStatus.NEEDS_REVIEW


@pytest.mark.parametrize(
    "outcome",
    ["DECLINED", "NO_ANSWER", "VOICEMAIL", "BUSY", "EXPIRED", "COMPLETED", None],
)
def test_nothing_is_ever_redialled(outcome):
    assert may_redial(outcome) is False


def test_a_refusal_is_not_dressed_up_as_a_stop_condition():
    from holdfor.extract import no_answers

    extraction = no_answers()
    assert extraction.stop_condition is False
    assert extraction.stop_reason is None
    assert extraction.feeling is None


def test_every_shipped_fixture_loads(fixtures_dir):
    from holdfor.models import CallRequest
    from holdfor.providers import FakeProvider

    names = sorted(p.name for p in fixtures_dir.glob("*.json"))
    assert names, "no transcript fixtures are present in the checkout"
    provider = FakeProvider(fixtures_dir=fixtures_dir)
    for name in names:
        run_id = provider.place(
            CallRequest(
                to_e164="+447700900001",
                task_text="",
                result_schema={},
                idempotency_key=f"checkin:{name}",
            )
        )
        provider._runs[run_id] = name
        result = provider.poll(run_id)
        assert result.outcome, f"{name} has no outcome"
        assert result.transcript, f"{name} has no turns"
