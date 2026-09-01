from table_rescue.calle_client import (
    CallRequest,
    DryRunClient,
    build_confirm_goal,
    build_offer_goal,
    map_terminal_status,
    parse_outcome,
)
from table_rescue.models import CallStatus


def test_parse_outcome_reads_trailing_token():
    assert parse_outcome("thanks, OUTCOME: CANCELLED") == CallStatus.CANCELLED
    assert parse_outcome("no token here") is None
    assert parse_outcome(None) is None


def test_map_terminal_status():
    assert map_terminal_status("COMPLETED", "OUTCOME: ACCEPTED") == CallStatus.ACCEPTED
    assert map_terminal_status("COMPLETED", "garbage") == CallStatus.ERROR
    assert map_terminal_status("VOICEMAIL", None) == CallStatus.NO_ANSWER
    assert map_terminal_status("DECLINED", None) == CallStatus.DECLINED
    assert map_terminal_status("FAILED", None) == CallStatus.ERROR


def test_goal_builders_include_outcome_protocol():
    confirm = build_confirm_goal("Fictional Guest", 4, "2026-09-10T19:00:00+07:00")
    offer = build_offer_goal("Fictional Waitlist", 2, "2026-09-10T19:00:00+07:00")
    assert "OUTCOME: CONFIRMED" in confirm
    assert "OUTCOME: ACCEPTED" in offer


def test_dry_run_client_uses_fixtures(tmp_path):
    fixture = tmp_path / "fixtures.jsonl"
    fixture.write_text(
        '{"target_id": "R-001", "status": "CANCELLED", "new_slot": null, "notes": "cannot make it"}\n'
        '{"target_id": "DEFAULT", "status": "NO_ANSWER", "new_slot": null, "notes": "nobody picked up"}\n',
        encoding="utf-8",
    )
    client = DryRunClient(fixture)
    request = CallRequest(run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm")
    assert client.place_call(request).status == CallStatus.CANCELLED
    other = CallRequest(run_id="run-1", target_id="R-999", phone="+15550199", goal="confirm")
    assert client.place_call(other).status == CallStatus.NO_ANSWER
