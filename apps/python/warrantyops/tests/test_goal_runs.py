"""The Goal Runs surface: eight errors mapped, one probe, no promotion.

Goal Runs are conditional (D2): the Calls API is primary until a real
GoalRun payload proves per-attempt transcript turns with speaker labels.
Until then the Goal surface contributes its failure enum — the one contract
the Calls API does not offer — and nothing else. These tests pin the
mapping row by row against the locked table, the GET-truth refinements, the
probe's verdicts on both honest outcomes, and the boundary that transport
codes never become business facts.
"""

from __future__ import annotations

import pytest

from warrantyops.contract import ClaimStatus
from warrantyops.goal_runs import (
    GOAL_ERROR_TRIPLES,
    PUBLISHED_CONCLUSION,
    GoalRunErrorCode,
    goal_error_triple,
    probe_goal_capability,
    resolve_against_get,
)
from warrantyops.outcome import TerminalState, TransportState

CAPABLE_PAYLOAD = {
    "id": "call_synthetic_goal_probe_0001",
    "status": "completed",
    "attempts": [
        {
            "transcript_turns": [
                {"speaker": "bot", "text": "May I ask about the claim?"},
                {"speaker": "user", "text": "It is showing returned."},
            ]
        }
    ],
    "structured_result": {"claim_status": "STATED_RETURNED"},
}


def test_the_enum_carries_exactly_the_eight_documented_codes():
    assert {member.value for member in GoalRunErrorCode} == {
        "call_failed",
        "no_answer",
        "declined",
        "timed_out",
        "canceled",
        "result_invalid",
        "result_unavailable",
        "result_failed",
    }


def test_no_person_is_not_a_platform_code_anywhere():
    """NO_PERSON and Person: yes are derived transcript facts or omitted."""

    assert "NO_PERSON" not in {member.name for member in GoalRunErrorCode}
    assert "Person: yes" not in {member.value for member in GoalRunErrorCode}


@pytest.mark.parametrize(
    "code, transport, terminal",
    [
        ("call_failed", TransportState.FAILED, TerminalState.TRANSPORT_FAILED),
        ("no_answer", TransportState.FAILED, TerminalState.TRANSPORT_FAILED),
        ("declined", TransportState.FAILED, TerminalState.TRANSPORT_FAILED),
        ("timed_out", TransportState.IN_PROGRESS, TerminalState.IN_FLIGHT),
        ("canceled", TransportState.CANCELED, TerminalState.TRANSPORT_FAILED),
        ("result_invalid", TransportState.COMPLETED, TerminalState.RESULT_INVALID),
        (
            "result_unavailable",
            TransportState.COMPLETED,
            TerminalState.RESULT_UNAVAILABLE,
        ),
        ("result_failed", TransportState.COMPLETED, TerminalState.RESULT_UNAVAILABLE),
    ],
)
def test_every_documented_error_names_its_locked_triple(code, transport, terminal):
    triple = goal_error_triple(code)
    assert triple == (transport, terminal, ClaimStatus.UNKNOWN)


def test_the_claim_status_is_unknown_in_every_row():
    """A transport code never grounds a business fact — the whole point."""

    for triple in GOAL_ERROR_TRIPLES.values():
        assert triple[2] is ClaimStatus.UNKNOWN


def test_an_undocumented_code_refuses_rather_than_inventing_a_mapping():
    with pytest.raises(ValueError, match="not a documented GoalRunError"):
        goal_error_triple("call_synthetic_teleported_0000")


# --- GET truth ---------------------------------------------------------------


def test_a_timed_out_run_stays_in_flight_until_get_confirms():
    before = resolve_against_get("timed_out", None)
    assert before == (
        TransportState.IN_PROGRESS,
        TerminalState.IN_FLIGHT,
        ClaimStatus.UNKNOWN,
    )
    in_flight_get = resolve_against_get("timed_out", TransportState.IN_PROGRESS)
    assert in_flight_get == before  # a non-terminal GET resolves nothing
    confirmed = resolve_against_get("timed_out", TransportState.FAILED)
    assert confirmed == (
        TransportState.FAILED,
        TerminalState.TRANSPORT_FAILED,
        ClaimStatus.UNKNOWN,
    )


def test_a_no_answer_records_what_the_get_says():
    default = resolve_against_get("no_answer", TransportState.FAILED)
    assert default[0] is TransportState.FAILED
    completed = resolve_against_get("no_answer", TransportState.COMPLETED)
    assert completed[0] is TransportState.COMPLETED  # GET says so: recorded
    # The terminal and claim stay honest either way.
    assert completed[1] is TerminalState.TRANSPORT_FAILED
    assert completed[2] is ClaimStatus.UNKNOWN


def test_a_get_cannot_flip_a_row_the_table_fixed():
    for code in ("call_failed", "declined", "canceled"):
        triple = resolve_against_get(code, TransportState.COMPLETED)
        assert triple == GOAL_ERROR_TRIPLES[GoalRunErrorCode(code)]


# --- the capability probe -----------------------------------------------------


def test_a_capable_payload_passes_every_probe_check():
    report = probe_goal_capability(CAPABLE_PAYLOAD)
    assert report["capable"] is True
    assert report["conclusion"] == "Goal Runs may be promoted"
    assert [check["ok"] for check in report["checks"]] == [True] * 4


def test_a_result_without_transcripts_is_not_capable():
    """The documented GoalRun surface: structured result, no turns."""

    report = probe_goal_capability(
        {"status": "completed", "structured_result": {"claim_status": "UNKNOWN"}}
    )
    assert report["capable"] is False
    failed = [check["name"] for check in report["checks"] if not check["ok"]]
    assert failed == ["transcript_turns_with_speaker_labels"]
    assert report["conclusion"] == "Goal Runs not proven; Calls API remains primary"


def test_an_unlabeled_speaker_vocabulary_is_not_equivalent():
    payload = {
        "status": "completed",
        "attempts": [
            {
                "transcript_turns": [
                    {"speaker": "agent", "text": "hello"},
                    {"speaker": "human", "text": "returned"},
                ]
            }
        ],
        "structured_result": {"claim_status": "STATED_RETURNED"},
    }
    report = probe_goal_capability(payload)
    assert report["capable"] is False
    transcript = next(
        check
        for check in report["checks"]
        if check["name"] == "transcript_turns_with_speaker_labels"
    )
    assert transcript["ok"] is False
    assert "agent" in transcript["detail"]


def test_bot_turns_alone_cannot_ground_anything():
    payload = {
        "status": "completed",
        "attempts": [
            {"transcript_turns": [{"speaker": "bot", "text": "one-sided"}]}
        ],
        "structured_result": {"claim_status": "STATED_RETURNED"},
    }
    report = probe_goal_capability(payload)
    assert report["capable"] is False


def test_a_keypad_plan_is_only_supported_with_provider_evidence():
    report = probe_goal_capability(CAPABLE_PAYLOAD, keypad_plan_supplied=True)
    assert report["capable"] is False
    keypad = next(
        check for check in report["checks"] if check["name"] == "keypad_plan_supported"
    )
    assert keypad["ok"] is False

    with_evidence = probe_goal_capability(
        CAPABLE_PAYLOAD,
        keypad_plan_supplied=True,
        keypad_evidence={"digits_supported": True},
    )
    assert with_evidence["capable"] is True


def test_the_published_conclusion_is_not_proven():
    """Today's honest state: comparator only, Calls API primary."""

    assert "not proven capable" in PUBLISHED_CONCLUSION
    assert "failure-enum comparator" in PUBLISHED_CONCLUSION
