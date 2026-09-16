from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from ringdown.calls import snapshot_from
from ringdown.escalate import LadderResult
from ringdown.incident import Policy
from ringdown.report import (
    INJECTION_NOTE,
    UNKNOWN_ADVICE,
    attempt_header,
    attempt_lines,
    header_lines,
    ladder_lines,
    ledger_lines,
    local_time,
    progress_line,
    reason_prose,
    unknown_lines,
    verdict_lines,
)
from tests.data import ALICE, EXTRACTION, LADDER, an_attempt, an_incident

POLICY = Policy()

ANSWERED = snapshot_from(
    {
        "id": "call_fake1",
        "status": "completed",
        "completion_confidence": {"label": "HIGH", "score": 0.9},
    }
)


def test_the_ladder_shows_each_person_their_own_clock():
    moment = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)

    lines = ladder_lines(LADDER, moment)

    assert "Alice Okafor" in lines[1] and lines[1].endswith("08:00 local")
    assert "Ben Mensah" in lines[2] and lines[2].endswith("13:00 local")
    assert "Carla Varga" in lines[3] and lines[3].endswith("14:00 local")


def test_the_local_clock_follows_daylight_saving_and_not_a_fixed_offset():
    rung = LADDER[0]

    assert local_time(rung, datetime(2026, 1, 9, 12, 0, tzinfo=UTC)) == "07:00"
    assert local_time(rung, datetime(2026, 8, 9, 12, 0, tzinfo=UTC)) == "08:00"


def test_the_header_names_the_incident_and_carries_the_whole_ladder():
    incident = an_incident()
    moment = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)

    lines = header_lines(incident, LADDER, moment)

    assert lines == [
        f"incident {incident.id}  {incident.severity}  {incident.service}",
        f"  {incident.title}",
        "",
        *ladder_lines(LADDER, moment),
        "",
    ]


def test_the_attempt_header_masks_the_number_it_is_about_to_dial():
    assert attempt_header(2, 3, LADDER[1]) == "[2/3] secondary  Ben Mensah  +1********01"


def test_progress_lines_are_indented_under_the_attempt_they_belong_to():
    assert progress_line("call placed") == "      call placed"


@pytest.mark.parametrize(
    "reason,prose",
    [
        ("no_answer", ("nobody picked up",)),
        ("voicemail", ("a recording is not a person",)),
        (
            "hedged_acknowledgement",
            (
                "the words that would have taken the incident came with a condition attached,",
                "and a commitment with a condition is not a commitment",
            ),
        ),
        (
            "no_eta",
            (
                "the call completed and the provider was confident,",
                "and no number of minutes was committed to when asked",
            ),
        ),
        (
            "zero_duration",
            (
                "the attempt began and ended in the same second with nothing transcribed,",
                "which is the shape of a call that never reached the network. The provider",
                "reports it as the recipient hanging up; from here that cannot be told apart",
            ),
        ),
        ("a_reason_added_later", ()),
    ],
)
def test_each_reason_a_call_can_fail_for_is_spelled_out_in_prose(reason, prose):
    assert reason_prose(an_attempt(reason=reason), POLICY) == prose


def test_the_low_confidence_reason_quotes_the_score_against_the_floor_it_missed():
    snapshot = replace(ANSWERED, confidence_label="low", confidence_score=0.3)

    prose = reason_prose(an_attempt(reason="low_confidence", snapshot=snapshot), POLICY)

    assert prose == (f"label low carried a score of 0.3, below the {POLICY.min_confidence} floor",)


def test_a_request_to_be_called_back_is_not_read_as_taking_the_incident():
    extraction = replace(EXTRACTION, callback_minutes=10)

    prose = reason_prose(an_attempt(reason="callback_requested", extraction=extraction), POLICY)

    assert prose == (
        "asked to be called back in 10 minutes,",
        "which is a request to be called again, not a commitment to the incident",
    )


def test_an_acknowledged_attempt_quotes_the_words_that_earned_each_recorded_field():
    attempt = an_attempt(verdict="acknowledged", reason="", snapshot=ANSWERED)

    lines = attempt_lines(attempt, POLICY)

    assert lines == [
        progress_line("call call_fake1  status completed  confidence 0.9 high"),
        progress_line(f"acknowledged  owner {ALICE.name}  eta {EXTRACTION.eta_minutes} minutes"),
        f'        disposition  "{EXTRACTION.disposition_span}"',
        f'        owner        "{EXTRACTION.owner_span}"',
        f'        eta          "{EXTRACTION.eta_span}"',
    ]


def test_an_injected_transcript_is_reported_as_evidence_and_not_followed():
    plain = attempt_lines(an_attempt(), POLICY)

    flagged = attempt_lines(an_attempt(instructed=True), POLICY)

    assert flagged == plain + [progress_line(note) for note in INJECTION_NOTE]


def test_the_verdict_line_names_who_took_it_and_the_eta_they_committed_to():
    result = LadderResult("acknowledged", (an_attempt(verdict="acknowledged", reason=""),))

    assert verdict_lines(result) == [
        f"verdict acknowledged  owner {ALICE.id}  eta {EXTRACTION.eta_minutes} minutes"
    ]


def test_a_call_that_may_still_be_live_is_named_so_it_can_be_reconciled_by_hand():
    result = LadderResult("unknown", (an_attempt(verdict="unknown", reason="ambiguous_create"),))

    assert unknown_lines(result) == ["call call_fake1 may still be live", UNKNOWN_ADVICE]


def test_the_ledger_line_abbreviates_the_head_and_counts_the_calls_actually_placed():
    unplaced = an_attempt(verdict="unknown", reason="refused", call_id=None, snapshot=None)
    placed = LadderResult("acknowledged", (an_attempt(), unplaced))

    assert ledger_lines(4, "sha256:abcdef0123456789", placed) == [
        "ledger 4 records  head sha256:abcd…  calls placed 1"
    ]
    assert ledger_lines(0, "", LadderResult("unknown", ())) == [
        "ledger 0 records  head none  calls placed 0"
    ]
