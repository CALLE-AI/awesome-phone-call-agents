from __future__ import annotations

from dataclasses import replace

import pytest

from fake import scenarios
from ringdown.calls import snapshot_from
from ringdown.escalate import Attempt, place_and_settle, run_ladder
from ringdown.report import unknown_lines
from ringdown.script import attempt_id
from tests.data import ALICE, BEN, CARLA, FAST, LADDER, an_incident


def test_the_on_call_engineer_picks_up_and_the_ladder_stops_at_the_first_rung(
    serving, rest_client
):
    server = serving({ALICE.phone: scenarios.answer_ack(ALICE.name, "alice")})

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "acknowledged"
    assert len(result.attempts) == 1
    assert result.attempts[0].extraction.eta_minutes == 15
    assert len(server.created) == 1


def test_an_expired_ladder_timeout_stops_before_the_next_rung(serving, rest_client):
    server = serving({ALICE.phone: scenarios.no_answer()})
    policy = replace(FAST, ladder_timeout_seconds=0)

    result = run_ladder(rest_client(server), an_incident(policy=policy), LADDER)

    assert result.verdict == "unacknowledged"
    assert len(result.attempts) == 1
    assert len(server.created) == 1


def test_an_ambiguous_yes_without_an_eta_does_not_acknowledge(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.ambiguous_yes(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben", "i can be on it in twenty minutes"),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "acknowledged"
    assert [a.verdict for a in result.attempts] == ["not_acknowledged", "acknowledged"]
    assert result.attempts[0].reason == "no_eta"
    assert result.attempts[1].extraction.eta_minutes == 20


def test_a_number_of_minutes_that_is_not_a_commitment_escalates_instead_of_acknowledging(
    serving, rest_client
):
    stalling = scenarios.answer_ack(
        ALICE.name, "alice", "no idea, the alert has been firing for twenty minutes already"
    )
    server = serving({ALICE.phone: stalling, BEN.phone: scenarios.no_answer(),
                      CARLA.phone: scenarios.no_answer()})

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "unacknowledged"
    assert result.attempts[0].verdict == "not_acknowledged"
    assert result.attempts[0].reason == "no_eta"


def test_a_reconciled_attempt_places_exactly_one_call_and_never_wakes_the_backup(
    serving, rest_client
):
    server = serving(
        {
            ALICE.phone: scenarios.error_after_create(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )
    messages: list[str] = []

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER, log=messages.append)

    assert result.verdict == "acknowledged"
    assert len(result.attempts) == 1
    assert len(server.created) == 1
    assert all(record.recipient_phone == ALICE.phone for record in server.created)
    assert any(message.startswith("Reconciled to call") for message in messages)


def test_an_explicit_decline_cuts_the_ladder(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.declined(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "declined"
    assert len(result.attempts) == 1
    assert len(server.created) == 1


def test_a_create_that_stays_ambiguous_after_one_replay_cuts_the_whole_ladder(
    serving, rest_client
):
    server = serving(
        {
            ALICE.phone: scenarios.error_before_create(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )
    messages: list[str] = []

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER, log=messages.append)

    assert result.verdict == "unknown"
    assert len(result.attempts) == 1
    assert len(server.created) == 0
    assert "A call may be live for this person." in messages


def test_a_call_that_never_settles_is_unknown_not_a_failure(serving, rest_client):
    server = serving({ALICE.phone: scenarios.queued_forever()})

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "unknown"
    assert result.attempts[0].reason == "poll_timeout"
    assert result.attempts[0].call_id is not None


def test_an_injected_voicemail_transcript_changes_nothing_on_the_ladder(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.injected_voicemail(ALICE.name),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "acknowledged"
    assert result.attempts[0].verdict == "not_acknowledged"
    assert result.attempts[0].reason == "voicemail"
    assert result.attempts[1].rung.contact == BEN


def test_a_provider_refusal_moves_down_the_ladder_without_a_replay(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.refused(),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "acknowledged"
    assert result.attempts[0].verdict == "not_acknowledged"
    assert result.attempts[0].reason == "call_not_ready"
    assert result.attempts[0].call_id is None
    assert len(server.created) == 1


def test_the_ladder_runs_out_unacknowledged_when_nobody_commits(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.no_answer(),
            BEN.phone: scenarios.voicemail(BEN.name),
            CARLA.phone: scenarios.low_confidence(CARLA.name),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "unacknowledged"
    assert [a.reason for a in result.attempts] == ["no_answer", "voicemail", "low_confidence"]
    assert len(server.created) == 3


def test_the_call_that_may_be_live_is_the_one_that_decided_not_the_first_placed(
    serving, rest_client
):
    server = serving(
        {
            ALICE.phone: scenarios.no_answer(),
            BEN.phone: scenarios.queued_forever(),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "unknown"
    assert result.attempts[0].call_id is not None
    assert result.live_call_id == result.attempts[1].call_id
    assert f"call {result.attempts[0].call_id} may still be live" not in unknown_lines(result)


def test_the_idempotency_key_is_announced_before_the_request_is_sent(serving, rest_client):
    server = serving({ALICE.phone: scenarios.error_before_create(ALICE.name, "alice")})
    announced: list[tuple[str, str]] = []

    attempt = place_and_settle(
        rest_client(server),
        an_incident(policy=FAST),
        LADDER[0],
        announce=lambda aid, key, _: announced.append((aid, key)),
    )

    assert announced == [(attempt.attempt_id, attempt.key)]


def test_the_idempotency_key_is_printed_before_the_request_is_sent(serving, rest_client):
    server = serving({ALICE.phone: scenarios.error_before_create(ALICE.name, "alice")})
    messages: list[str] = []

    attempt = place_and_settle(
        rest_client(server), an_incident(policy=FAST), LADDER[0], log=messages.append
    )

    assert attempt.verdict == "unknown"
    assert messages[0] == f"idempotency key {attempt.key}"
    assert server.requests == 2


def test_a_call_that_reports_the_wrong_identity_settles_unknown_not_acknowledged():
    incident = an_incident(policy=FAST)
    aid = attempt_id(incident, LADDER[0])

    def settled(phone: str, metadata: dict) -> object:
        return snapshot_from(
            {
                "id": "c1",
                "status": "completed",
                "task_completed": True,
                "metadata": metadata,
                "recipients": [
                    {"phones": [phone], "attempts": [{"phone": phone, "transcript_turns": []}]}
                ],
            }
        )

    class MixedUpRest:
        def __init__(self, snapshot):
            self._snapshot = snapshot

        def create_call(self, payload, key):
            return self._snapshot

        def wait_for_result(self, call_id, timeout, interval):
            return self._snapshot

    wrong_phone = settled(BEN.phone, {"ringdown_attempt_id": aid})
    wrong_attempt = settled(ALICE.phone, {"ringdown_attempt_id": "other-incident/primary/1"})

    for snapshot in (wrong_phone, wrong_attempt):
        attempt = place_and_settle(MixedUpRest(snapshot), incident, LADDER[0])

        assert attempt.verdict == "unknown"
        assert attempt.reason == "call_identity_mismatch"
        assert attempt.call_id == "c1"


def test_a_settled_attempt_without_its_evidence_is_unrepresentable():
    with pytest.raises(ValueError, match="without a snapshot and extraction"):
        Attempt(
            rung=LADDER[0],
            key="rd-test-key",
            attempt_id="inc-1/primary/1",
            verdict="acknowledged",
            reason="committed",
            call_id="c1",
        )
