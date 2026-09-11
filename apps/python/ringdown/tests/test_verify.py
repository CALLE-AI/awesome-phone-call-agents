from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

from fake import scenarios
from ringdown.escalate import LadderResult, run_ladder
from ringdown.checks import all_checks, all_ok, contradicted, passed, render_blocks, unresolved
from ringdown.verify import ACK_HOLDS, NO_ACK, SAME_RUN, verify_ladder
from tests.data import ALICE, BEN, CARLA, FAST, LADDER, an_incident

INC = an_incident().id


def wide_window() -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    return (now - timedelta(seconds=60), now + timedelta(seconds=60))


def settle(serving, rest_client, by_phone):
    server = serving(by_phone)
    result = run_ladder(rest_client(server), an_incident(policy=FAST), LADDER)
    return server, result


def test_a_clean_acknowledgement_verifies_ten_out_of_ten_on_the_second_channel(
    serving, rest_client, mcp_client
):
    server, result = settle(serving, rest_client, {ALICE.phone: scenarios.answer_ack(ALICE.name, "alice")})

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    assert [title for title, _ in blocks] == [
        f"Verification of {INC} attempt 1 (a.okafor) on the second channel: {SAME_RUN}",
        f"Verification of {INC} attempt 1 (a.okafor) on the second channel: {ACK_HOLDS}",
    ]
    checks = all_checks(blocks)
    assert (len(blocks[0][1]), len(blocks[1][1])) == (6, 4)
    assert all_ok(checks)
    call_id = result.attempts[0].call_id
    assert checks[0][1] == f"second channel returned a run for call {call_id}"
    assert checks[2][1] == f"run echoes the attempt id {INC}/primary/1 we sent"
    assert checks[4][1] == "run status COMPLETED maps to the recorded completed"
    assert checks[9][1] == "the recorded ETA of 15 minutes is spoken by the recipient"
    assert "verified 10/10" in render_blocks(blocks)


def test_the_channel_mismatch_scenario_fails_six_of_ten_checks(serving, rest_client, mcp_client):
    server, result = settle(
        serving, rest_client, {ALICE.phone: scenarios.channel_mismatch(ALICE.name, "alice")}
    )

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    checks = all_checks(blocks)
    assert [ok for ok, _ in checks] == [True] * 6 + [False] * 4
    assert not all_ok(checks)
    assert "verified 6/10" in render_blocks(blocks)


def test_a_run_the_second_channel_cannot_see_is_unresolved_not_a_contradiction(
    serving, rest_client, mcp_client
):
    server, result = settle(
        serving, rest_client, {ALICE.phone: scenarios.unseen_on_second_channel(ALICE.name, "alice")}
    )

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    checks = all_checks(blocks)
    call_id = result.attempts[0].call_id
    assert checks == [(None, f"second channel returned a run for call {call_id} (no_call_run)")]
    assert not all_ok(checks)
    assert contradicted(checks) == 0
    assert unresolved(checks) == 1


def test_an_acknowledgement_the_run_escalated_past_is_caught_on_the_second_channel(
    serving, rest_client, mcp_client
):
    committed_on_mcp = replace(
        scenarios.ambiguous_yes(ALICE.name, "alice"),
        mcp_overrides={"transcript_turns": scenarios.answer_ack(ALICE.name, "alice").turns},
    )
    server, result = settle(
        serving,
        rest_client,
        {ALICE.phone: committed_on_mcp, BEN.phone: scenarios.answer_ack(BEN.name, "ben")},
    )

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    assert result.verdict == "acknowledged"
    assert [title.rsplit(": ", 1)[1] for title, _ in blocks] == [NO_ACK, SAME_RUN, ACK_HOLDS]
    assert blocks[0][1] == [(False, "run for Alice Okafor reports no acknowledgement")]
    assert all_ok(all_checks(blocks[1:]))
    assert not all_ok(all_checks(blocks))


def test_a_declined_attempt_verifies_that_no_acknowledgement_was_recorded(
    serving, rest_client, mcp_client
):
    server, result = settle(
        serving, rest_client, {ALICE.phone: scenarios.declined(ALICE.name, "alice")}
    )

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    assert len(blocks) == 1
    assert blocks[0][1] == [(True, "run for Alice Okafor reports no acknowledgement")]
    assert all_ok(all_checks(blocks))


def test_every_non_acknowledged_attempt_gets_its_own_no_ack_block(
    serving, rest_client, mcp_client
):
    server, result = settle(
        serving,
        rest_client,
        {
            ALICE.phone: scenarios.no_answer(),
            BEN.phone: scenarios.voicemail(BEN.name),
            CARLA.phone: scenarios.low_confidence(CARLA.name),
        },
    )

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    assert len(blocks) == 3
    assert all_ok(all_checks(blocks))
    assert "verified 3/3" in render_blocks(blocks)


def test_a_ladder_result_with_no_attempts_is_never_reported_verified():
    blocks = verify_ladder(None, INC, LadderResult("unacknowledged", ()), wide_window())

    assert blocks == []
    assert all_ok(all_checks(blocks)) is False


def test_an_unknown_verdict_attempt_is_not_checked_against_a_possibly_live_call(
    serving, rest_client, mcp_client
):
    server, result = settle(serving, rest_client, {ALICE.phone: scenarios.queued_forever()})

    blocks = verify_ladder(mcp_client(server), INC, result, wide_window())

    assert result.verdict == "unknown"
    assert blocks == []


def test_a_run_that_finished_outside_the_escalation_window_fails_closed(
    serving, rest_client, mcp_client
):
    server, result = settle(serving, rest_client, {ALICE.phone: scenarios.answer_ack(ALICE.name, "alice")})
    past = (datetime.now(UTC) - timedelta(hours=2), datetime.now(UTC) - timedelta(hours=1))

    checks = all_checks(verify_ladder(mcp_client(server), INC, result, past))

    assert checks[5] == (False, "the run finished inside the escalation window")
    assert passed(checks) == 9


def test_an_unparseable_completion_time_fails_closed(serving, rest_client, mcp_client):
    garbled = replace(
        scenarios.answer_ack(ALICE.name, "alice"), mcp_overrides={"completed_at": "not a date"}
    )
    server, result = settle(serving, rest_client, {ALICE.phone: garbled})

    checks = all_checks(verify_ladder(mcp_client(server), INC, result, wide_window()))

    assert checks[5] == (False, "the run finished inside the escalation window")


def test_a_status_word_the_vocabulary_does_not_know_fails_the_mapping_check(
    serving, rest_client, mcp_client
):
    renamed = replace(
        scenarios.answer_ack(ALICE.name, "alice"), mcp_overrides={"status": "SUCCEEDED"}
    )
    server, result = settle(serving, rest_client, {ALICE.phone: renamed})

    checks = all_checks(verify_ladder(mcp_client(server), INC, result, wide_window()))

    assert checks[4] == (False, "run status SUCCEEDED maps to the recorded completed")
    assert passed(checks) == 9
