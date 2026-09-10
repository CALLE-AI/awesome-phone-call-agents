"""The offline transports, and the parser they share with the live one."""

from __future__ import annotations

import json

import pytest

from positive_contact.transports.base import (
    NON_TERMINAL_STATUSES,
    TERMINAL_STATUSES,
    TransportError,
    parse_call_task,
)
from positive_contact.transports.fixture import FixtureTransport, ScenarioError
from positive_contact.transports.replay import (
    LIVE_REDACTED,
    SYNTHETIC,
    RecordingError,
    ReplayTransport,
)
from tests.conftest import RECORDED, SCENARIOS


def submit(transport, contact_id="pc-001", step=1, phone="+14155550101", key=None):
    return transport.submit(
        task_text="task",
        phone_e164=phone,
        locale="en-US",
        region="US",
        recipient_result_schema={"type": "object"},
        idempotency_key=key or f"pc:e:{contact_id}:{step}:primary",
        metadata={"pc_contact_id": contact_id, "pc_ladder_step": str(step)},
    )


# -- fixture transport -------------------------------------------------------------


def test_every_scenario_file_loads(fixture_transport):
    assert len(fixture_transport.scenarios) >= 15


def test_a_scripted_step_is_accepted_and_readable(fixture_transport):
    result = submit(fixture_transport)
    assert result.kind == "accepted"
    snapshot = fixture_transport.read(result.call_id)
    assert snapshot.status == "completed"
    assert snapshot.recipient_result["contact_type"] == "live_person"
    assert snapshot.transcript_turns


def test_the_transport_echoes_the_submitted_metadata(fixture_transport):
    result = submit(fixture_transport)
    snapshot = fixture_transport.read(result.call_id)
    assert snapshot.metadata["pc_contact_id"] == "pc-001"
    assert snapshot.metadata["pc_ladder_step"] == "1"


def test_the_transport_echoes_the_dialled_number(fixture_transport):
    result = submit(fixture_transport, phone="+14155550101")
    payload = fixture_transport.raw_payload(result.call_id)
    assert payload["recipients"][0]["phones"] == ["+14155550101"]
    assert payload["recipients"][0]["attempts"][0]["phone"] == "+14155550101"


def test_an_unscripted_step_raises_rather_than_inventing_an_outcome(fixture_transport):
    with pytest.raises(ScenarioError, match="no scripted outcome"):
        submit(fixture_transport, contact_id="pc-001", step=9)


def test_the_unknown_submission_scenario_returns_unknown(fixture_transport):
    result = submit(fixture_transport, contact_id="pc-103", step=1, phone="+14155550123")
    assert result.kind == "unknown"
    assert result.error_code == "provider_unavailable"
    assert result.call_id is None


def test_reading_an_unknown_call_id_raises(fixture_transport):
    with pytest.raises(ScenarioError, match="no call"):
        fixture_transport.read("call_never_placed")


def test_a_duplicate_scenario_step_is_refused(tmp_path):
    for name in ("a.json", "b.json"):
        (tmp_path / name).write_text(
            json.dumps(
                {"contact_id": "pc-dup", "steps": [{"ladder_step": 1, "response": {}}]}
            ),
            encoding="utf-8",
        )
    with pytest.raises(ScenarioError, match="redefines"):
        FixtureTransport(tmp_path)


def test_an_empty_scenario_directory_is_refused(tmp_path):
    with pytest.raises(ScenarioError, match="no scripted steps"):
        FixtureTransport(tmp_path)


def test_every_scenario_payload_parses_as_a_call_task():
    for path in sorted(SCENARIOS.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        for step in document["steps"]:
            response = step.get("response")
            if response is None:
                continue
            snapshot = parse_call_task(response)
            assert snapshot.status in TERMINAL_STATUSES | NON_TERMINAL_STATUSES


def test_scenario_payloads_use_only_fictional_numbers():
    for path in sorted(SCENARIOS.glob("*.json")):
        text = path.read_text(encoding="utf-8")
        import re

        for number in re.findall(r"\+\d{7,15}", text):
            assert number.startswith("+1415555") or number.startswith("+1415•"), number


# -- replay transport --------------------------------------------------------------


def test_replay_loads_the_recorded_payloads():
    transport = ReplayTransport(RECORDED)
    assert len(transport.recordings) >= 3


def test_replay_declares_its_provenance():
    transport = ReplayTransport(RECORDED)
    line = transport.provenance_line()
    assert "replaying" in line
    assert all(source in {LIVE_REDACTED, SYNTHETIC} for source in transport.sources.values())


def test_replay_reports_whether_anything_came_from_a_live_call():
    transport = ReplayTransport(RECORDED)
    assert isinstance(transport.has_live_recordings, bool)


def test_replay_serves_a_payload_through_the_same_interface():
    transport = ReplayTransport(RECORDED)
    result = submit(transport)
    assert result.kind == "accepted"
    snapshot = transport.read(result.call_id)
    assert snapshot.recipient_result is not None
    assert snapshot.metadata["pc_contact_id"] == "pc-001"


def test_a_recording_without_a_declared_source_is_refused(tmp_path):
    (tmp_path / "x.json").write_text(
        json.dumps({"match": {"contact_id": "a", "ladder_step": 1}, "call_task": {}}),
        encoding="utf-8",
    )
    with pytest.raises(RecordingError, match="declare source"):
        ReplayTransport(tmp_path)


def test_a_recording_without_a_match_is_refused(tmp_path):
    (tmp_path / "x.json").write_text(
        json.dumps({"source": SYNTHETIC, "call_task": {}}), encoding="utf-8"
    )
    with pytest.raises(RecordingError, match="match.contact_id"):
        ReplayTransport(tmp_path)


def test_an_empty_recording_directory_is_refused(tmp_path):
    with pytest.raises(RecordingError, match="no recorded payloads"):
        ReplayTransport(tmp_path)


def test_recorded_payloads_carry_no_raw_number():
    from positive_contact.redact import find_raw_e164

    for path in sorted(RECORDED.glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        if document["source"] != LIVE_REDACTED:
            continue
        assert find_raw_e164(json.dumps(document)) == []


# -- the shared parser -------------------------------------------------------------


def test_the_parser_reads_the_recipient_result_not_the_task_result():
    payload = {
        "id": "call_1",
        "status": "completed",
        "structured_result": {"completed_count": 1},
        "recipients": [{"structured_result": {"contact_type": "live_person"}, "attempts": []}],
    }
    snapshot = parse_call_task(payload)
    assert snapshot.recipient_result == {"contact_type": "live_person"}


def test_the_parser_takes_the_last_attempt_that_produced_a_transcript():
    payload = {
        "id": "call_1",
        "status": "completed",
        "recipients": [
            {
                "structured_result": {},
                "attempts": [
                    {"transcript_turns": [{"speaker": "bot", "text": "first", "offset_seconds": 0}]},
                    {"transcript_turns": []},
                    {"speaker": "x", "transcript_turns": [
                        {"speaker": "user", "text": "second", "offset_seconds": 3}
                    ]},
                ],
            }
        ],
    }
    snapshot = parse_call_task(payload)
    assert [turn.text for turn in snapshot.transcript_turns] == ["second"]


def test_the_parser_tolerates_a_null_confidence():
    snapshot = parse_call_task(
        {"id": "call_1", "status": "failed", "completion_confidence": None, "recipients": []}
    )
    assert snapshot.confidence_score is None
    assert snapshot.confidence_label is None
    assert snapshot.is_terminal


def test_the_parser_tolerates_a_null_recipient_result():
    snapshot = parse_call_task(
        {"id": "call_1", "status": "completed", "recipients": [{"structured_result": None}]}
    )
    assert snapshot.recipient_result is None


def test_the_parser_refuses_a_payload_without_an_id_or_status():
    with pytest.raises(TransportError, match="string id or status"):
        parse_call_task({"status": "completed"})


def test_terminal_statuses_match_the_contract():
    assert TERMINAL_STATUSES == {"completed", "failed", "canceled"}
    assert NON_TERMINAL_STATUSES == {"queued", "in_progress"}


def test_the_transport_interface_has_no_cancel():
    """CALL-E publishes no cancel endpoint, so the app must not offer one."""
    from positive_contact.transports import calle

    assert not hasattr(calle.CalleTransport, "cancel")
    assert not hasattr(FixtureTransport, "cancel")
    assert not hasattr(ReplayTransport, "cancel")
