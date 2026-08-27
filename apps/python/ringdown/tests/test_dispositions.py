from __future__ import annotations

from dataclasses import replace
from itertools import combinations

import pytest

from fake import scenarios
from fake.calle_server import FakeCalle
from ringdown.calls import CallSnapshot, parse_turns, snapshot_from
from ringdown.dispositions import classify, ground, ground_span
from ringdown.extract import extract
from ringdown.incident import Policy
from tests.data import ALICE

POLICY = Policy()


def snapshot_for(scenario) -> CallSnapshot:
    fake = FakeCalle({ALICE.phone: scenario})
    record, _ = fake.place({"recipients": [{"phones": [ALICE.phone]}], "metadata": {}}, "rd-test-1")
    while not record.settled:
        fake.read(record.id)
    return snapshot_from(fake.rest_view(record))


def parts(snapshot: CallSnapshot):
    extraction = extract(snapshot.turns)
    return snapshot, extraction, ground(extraction, snapshot.turns)


def judge(scenario):
    return classify(*parts(snapshot_for(scenario)), ALICE, POLICY)


def test_a_clean_acknowledgement_with_a_grounded_eta_is_acknowledged():
    judged = judge(scenarios.answer_ack(ALICE.name, "alice"))

    assert judged.verdict == "acknowledged"
    assert judged.reason == ""


def test_an_ambiguous_yes_without_an_eta_does_not_acknowledge():
    judged = judge(scenarios.ambiguous_yes(ALICE.name, "alice"))

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "no_eta"


def test_a_high_label_with_a_low_score_is_not_confident():
    judged = judge(scenarios.low_confidence(ALICE.name))

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "low_confidence"


def test_an_explicit_decline_is_classified_as_declined():
    judged = judge(scenarios.declined(ALICE.name, "alice"))

    assert judged.verdict == "declined"


def test_a_failed_call_keeps_its_failure_code_as_the_reason():
    assert judge(scenarios.no_answer()).reason == "no_answer"
    assert judge(scenarios.voicemail(ALICE.name)).reason == "voicemail"


def test_an_injected_voicemail_instruction_changes_nothing():
    judged = judge(scenarios.injected_voicemail(ALICE.name))

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "voicemail"


def test_a_wrong_person_answer_never_acknowledges():
    judged = judge(scenarios.wrong_person(ALICE.name, "sam"))

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "wrong_person"


def test_an_owner_that_does_not_match_the_dialled_contact_does_not_acknowledge():
    judged = judge(scenarios.answer_ack(ALICE.name, "ben"))

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "owner_not_confirmed"


def test_an_eta_beyond_the_policy_ceiling_is_out_of_range():
    judged = judge(scenarios.answer_ack(ALICE.name, "alice", eta_text="give me 200 minutes"))

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "eta_out_of_range"


def test_a_span_that_matches_only_the_agents_own_turns_is_not_evidence():
    turns = parse_turns(scenarios.answer_ack(ALICE.name, "alice").turns)
    bot_only = tuple(turn for turn in turns if turn.speaker == "bot")

    assert not ground_span("are you taking this incident right now?", bot_only)


def test_a_missing_span_is_never_grounded():
    assert not ground_span("", parse_turns(scenarios.answer_ack(ALICE.name, "alice").turns))


def test_a_provider_confidence_without_a_score_fails_closed():
    scenario = scenarios.answer_ack(ALICE.name, "alice")
    snapshot = replace(snapshot_for(scenario), confidence_score=None)

    judged = classify(*parts(snapshot), ALICE, POLICY)

    assert judged.verdict == "not_acknowledged"
    assert judged.reason == "low_confidence"


BREAKERS = {
    "status": lambda s, e, g: (replace(s, status="failed"), e, g),
    "confidence_score": lambda s, e, g: (replace(s, confidence_score=0.05), e, g),
    "confidence_label": lambda s, e, g: (replace(s, confidence_label="unknown"), e, g),
    "task_completed": lambda s, e, g: (replace(s, task_completed=False), e, g),
    "disposition_unclear": lambda s, e, g: (s, replace(e, disposition="unclear"), g),
    "disposition_declined": lambda s, e, g: (s, replace(e, disposition="declined"), g),
    "disposition_unreachable": lambda s, e, g: (s, replace(e, disposition="unreachable"), g),
    "eta_missing": lambda s, e, g: (s, replace(e, eta_minutes=None), g),
    "eta_out_of_range": lambda s, e, g: (s, replace(e, eta_minutes=999), g),
    "owner_confirmed": lambda s, e, g: (s, replace(e, owner_confirmed="sam"), g),
    "grounded_disposition": lambda s, e, g: (s, e, replace(g, disposition=False)),
    "grounded_eta": lambda s, e, g: (s, e, replace(g, eta=False)),
    "grounded_owner": lambda s, e, g: (s, e, replace(g, owner=False)),
}

BASELINE = parts(snapshot_for(scenarios.answer_ack(ALICE.name, "alice")))


@pytest.mark.parametrize("size", range(1, len(BREAKERS) + 1))
def test_no_combination_of_inputs_acknowledges_unless_every_signal_agrees(size):
    for broken in combinations(sorted(BREAKERS), size):
        signals = BASELINE
        for name in broken:
            signals = BREAKERS[name](*signals)

        assert classify(*signals, ALICE, POLICY).verdict != "acknowledged", broken
