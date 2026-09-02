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
    assert "automated assistant" in confirm
    assert "automated assistant" in offer


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


import asyncio
import json

import pytest

from table_rescue.calle_client import McpCallClient


class FakeToolResult:
    def __init__(self, structured):
        self.structured_content = structured


class ScriptedMcpClient:
    def __init__(self, script):
        self.script = script
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return FakeToolResult(self.script[name].pop(0))


def make_mcp_client(tmp_path, script):
    token_file = tmp_path / "token.json"
    token_file.write_text(
        json.dumps({"token": {"access_token": "tok"}}), encoding="utf-8"
    )
    client = McpCallClient(
        poll_interval_seconds=0,
        plan_retry_delay_seconds=0,
        client_factory=lambda: ScriptedMcpClient(script),
    )
    client._run_calle_json = lambda args: {"usable": True, "cache_path": str(token_file)}
    return client


def test_mcp_client_executes_plan_run_poll(tmp_path):
    script = {
        "plan_call": [{"plan_id": "p1", "confirm_token": "c1", "ready_to_run": True}],
        "run_call": [{"run_id": "call-1"}],
        "get_call_run": [
            {"status": "RUNNING"},
            {"status": "COMPLETED", "post_summary": "guest said OUTCOME: CANCELLED"},
        ],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm"
    )
    outcome = asyncio.run(client._execute(request))
    assert outcome.status == CallStatus.CANCELLED
    assert outcome.transcript_ref == "call-1"


def test_mcp_client_reads_nested_post_summary(tmp_path):
    # Regression: the real get_call_run payload nests the summary under
    # "result" and the agent states the outcome in prose, not an OUTCOME token.
    script = {
        "plan_call": [{"plan_id": "p1", "confirm_token": "c1", "ready_to_run": True}],
        "run_call": [{"run_id": "call-1"}],
        "get_call_run": [
            {
                "run_id": "call-1",
                "status": "COMPLETED",
                "result": {
                    "post_summary": "The reservation was successfully confirmed. "
                    "Fictional Guest chose to keep the booking for 4.",
                    "outcome": {"task_completed": True},
                },
            }
        ],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm"
    )
    outcome = asyncio.run(client._execute(request))
    assert outcome.status == CallStatus.CONFIRMED
    assert outcome.notes is not None and "successfully confirmed" in outcome.notes


def test_mcp_client_retries_transient_not_ready_plan(tmp_path):
    # Regression: back-to-back calls to the same number can make plan_call
    # report ready_to_run=false once; the client must retry, not crash.
    script = {
        "plan_call": [
            {"plan_id": None, "confirm_token": None, "ready_to_run": False},
            {"plan_id": "p1", "confirm_token": "c1", "ready_to_run": True},
        ],
        "run_call": [{"run_id": "call-1"}],
        "get_call_run": [
            {
                "status": "COMPLETED",
                "result": {"post_summary": "The guest confirmed they will keep it."},
            },
        ],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm"
    )
    outcome = asyncio.run(client._execute(request))
    assert outcome.status == CallStatus.CONFIRMED


def test_mcp_client_plan_retry_exhaustion_raises_with_detail(tmp_path):
    not_ready = {"plan_id": None, "confirm_token": None, "ready_to_run": False}
    script = {
        "plan_call": [dict(not_ready), dict(not_ready), dict(not_ready)],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm"
    )
    with pytest.raises(RuntimeError, match="after .* attempts"):
        asyncio.run(client._execute(request))


def test_ensure_access_token_requires_login():
    client = McpCallClient()
    client._run_calle_json = lambda args: {"usable": False}
    with pytest.raises(RuntimeError, match="not logged in"):
        client.ensure_access_token()


def test_parse_outcome_hardening():
    assert parse_outcome("agent said outcome: cancelled") == CallStatus.CANCELLED
    assert parse_outcome("The guest will cancel the booking.") == CallStatus.CANCELLED
    assert parse_outcome("Guest would like to reschedule to Friday.") == CallStatus.RESCHEDULED
    assert parse_outcome("OUTCOME: BANANA but guest confirmed") == CallStatus.CONFIRMED
    assert parse_outcome("no decision was reached") is None
