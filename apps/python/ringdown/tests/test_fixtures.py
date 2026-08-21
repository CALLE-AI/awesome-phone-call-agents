from __future__ import annotations

import json
from pathlib import Path

import pytest

from ringdown.calle import CalleError, _call_run
from ringdown.calls import run_from, snapshot_from
from ringdown.extract import extract, normalise, recipient_turns

FIXTURES = Path(__file__).resolve().parent / "fixtures"
DOCUMENTED = sorted(FIXTURES.glob("*.json"))


def payload_of(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())["payload"]


@pytest.mark.parametrize("path", DOCUMENTED, ids=lambda path: path.stem)
def test_every_captured_response_says_where_it_came_from_and_what_it_does_not_prove(path):
    fixture = json.loads(path.read_text())

    assert set(fixture) == {"what", "source", "unobserved", "why_it_matters", "payload"}
    assert "observed" in fixture["source"]


def test_the_parser_does_not_mistake_the_providers_missing_run_for_a_run():
    run = run_from(payload_of("mcp-get-call-run-missing.json"))

    assert not run.readable
    assert run.turns == ()


def test_a_run_that_carries_a_call_id_is_readable():
    assert run_from({"call_id": "call_abc", "status": "COMPLETED"}).readable


def test_a_null_the_provider_sent_is_not_read_as_the_word_none():
    run = run_from({"call_id": None, "status": None})

    assert not run.readable
    assert (run.call_id, run.status) == ("", "")


def test_the_tool_rejects_the_argument_name_ringdown_used_to_send():
    payload = payload_of("mcp-get-call-run-rejects-a-call-id.json")

    assert "error" not in payload

    with pytest.raises(CalleError) as raised:
        _call_run(payload["result"])

    assert raised.value.code == "mcp_tool_error"
    assert not raised.value.retriable
    assert "run_id" in raised.value.message and "Missing required argument" in raised.value.message
    assert "call_id" in raised.value.message


def test_a_real_completed_run_is_not_readable_by_the_parser_that_was_written_for_it():
    payload = payload_of("mcp-get-call-run-completed.json")

    assert payload["result"]["call_id"]

    run = run_from(payload)

    assert not run.readable
    assert run.turns == ()


def test_the_live_rest_body_echoes_the_metadata_the_attempt_identity_check_needs():
    payload = payload_of("rest-call-declined-without-dialling.json")
    snapshot = snapshot_from(payload)

    assert snapshot.metadata["ringdown_attempt_id"] == "inc-2026-08-19-0001/primary/1"
    assert snapshot.recipient_phone == "+15550101234"
    assert snapshot.status == "failed"


def test_a_call_the_carrier_never_saw_is_reported_as_a_recipient_who_hung_up():
    payload = payload_of("rest-call-declined-without-dialling.json")
    attempt = payload["recipients"][0]["attempts"][0]
    snapshot = snapshot_from(payload)

    assert attempt["started_at"] == attempt["completed_at"]
    assert "Hangup by: user" in payload["failure_message"]
    assert (snapshot.failure_code, snapshot.turns) == ("call_failed", ())


def test_the_provider_reported_an_acknowledgement_the_transcript_does_not_carry():
    payload = payload_of("rest-call-completed-without-an-acknowledgement.json")
    snapshot = snapshot_from(payload)

    assert snapshot.status == "completed"
    assert snapshot.task_completed is True
    assert (snapshot.confidence_score, snapshot.confidence_label) == (0.86, "high")
    assert any("acknowledged taking the incident" in line for line in payload["evidence"])

    spoken = " ".join(normalise(turn.text) for turn in recipient_turns(snapshot.turns))
    extraction = extract(snapshot.turns)

    assert "banking this incident" in spoken
    assert extraction.disposition == "unclear"
    assert extraction.eta_minutes == 15
