from __future__ import annotations

from dataclasses import replace

import pytest

from fake import scenarios
from ringdown.calls import snapshot_from
from ringdown.report import verdict_lines
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


def test_a_ladder_settles_on_an_engineer_who_answers_in_spanish(serving, rest_client):
    server = serving({ALICE.phone: scenarios.hedged_yes_es(ALICE.name, "alice"),
                      BEN.phone: scenarios.answer_ack_es(BEN.name, "ben", "dame veinte minutos")})

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "acknowledged"
    assert [a.verdict for a in result.attempts] == ["not_acknowledged", "acknowledged"]
    assert result.attempts[0].reason == "hedged_acknowledgement"
    assert result.attempts[1].extraction.eta_minutes == 20
    assert result.attempts[1].extraction.disposition_span == "sí, lo tomo yo"


def test_a_ladder_the_provider_never_dialled_still_walks_every_rung(serving, rest_client):
    server = serving({ALICE.phone: scenarios.dropped_before_ringing(),
                      BEN.phone: scenarios.dropped_before_ringing(),
                      CARLA.phone: scenarios.dropped_before_ringing()})

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "unacknowledged"
    assert [a.reason for a in result.attempts] == ["zero_duration"] * 3


def test_a_ladder_says_how_many_calls_never_rang_even_when_only_some_did_not(serving, rest_client):
    server = serving({ALICE.phone: scenarios.dropped_before_ringing(),
                      BEN.phone: scenarios.no_answer(),
                      CARLA.phone: scenarios.dropped_before_ringing()})

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert [a.reason for a in result.attempts] == ["zero_duration", "no_answer", "zero_duration"]
    assert "2 of 3 calls ended before they could ring" in "\n".join(verdict_lines(result))


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


def test_a_request_to_be_called_back_returns_to_the_same_person_instead_of_escalating(
    serving, rest_client
):
    server = serving({ALICE.phone: scenarios.asks_for_callback(ALICE.name, "alice")})
    waited: list[float] = []

    result = run_ladder(
        rest_client(server), an_incident(policy=FAST), LADDER, pause=waited.append
    )

    assert result.verdict == "acknowledged"
    assert [a.verdict for a in result.attempts] == ["not_acknowledged", "acknowledged"]
    assert result.attempts[0].reason == "callback_requested"
    assert [a.rung.contact.id for a in result.attempts] == [ALICE.id, ALICE.id]
    assert waited == [600.0]


@pytest.mark.parametrize(
    ("on_call", "dialled"),
    [
        (lambda _: BEN, [ALICE.id, BEN.id]),
        (lambda _: ALICE, [ALICE.id, ALICE.id]),
        (lambda _: None, [ALICE.id, ALICE.id]),
    ],
    ids=["the scope changed hands", "the same shift is still on", "nobody covers the scope"],
)
def test_a_callback_rings_whoever_covers_the_scope_when_the_wait_ends(
    serving, rest_client, on_call, dialled
):
    server = serving(
        {
            ALICE.phone: scenarios.asks_for_callback(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )

    result = run_ladder(
        rest_client(server),
        an_incident(policy=FAST),
        LADDER,
        pause=lambda _: None,
        resolve=on_call,
    )

    assert [a.rung.contact.id for a in result.attempts] == dialled
    assert [a.attempt_id for a in result.attempts] == [
        "inc-2026-08-09-0113/primary/1",
        "inc-2026-08-09-0113/primary/2",
    ]


def test_the_call_back_is_a_second_call_with_its_own_idempotency_key(serving, rest_client):
    server = serving({ALICE.phone: scenarios.asks_for_callback(ALICE.name, "alice")})

    result = run_ladder(
        rest_client(server), an_incident(policy=FAST), LADDER, pause=lambda _: None
    )

    keys = [a.key for a in result.attempts]
    assert len(keys) == len(set(keys))
    assert [a.attempt_id for a in result.attempts] == [
        "inc-2026-08-09-0113/primary/1",
        "inc-2026-08-09-0113/primary/2",
    ]
    assert len(server.created) == 2


def test_more_minutes_than_the_ladder_has_left_escalates_instead_of_waiting(
    serving, rest_client
):
    asking = scenarios.asks_for_callback(
        ALICE.name, "alice", "i can't right now, call me back in 90 minutes"
    )
    server = serving({ALICE.phone: asking, BEN.phone: scenarios.answer_ack(BEN.name, "ben")})
    waited: list[float] = []

    result = run_ladder(
        rest_client(server), an_incident(policy=FAST), LADDER, pause=waited.append
    )

    assert waited == []
    assert result.verdict == "acknowledged"
    assert [a.rung.contact.id for a in result.attempts] == [ALICE.id, BEN.id]
    assert result.attempts[0].reason == "callback_requested"


def test_a_second_request_from_the_same_person_escalates_rather_than_waiting_again(
    serving, rest_client
):
    stalling = scenarios.asks_for_callback(ALICE.name, "alice")
    stalling.on_second_call = scenarios.asks_for_callback(ALICE.name, "alice")
    server = serving({ALICE.phone: stalling, BEN.phone: scenarios.answer_ack(BEN.name, "ben")})
    waited: list[float] = []

    result = run_ladder(
        rest_client(server), an_incident(policy=FAST), LADDER, pause=waited.append
    )

    assert waited == [600.0]
    assert [a.rung.contact.id for a in result.attempts] == [ALICE.id, ALICE.id, BEN.id]
    assert result.verdict == "acknowledged"


def test_a_request_to_be_called_back_that_nobody_spoke_is_not_honoured(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.ambiguous_yes(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )
    waited: list[float] = []

    run_ladder(rest_client(server), an_incident(policy=FAST), LADDER, pause=waited.append)

    assert waited == []


def test_a_commitment_with_a_condition_does_not_stop_the_ladder(serving, rest_client):
    server = serving(
        {
            ALICE.phone: scenarios.hedged_yes(ALICE.name, "alice"),
            BEN.phone: scenarios.answer_ack(BEN.name, "ben"),
        }
    )

    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)

    assert result.verdict == "acknowledged"
    assert [a.rung.contact.id for a in result.attempts] == [ALICE.id, BEN.id]
    assert result.attempts[0].reason == "hedged_acknowledgement"
    assert result.attempts[0].extraction.hedge_span == "i'll take it, but i'm not sure i can get to it"
